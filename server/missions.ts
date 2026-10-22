// Missions: a saved prompt that runs on its own, on a schedule or when a local
// webhook is called. Nobody is watching, so the run never waits for an answer:
// in Rules mode only your rules allow anything, in Auto mode the judge decides
// and "not sure" means no. When it ends, Orbit notifies you with the last reply.

import { db, getWorkspace, now, uid } from "./db";
import { broadcast } from "./hub";
import { isRunning, runTurn } from "./agent";

export type Schedule =
  | { kind: "hourly"; every: number }
  | { kind: "daily"; time: string }
  | { kind: "weekdays"; time: string }
  | { kind: "weekly"; day: number; time: string }
  | { kind: "hook" };

export interface Mission {
  id: string;
  workspace_id: string;
  title: string;
  prompt: string;
  schedule: Schedule;
  mode: "rules" | "auto";
  hook: string;
  enabled: number;
  next_run: number | null;
  last_run: number | null;
  last_status: string | null;
  last_text: string | null;
  created_at: number;
}

const parse = (row: any): Mission => ({ ...row, schedule: JSON.parse(row.schedule) });

function at(base: Date, time: string) {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(base);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

/** The next time a schedule fires after `from`, in local time. */
export function nextRun(s: Schedule, from = new Date()): number | null {
  switch (s.kind) {
    case "hook":
      return null;
    case "hourly": {
      const every = Math.max(1, Math.min(24, Math.round(s.every || 1)));
      const d = new Date(from);
      d.setMinutes(0, 0, 0);
      d.setHours(d.getHours() + every);
      return d.getTime();
    }
    case "daily":
    case "weekdays":
    case "weekly": {
      for (let i = 0; i < 8; i++) {
        const day = new Date(from);
        day.setDate(day.getDate() + i);
        const t = at(day, s.time);
        if (t <= from) continue;
        const dow = t.getDay();
        if (s.kind === "weekdays" && (dow === 0 || dow === 6)) continue;
        if (s.kind === "weekly" && dow !== s.day) continue;
        return t.getTime();
      }
      return null;
    }
  }
}

export function listMissions(wsId?: string): Mission[] {
  const rows = wsId
    ? db.query("SELECT * FROM missions WHERE workspace_id = ? ORDER BY created_at").all(wsId)
    : db.query("SELECT * FROM missions ORDER BY created_at").all();
  return rows.map(parse);
}

const get = (id: string) => {
  const r = db.query("SELECT * FROM missions WHERE id = ?").get(id);
  return r ? parse(r) : null;
};

export function validSchedule(s: any): Schedule {
  const time = typeof s?.time === "string" && /^\d{1,2}:\d{2}$/.test(s.time) ? s.time : "09:00";
  switch (s?.kind) {
    case "hourly":
      return { kind: "hourly", every: Math.max(1, Math.min(24, Number(s.every) || 1)) };
    case "daily":
      return { kind: "daily", time };
    case "weekdays":
      return { kind: "weekdays", time };
    case "weekly":
      return { kind: "weekly", day: Math.max(0, Math.min(6, Number(s.day) || 1)), time };
    default:
      return { kind: "hook" };
  }
}

export function createMission(wsId: string, body: any): Mission {
  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) throw new Error("Write what the mission should do");
  const schedule = validSchedule(body.schedule);
  const id = uid("m_");
  db.run(
    "INSERT INTO missions (id, workspace_id, title, prompt, schedule, mode, hook, enabled, next_run, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [id, wsId, String(body.title ?? "").slice(0, 80), prompt, JSON.stringify(schedule), body.mode === "auto" ? "auto" : "rules", uid(""), 1, nextRun(schedule), now()],
  );
  emit(wsId);
  return get(id)!;
}

export function updateMission(id: string, body: any): Mission {
  const m = get(id);
  if (!m) throw new Error("No such mission");
  const schedule = body.schedule ? validSchedule(body.schedule) : m.schedule;
  const enabled = body.enabled === undefined ? m.enabled : body.enabled ? 1 : 0;
  db.run("UPDATE missions SET title = ?, prompt = ?, schedule = ?, mode = ?, enabled = ?, next_run = ? WHERE id = ?", [
    body.title !== undefined ? String(body.title).slice(0, 80) : m.title,
    body.prompt !== undefined ? String(body.prompt) : m.prompt,
    JSON.stringify(schedule),
    body.mode === "auto" || body.mode === "rules" ? body.mode : m.mode,
    enabled,
    enabled ? nextRun(schedule) : null,
    id,
  ]);
  emit(m.workspace_id);
  return get(id)!;
}

export function deleteMission(id: string) {
  const m = get(id);
  db.run("DELETE FROM missions WHERE id = ?", [id]);
  if (m) emit(m.workspace_id);
}

function emit(wsId: string) {
  broadcast("missions", { workspaceId: wsId, missions: listMissions(wsId) });
}

/** Start a mission now. `extra` is text a webhook sent along. */
export async function launch(id: string, why: "schedule" | "hook" | "manual", extra = ""): Promise<string> {
  const m = get(id);
  if (!m) throw new Error("No such mission");
  const ws = getWorkspace(m.workspace_id);
  if (!ws) throw new Error("The workspace is gone");
  if (isRunning(ws.id)) {
    db.run("UPDATE missions SET last_status = ?, last_run = ?, next_run = ? WHERE id = ?", ["skipped: the workspace was busy", now(), m.enabled ? nextRun(m.schedule) : null, id]);
    emit(ws.id);
    return "busy";
  }
  db.run("UPDATE missions SET last_status = 'running', last_run = ?, next_run = ? WHERE id = ?", [now(), m.enabled ? nextRun(m.schedule) : null, id]);
  emit(ws.id);
  const note = why === "manual" ? "" : why === "hook" ? " (started by its webhook)" : " (on its schedule)";
  const text = `${m.prompt}${extra ? `\n\n${extra}` : ""}\n\n[Orbit: this is the mission "${m.title || "untitled"}"${note}. Nobody is watching; work without asking questions and end with a short summary of what you did and found.]`;
  const reason = await runTurn(ws.id, [{ type: "text", text }], { unattended: true, mode: m.mode });
  // the last thing Claude said is the report
  const last = db
    .query<{ content: string }, [string]>("SELECT content FROM messages WHERE workspace_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1")
    .get(ws.id);
  const reply = last ? (JSON.parse(last.content) as any[]).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim() : "";
  db.run("UPDATE missions SET last_status = ?, last_text = ? WHERE id = ?", [reason, reply.slice(0, 4000), id]);
  emit(ws.id);
  broadcast("notify", { workspaceId: ws.id, title: `${m.title || "Mission"} ${reason === "done" ? "finished" : reason}`, body: reply.slice(0, 200) || ws.title });
  return reason;
}

export function byHook(token: string) {
  const r = db.query("SELECT * FROM missions WHERE hook = ?").get(token);
  return r ? parse(r) : null;
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Check every 30 seconds for missions that are due. Missed runs (the computer slept) run once, then the schedule continues. */
export function startScheduler() {
  if (timer) return;
  const tick = () => {
    const due = db
      .query("SELECT * FROM missions WHERE enabled = 1 AND next_run IS NOT NULL AND next_run <= ?")
      .all(now())
      .map(parse);
    for (const m of due) launch(m.id, "schedule").catch((e) => console.error("[orbit] mission failed:", (e as Error).message));
  };
  timer = setInterval(tick, 30_000);
  setTimeout(tick, 3000);
}
