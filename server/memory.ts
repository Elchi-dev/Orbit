// Automatic memory: after a run, a small model reads the conversation and
// suggests a few lasting facts (how you like to work, what your projects use,
// decisions). Nothing is remembered until you keep it. Kept memories go in
// front of Claude in every workspace, and Claude marks the ones an answer used,
// so the interface can show them.

import { complete } from "./anthropic";
import { config } from "./config";
import { db, getWorkspace, listMessages, now, uid } from "./db";
import { broadcast } from "./hub";
import { recordUsage } from "./usage";

db.exec(`
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'suggested',
  source_ws TEXT,
  used INTEGER NOT NULL DEFAULT 0,
  last_used INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS memories_status ON memories(status, updated_at);
`);

export interface Memory {
  id: string;
  text: string;
  status: "suggested" | "kept" | "dismissed";
  source_ws: string | null;
  used: number;
  last_used: number | null;
  created_at: number;
  updated_at: number;
}

const MAX_KEPT_IN_PROMPT = 60;

export const listMemories = (status?: Memory["status"]) =>
  status
    ? db.query<Memory, [string]>("SELECT * FROM memories WHERE status = ? ORDER BY updated_at DESC").all(status)
    : db.query<Memory, []>("SELECT * FROM memories WHERE status != 'dismissed' ORDER BY status = 'suggested' DESC, updated_at DESC").all();
export const getMemory = (id: string) => db.query<Memory, [string]>("SELECT * FROM memories WHERE id = ?").get(id);

const changed = () => broadcast("memories", { suggested: listMemories("suggested").length });

export function addMemory(text: string, status: "kept" | "suggested" = "kept", source?: string | null): Memory {
  const id = uid("m_");
  db.run("INSERT INTO memories (id, text, status, source_ws, created_at, updated_at) VALUES (?,?,?,?,?,?)", [id, text.trim().slice(0, 500), status, source ?? null, now(), now()]);
  changed();
  return getMemory(id)!;
}
export function updateMemory(id: string, patch: { text?: string; status?: Memory["status"] }) {
  const m = getMemory(id);
  if (!m) throw new Error("No such memory");
  db.run("UPDATE memories SET text = ?, status = ?, updated_at = ? WHERE id = ?", [patch.text != null ? patch.text.trim().slice(0, 500) : m.text, patch.status ?? m.status, now(), id]);
  changed();
  return getMemory(id)!;
}
export function deleteMemory(id: string) {
  db.run("DELETE FROM memories WHERE id = ?", [id]);
  changed();
}

const enabled = () => config().memory?.enabled !== false;

/** The part of the system prompt with what you kept. */
export function memoryPrompt(): string {
  if (!enabled()) return "";
  const kept = db.query<Memory, [number]>("SELECT * FROM memories WHERE status = 'kept' ORDER BY used DESC, updated_at DESC LIMIT ?").all(MAX_KEPT_IN_PROMPT);
  if (!kept.length) return "";
  return `What the user asked you to remember across workspaces. Use what is relevant and ignore the rest. When an answer relies on one of these, end it with a line like [memory: m_abc123] listing the ids you used; the interface shows the user which memories mattered.\n${kept
    .map((m) => `<memory id="${m.id}">${m.text}</memory>`)
    .join("\n")}`;
}

const MARK = /\n?\[memor(?:y|ies):\s*([\w\s,]+)\]\s*$/i;

/** Finds the memory ids an answer says it used, and counts them. */
export function noteUsed(text: string): string[] {
  const m = text.match(MARK);
  if (!m) return [];
  const ids = m[1]
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter((x) => /^m_\w+$/.test(x));
  const found = ids.filter((id) => getMemory(id)?.status === "kept");
  for (const id of found) db.run("UPDATE memories SET used = used + 1, last_used = ? WHERE id = ?", [now(), id]);
  return found;
}

const SUGGEST = `You keep a person's long-term memory for their AI workspace. Read the conversation and suggest facts worth remembering in every future workspace.

Good memories are lasting and about the person or their work: preferences ("prefers pnpm over npm", "wants answers short, code first"), their setup ("deploys to a Hetzner box with Docker Compose"), projects ("the shop project uses Next.js and Postgres"), and decisions with their reason. Each one is a single short sentence that makes sense without the conversation.

Never suggest: secrets, keys, passwords or personal data about other people; details of this one task; things already in the existing memories; guesses. Prefer nothing over something weak.

Answer with JSON only: {"memories": ["...", "..."]}, at most 3, or {"memories": []}.`;

const running = new Set<string>();

const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["the", "and", "with", "for", "are", "uses", "use", "prefers", "wants", "likes"].includes(w)));
/** Two memories saying nearly the same thing, even worded differently. */
export function similar(a: string, b: string) {
  const x = words(a),
    y = words(b);
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / Math.min(x.size, y.size) >= 0.6;
}

/** After a run: suggest a few memories from it. Quiet on failure. */
export async function suggestFrom(wsId: string) {
  if (!enabled() || config().memory?.suggest === false || running.has(wsId)) return;
  const ws = getWorkspace(wsId);
  if (!ws || ws.incognito || ws.parent_id) return;
  const msgs = listMessages(wsId);
  const userTurns = msgs.filter((m) => m.role === "user" && JSON.parse(m.content).some?.((b: any) => b.type === "text")).length;
  // a little conversation first, then at most every third run
  if (userTurns < 2 || userTurns % 3 !== 2) return;
  running.add(wsId);
  try {
    const text = msgs
      .slice(-24)
      .map((m) => {
        const blocks = JSON.parse(m.content) as any[];
        const t = blocks
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .slice(0, 1500);
        return t ? `${m.role === "user" ? "Person" : "Assistant"}: ${t}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
    const existing = listMemories()
      .map((m) => `- ${m.text}`)
      .join("\n");
    const c = config();
    const r = await complete({
      model: c.models.scribe,
      system: SUGGEST,
      messages: [{ role: "user", content: [{ type: "text", text: `Existing memories:\n${existing || "(none)"}\n\nConversation:\n${text}` }] }],
      max_tokens: 800,
      effort: "low",
    });
    recordUsage(wsId, null, "scribe", c.models.scribe, r.usage);
    const json = r.text.match(/\{[\s\S]*\}/)?.[0];
    const list: unknown = json ? JSON.parse(json).memories : [];
    if (!Array.isArray(list)) return;
    // dismissed ones count too: a fact you said no to doesn't come back
    const have = db.query<{ text: string }, []>("SELECT text FROM memories").all().map((m) => m.text);
    for (const s of list.slice(0, 3)) {
      const t = String(s).trim();
      if (t.length < 8 || t.length > 300 || have.some((h) => similar(h, t)) || /(sk-|password|token\s*[:=]|api[_ ]?key\s*[:=])/i.test(t)) continue;
      addMemory(t, "suggested", wsId);
      have.push(t);
    }
  } catch {
  } finally {
    running.delete(wsId);
  }
}
