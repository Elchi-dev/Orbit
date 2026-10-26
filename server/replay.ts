// Replay: everything that happened in a workspace and its helpers, as one
// timeline. Messages, tool calls with their output and timing, and every file
// change with its diff, so a finished run can be watched again.

import { existsSync, readFileSync } from "node:fs";
import { db, getWorkspace } from "./db";
import { unifiedDiff } from "./diff";

export type ReplayEvent =
  | { t: number; lane: string; kind: "message"; id: string; role: "user" | "assistant"; text: string; thinking: boolean }
  | { t: number; lane: string; kind: "tool"; id: string; name: string; subject: string; decided_by: string | null; reason: string | null; status: string; ms: number; output: string }
  | { t: number; lane: string; kind: "file"; id: number; path: string; status: "created" | "edited" | "deleted"; diff: string; added: number; removed: number };

export interface Replay {
  workspace: { id: string; title: string; cwd: string };
  lanes: { id: string; title: string; agent: string | null }[];
  start: number;
  end: number;
  events: ReplayEvent[];
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n[${s.length - n} more characters]` : s);
const isText = (b: Uint8Array) => !b.subarray(0, 8000).includes(0);

export function buildReplay(wsId: string): Replay | null {
  const ws = getWorkspace(wsId);
  if (!ws) return null;
  const helpers = db.query<{ id: string; title: string; agent: string | null }, [string]>("SELECT id, title, agent FROM workspaces WHERE parent_id = ? ORDER BY created_at").all(wsId);
  const lanes = [{ id: ws.id, title: ws.title, agent: null }, ...helpers];
  const events: ReplayEvent[] = [];
  for (const lane of lanes) {
    for (const m of db.query<{ id: string; role: string; content: string; created_at: number }, [string]>("SELECT id, role, content, created_at FROM messages WHERE workspace_id = ? ORDER BY created_at").all(lane.id)) {
      let blocks: any[] = [];
      try {
        blocks = JSON.parse(m.content);
      } catch {}
      const text = blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      const thinking = blocks.some((b) => b.type === "thinking");
      // tool results are shown with their call; empty steps are left out
      if (!text && !thinking) continue;
      events.push({ t: m.created_at, lane: lane.id, kind: "message", id: m.id, role: m.role as "user" | "assistant", text: cut(text, 6000), thinking });
    }
    for (const c of db
      .query<{ id: string; name: string; subject: string; decided_by: string | null; reason: string | null; status: string; duration_ms: number | null; output: string | null; created_at: number }, [string]>(
        "SELECT id, name, subject, decided_by, reason, status, duration_ms, output, created_at FROM tool_calls WHERE workspace_id = ? ORDER BY created_at",
      )
      .all(lane.id))
      events.push({ t: c.created_at, lane: lane.id, kind: "tool", id: c.id, name: c.name, subject: c.subject, decided_by: c.decided_by, reason: c.reason, status: c.status, ms: c.duration_ms ?? 0, output: cut(c.output ?? "", 4000) });

    // a snapshot is a file's content before a change; after is the next snapshot of that file, or the file now
    const snaps = db.query<{ id: number; path: string; existed: number; content: Uint8Array | null; created_at: number }, [string]>("SELECT id, path, existed, content, created_at FROM snapshots WHERE workspace_id = ? ORDER BY id").all(lane.id);
    snaps.forEach((s, i) => {
      const next = snaps.slice(i + 1).find((x) => x.path === s.path);
      let after: Buffer | null;
      if (next) after = next.existed && next.content ? Buffer.from(next.content) : null;
      else after = existsSync(s.path) ? readFileSync(s.path) : null;
      const before = s.existed && s.content ? Buffer.from(s.content) : null;
      const status: "created" | "edited" | "deleted" = !before ? "created" : after ? "edited" : "deleted";
      const binary = (before && !isText(before)) || (after && !isText(after));
      const d = binary ? { text: "(a binary file)", added: 0, removed: 0 } : unifiedDiff(before?.toString("utf8") ?? "", after?.toString("utf8") ?? "");
      events.push({ t: s.created_at + 1, lane: lane.id, kind: "file", id: s.id, path: s.path, status, diff: cut(d.text, 8000), added: d.added, removed: d.removed });
    });
  }
  events.sort((a, b) => a.t - b.t);
  if (!events.length) return { workspace: { id: ws.id, title: ws.title, cwd: ws.cwd }, lanes, start: ws.created_at, end: ws.created_at, events };
  const last = events[events.length - 1];
  return {
    workspace: { id: ws.id, title: ws.title, cwd: ws.cwd },
    lanes,
    start: events[0].t,
    end: Math.max(...events.map((e) => e.t + (e.kind === "tool" ? e.ms : 0)), last.t),
    events,
  };
}
