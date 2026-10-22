import { Database } from "bun:sqlite";
import { join } from "node:path";
import { ORBIT_DIR } from "./config";

export const db = new Database(process.env.ORBIT_DB ?? join(ORBIT_DIR, "orbit.db"), { create: true });
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  cwd TEXT NOT NULL,
  model TEXT,
  mode TEXT NOT NULL DEFAULT 'manual',
  style TEXT NOT NULL DEFAULT '{}',
  system_prompt TEXT NOT NULL DEFAULT '',
  judge_notes TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  titled INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  incognito INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_ws ON messages(workspace_id, created_at);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT,
  message_id TEXT,
  kind TEXT NOT NULL,
  model TEXT NOT NULL,
  input INTEGER NOT NULL DEFAULT 0,
  output INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  ttft_ms INTEGER,
  tps REAL,
  cost REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_time ON usage(created_at);
CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  message_id TEXT,
  name TEXT NOT NULL,
  input TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  output TEXT,
  is_error INTEGER NOT NULL DEFAULT 0,
  decided_by TEXT,
  reason TEXT,
  judge_ms INTEGER,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL DEFAULT 'global',
  pattern TEXT NOT NULL,
  verdict TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'glob',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tool_call_id TEXT,
  path TEXT NOT NULL,
  existed INTEGER NOT NULL,
  content BLOB,
  restored INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS secrets (
  name TEXT PRIMARY KEY,
  iv BLOB NOT NULL,
  data BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  schedule TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'rules',
  hook TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run INTEGER,
  last_run INTEGER,
  last_status TEXT,
  last_text TEXT,
  created_at INTEGER NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(text, message_id UNINDEXED, workspace_id UNINDEXED);
`);

// columns added after 0.1: add them to databases made before
for (const sql of [
  "ALTER TABLE snapshots ADD COLUMN reviewed INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE workspaces ADD COLUMN profile TEXT NOT NULL DEFAULT 'pair'",
  "ALTER TABLE workspaces ADD COLUMN plan TEXT NOT NULL DEFAULT '[]'",
  // helpers (subagents) are workspaces with a parent
  "ALTER TABLE workspaces ADD COLUMN parent_id TEXT",
  "ALTER TABLE workspaces ADD COLUMN agent TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE workspaces ADD COLUMN scope TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE workspaces ADD COLUMN tools TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE workspaces ADD COLUMN branch TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE workspaces ADD COLUMN base TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE workspaces ADD COLUMN report TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE workspaces ADD COLUMN helper_state TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE workspaces ADD COLUMN call_id TEXT NOT NULL DEFAULT ''",
]) {
  try {
    db.exec(sql);
  } catch {}
}

export const now = () => Date.now();
export const uid = (p = "") => p + crypto.randomUUID().replace(/-/g, "").slice(0, 20);

export interface WorkspaceRow {
  id: string;
  title: string;
  cwd: string;
  model: string | null;
  mode: string;
  style: string;
  system_prompt: string;
  judge_notes: string;
  summary: string;
  titled: number;
  archived: number;
  incognito: number;
  profile: string;
  plan: string;
  parent_id: string | null;
  agent: string;
  scope: string;
  tools: string;
  branch: string;
  base: string;
  report: string;
  helper_state: string;
  call_id: string;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  workspace_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: number;
}

export function getWorkspace(id: string) {
  return db.query<WorkspaceRow, [string]>("SELECT * FROM workspaces WHERE id = ?").get(id);
}

export function touchWorkspace(id: string) {
  db.run("UPDATE workspaces SET updated_at = ? WHERE id = ?", [now(), id]);
}

export function listMessages(wsId: string) {
  return db.query<MessageRow, [string]>("SELECT * FROM messages WHERE workspace_id = ? ORDER BY created_at, rowid").all(wsId);
}

export function insertMessage(wsId: string, role: "user" | "assistant", content: any[]) {
  const id = uid("m_");
  db.run("INSERT INTO messages (id, workspace_id, role, content, created_at) VALUES (?,?,?,?,?)", [
    id,
    wsId,
    role,
    JSON.stringify(content),
    now(),
  ]);
  const text = content
    .map((b) => (b.type === "text" ? b.text : b.type === "tool_result" ? "" : ""))
    .join("\n")
    .trim();
  const incognito = db.query<{ incognito: number }, [string]>("SELECT incognito FROM workspaces WHERE id = ?").get(wsId)?.incognito;
  if (text && !incognito) db.run("INSERT INTO search (text, message_id, workspace_id) VALUES (?,?,?)", [text, id, wsId]);
  touchWorkspace(wsId);
  return id;
}

export function workspaceStats(wsId: string) {
  return db
    .query<{ tokens: number; cost: number; last_ctx: number }, [string, string]>(
      `SELECT COALESCE(SUM(input+output+cache_read+cache_write),0) AS tokens, COALESCE(SUM(cost),0) AS cost,
       COALESCE((SELECT input+cache_read+cache_write+output FROM usage WHERE workspace_id = ? AND kind='pilot' ORDER BY id DESC LIMIT 1),0) AS last_ctx
       FROM usage WHERE workspace_id = ?`,
    )
    .get(wsId, wsId)!;
}

export function costSince(ts: number) {
  return db.query<{ cost: number; tokens: number }, [number]>(
    "SELECT COALESCE(SUM(cost),0) AS cost, COALESCE(SUM(input+output+cache_read+cache_write),0) AS tokens FROM usage WHERE created_at >= ?",
  ).get(ts)!;
}

export function startOfDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
export function startOfMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
