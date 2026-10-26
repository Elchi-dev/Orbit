// Review: every file Claude changed in a workspace, compared with how it was before
// Claude first touched it. Keep or undo a whole file, or one hunk at a time: a kept
// hunk moves into the file's review baseline, so what is left can still be undone.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { db } from "./db";
import { broadcast } from "./hub";
import { createHash } from "node:crypto";
import { applyHunk, hunksOf, unifiedDiff, type Hunk } from "./diff";

interface Snap {
  id: number;
  path: string;
  existed: number;
  content: Uint8Array | null;
  created_at: number;
}

export interface FileReview {
  path: string;
  status: "created" | "edited" | "deleted";
  edits: number;
  since: number;
  added: number;
  removed: number;
  diff: string;
  binary: boolean;
  /** the changes one by one; empty for binary and deleted files */
  hunks: Hunk[];
  /** changes when the file or its baseline changes; hunk actions must name the one they saw */
  rev: string;
}

const isText = (b: Uint8Array) => !b.subarray(0, 8000).includes(0);

function pending(wsId: string): Map<string, Snap[]> {
  const rows = db
    .query<Snap, [string]>("SELECT id, path, existed, content, created_at FROM snapshots WHERE workspace_id = ? AND restored = 0 AND reviewed = 0 ORDER BY id")
    .all(wsId);
  const by = new Map<string, Snap[]>();
  for (const r of rows) by.set(r.path, [...(by.get(r.path) ?? []), r]);
  return by;
}

/** What the file is compared with: before Claude's first change, plus any hunks you kept. */
function baseOf(wsId: string, path: string, first: Snap): Buffer {
  const kept = db.query<{ content: Uint8Array }, [string, string]>("SELECT content FROM review_base WHERE workspace_id = ? AND path = ?").get(wsId, path);
  if (kept) return Buffer.from(kept.content);
  return first.existed && first.content ? Buffer.from(first.content) : Buffer.alloc(0);
}
const revOf = (base: Buffer, now: Buffer) => createHash("sha1").update(base).update("\0").update(now).digest("hex").slice(0, 16);

export function reviewList(wsId: string): FileReview[] {
  const out: FileReview[] = [];
  for (const [path, snaps] of pending(wsId)) {
    const first = snaps[0];
    const before = baseOf(wsId, path, first);
    const exists = existsSync(path);
    const now = exists ? readFileSync(path) : Buffer.alloc(0);
    const status: FileReview["status"] = !first.existed ? "created" : exists ? "edited" : "deleted";
    const binary = !isText(before) || !isText(now);
    const d = binary ? { text: "", added: 0, removed: 0 } : unifiedDiff(before.toString("utf8"), now.toString("utf8"));
    if (!binary && status !== "deleted" && !d.text) continue; // changed and changed back, or every hunk kept
    const hunks = binary || status === "deleted" ? [] : hunksOf(before.toString("utf8"), now.toString("utf8")) ?? [];
    out.push({ path, status, edits: snaps.length, since: first.created_at, added: d.added, removed: d.removed, diff: d.text, binary, hunks, rev: revOf(before, now) });
  }
  return out;
}

function current(wsId: string, path: string, rev: string) {
  const snaps = pending(wsId).get(path);
  if (!snaps?.length) throw new Error("Nothing to review for that file");
  const before = baseOf(wsId, path, snaps[0]);
  const now = existsSync(path) ? readFileSync(path) : Buffer.alloc(0);
  if (revOf(before, now) !== rev) throw new Error("The file changed since you looked. Have another look.");
  return { snaps, before: before.toString("utf8"), now: now.toString("utf8") };
}

function settle(wsId: string, path: string) {
  // nothing left to look at: the file leaves the list like a kept one
  if (!reviewList(wsId).some((f) => f.path === path)) {
    db.run("UPDATE snapshots SET reviewed = 1 WHERE workspace_id = ? AND path = ? AND restored = 0", [wsId, path]);
    db.run("DELETE FROM review_base WHERE workspace_id = ? AND path = ?", [wsId, path]);
  }
}

/** Keep one hunk: it becomes part of the baseline, the file itself doesn't change. */
export function keepHunk(wsId: string, path: string, hunk: number, rev: string) {
  const { before, now } = current(wsId, path, rev);
  const base = applyHunk(before, now, hunk, true);
  db.run("INSERT OR REPLACE INTO review_base (workspace_id, path, content) VALUES (?,?,?)", [wsId, path, Buffer.from(base, "utf8")]);
  settle(wsId, path);
  broadcast("file_changed", { workspaceId: wsId, path, kind: "keep" });
}

/** Undo one hunk: the file gets that part back the way it was, the rest stays. */
export function undoHunk(wsId: string, path: string, hunk: number, rev: string) {
  const { before, now } = current(wsId, path, rev);
  const next = applyHunk(before, now, hunk, false);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next);
  settle(wsId, path);
  broadcast("file_changed", { workspaceId: wsId, path, kind: "undo" });
}

/** Mark a file's changes as seen: it leaves the review list, the undo journal keeps it. */
export function keep(wsId: string, path?: string) {
  if (path) db.run("UPDATE snapshots SET reviewed = 1 WHERE workspace_id = ? AND path = ? AND restored = 0", [wsId, path]);
  else db.run("UPDATE snapshots SET reviewed = 1 WHERE workspace_id = ? AND restored = 0", [wsId]);
  if (path) db.run("DELETE FROM review_base WHERE workspace_id = ? AND path = ?", [wsId, path]);
  else db.run("DELETE FROM review_base WHERE workspace_id = ?", [wsId]);
  broadcast("file_changed", { workspaceId: wsId, path: path ?? "", kind: "keep" });
}

/** Put a file back the way it was before Claude's first change to it. */
export function revert(wsId: string, path: string) {
  const snaps = pending(wsId).get(path);
  if (!snaps?.length) throw new Error("Nothing to undo for that file");
  const first = snaps[0];
  const kept = db.query<{ content: Uint8Array }, [string, string]>("SELECT content FROM review_base WHERE workspace_id = ? AND path = ?").get(wsId, path);
  if (kept) {
    // hunks you kept stay; everything else goes back
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(kept.content));
    db.run("UPDATE snapshots SET reviewed = 1 WHERE workspace_id = ? AND path = ? AND restored = 0", [wsId, path]);
    db.run("DELETE FROM review_base WHERE workspace_id = ? AND path = ?", [wsId, path]);
    broadcast("file_changed", { workspaceId: wsId, path, kind: "undo" });
    return;
  }
  if (first.existed && first.content) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(first.content));
  } else if (!first.existed && existsSync(path)) unlinkSync(path);
  db.run(`UPDATE snapshots SET restored = 1 WHERE id IN (${snaps.map(() => "?").join(",")})`, snaps.map((s) => s.id));
  broadcast("file_changed", { workspaceId: wsId, path, kind: "undo" });
}

export function revertAll(wsId: string) {
  for (const path of [...pending(wsId).keys()].reverse()) revert(wsId, path);
}
