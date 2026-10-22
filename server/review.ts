// Review: every file Claude changed in a workspace, compared with how it was before
// Claude first touched it. Keep a file's changes, or put the file back as it was.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { db } from "./db";
import { broadcast } from "./hub";
import { unifiedDiff } from "./diff";

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

export function reviewList(wsId: string): FileReview[] {
  const out: FileReview[] = [];
  for (const [path, snaps] of pending(wsId)) {
    const first = snaps[0];
    const before = first.existed && first.content ? Buffer.from(first.content) : Buffer.alloc(0);
    const exists = existsSync(path);
    const now = exists ? readFileSync(path) : Buffer.alloc(0);
    const status: FileReview["status"] = !first.existed ? "created" : exists ? "edited" : "deleted";
    const binary = !isText(before) || !isText(now);
    const d = binary ? { text: "", added: 0, removed: 0 } : unifiedDiff(before.toString("utf8"), now.toString("utf8"));
    if (!binary && status === "edited" && !d.text) continue; // changed and changed back
    out.push({ path, status, edits: snaps.length, since: first.created_at, added: d.added, removed: d.removed, diff: d.text, binary });
  }
  return out;
}

/** Mark a file's changes as seen: it leaves the review list, the undo journal keeps it. */
export function keep(wsId: string, path?: string) {
  if (path) db.run("UPDATE snapshots SET reviewed = 1 WHERE workspace_id = ? AND path = ? AND restored = 0", [wsId, path]);
  else db.run("UPDATE snapshots SET reviewed = 1 WHERE workspace_id = ? AND restored = 0", [wsId]);
  broadcast("file_changed", { workspaceId: wsId, path: path ?? "", kind: "keep" });
}

/** Put a file back the way it was before Claude's first change to it. */
export function revert(wsId: string, path: string) {
  const snaps = pending(wsId).get(path);
  if (!snaps?.length) throw new Error("Nothing to undo for that file");
  const first = snaps[0];
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
