// Docs: Markdown documents shared by Claude and the user inside a workspace. Either side
// writes and edits; the user comments on a passage and Claude answers or resolves. When
// Claude reads a doc again it sees what the user changed since its last read, as a diff,
// and the comments still open, so nothing said on the page gets lost.

import { db, now, uid } from "./db";
import { broadcast } from "./hub";
import { unifiedDiff } from "./diff";

db.exec(`
CREATE TABLE IF NOT EXISTS docs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL DEFAULT 'agent',
  agent_body TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS docs_ws ON docs(workspace_id, updated_at);
CREATE TABLE IF NOT EXISTS doc_comments (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  parent_id TEXT,
  author TEXT NOT NULL,
  quote TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  seen INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS doc_comments_doc ON doc_comments(doc_id, created_at);
`);

export interface Doc {
  id: string;
  workspace_id: string;
  title: string;
  body: string;
  version: number;
  updated_by: "agent" | "user";
  /** the text as Claude last saw it, to tell it what the user changed since */
  agent_body: string;
  created_at: number;
  updated_at: number;
}
export interface DocComment {
  id: string;
  doc_id: string;
  parent_id: string | null;
  author: "user" | "agent";
  quote: string;
  body: string;
  resolved: number;
  seen: number;
  created_at: number;
}

const MAX_BODY = 400_000;

export const getDoc = (id: string) => db.query<Doc, [string]>("SELECT * FROM docs WHERE id = ?").get(id);
export const listDocs = (wsId: string) =>
  db
    .query<Doc & { open: number }, [string]>(
      "SELECT d.*, (SELECT COUNT(*) FROM doc_comments c WHERE c.doc_id = d.id AND c.resolved = 0 AND c.parent_id IS NULL) AS open FROM docs d WHERE workspace_id = ? ORDER BY updated_at DESC",
    )
    .all(wsId);
export const commentsOf = (docId: string) => db.query<DocComment, [string]>("SELECT * FROM doc_comments WHERE doc_id = ? ORDER BY created_at").all(docId);

function changed(d: Doc, by: "agent" | "user") {
  broadcast("doc", { workspaceId: d.workspace_id, doc: docView(getDoc(d.id)!), by });
}

export function docView(d: Doc) {
  const { agent_body, ...rest } = d;
  return { ...rest, comments: commentsOf(d.id) };
}

/** Find a doc by id or, failing that, by its exact title, in one workspace. */
export function findDoc(wsId: string, ref: string): Doc | null {
  const r = String(ref ?? "").trim();
  if (!r) return null;
  const byId = getDoc(r);
  if (byId && byId.workspace_id === wsId) return byId;
  return db.query<Doc, [string, string]>("SELECT * FROM docs WHERE workspace_id = ? AND lower(title) = lower(?) ORDER BY updated_at DESC LIMIT 1").get(wsId, r) ?? null;
}

export function createDoc(wsId: string, title: string, body: string, by: "agent" | "user"): Doc {
  const id = uid("d_");
  const text = body.slice(0, MAX_BODY);
  db.run("INSERT INTO docs (id, workspace_id, title, body, updated_by, agent_body, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)", [
    id,
    wsId,
    title.slice(0, 200) || "Untitled",
    text,
    by,
    by === "agent" ? text : "",
    now(),
    now(),
  ]);
  const d = getDoc(id)!;
  changed(d, by);
  return d;
}

export function saveDoc(d: Doc, patch: { title?: string; body?: string }, by: "agent" | "user", baseVersion?: number): Doc {
  if (baseVersion != null && baseVersion !== d.version) throw new Error("The doc changed since you opened it. Reload it and edit again.");
  const title = patch.title != null ? patch.title.slice(0, 200) || "Untitled" : d.title;
  const body = patch.body != null ? patch.body.slice(0, MAX_BODY) : d.body;
  db.run("UPDATE docs SET title = ?, body = ?, version = version + 1, updated_by = ?, agent_body = CASE WHEN ? = 'agent' THEN ? ELSE agent_body END, updated_at = ? WHERE id = ?", [
    title,
    body,
    by,
    by,
    body,
    now(),
    d.id,
  ]);
  const fresh = getDoc(d.id)!;
  changed(fresh, by);
  return fresh;
}

export function deleteDoc(d: Doc) {
  db.run("DELETE FROM docs WHERE id = ?", [d.id]);
  broadcast("doc_deleted", { workspaceId: d.workspace_id, id: d.id });
}

export function addComment(d: Doc, c: { author: "user" | "agent"; body: string; quote?: string; parent_id?: string | null }): DocComment {
  const parent = c.parent_id ? db.query<DocComment, [string, string]>("SELECT * FROM doc_comments WHERE id = ? AND doc_id = ?").get(c.parent_id, d.id) : null;
  if (c.parent_id && !parent) throw new Error(`No comment ${c.parent_id} on this doc`);
  const id = uid("c_");
  db.run("INSERT INTO doc_comments (id, doc_id, parent_id, author, quote, body, seen, created_at) VALUES (?,?,?,?,?,?,?,?)", [
    id,
    d.id,
    parent?.parent_id ?? parent?.id ?? null,
    c.author,
    (c.quote ?? "").slice(0, 2000),
    c.body.slice(0, 8000),
    c.author === "agent" ? 1 : 0,
    now(),
  ]);
  // a reply reopens a resolved thread
  if (parent) db.run("UPDATE doc_comments SET resolved = 0 WHERE id = ?", [parent.parent_id ?? parent.id]);
  changed(d, c.author);
  return db.query<DocComment, [string]>("SELECT * FROM doc_comments WHERE id = ?").get(id)!;
}

export function resolveComment(d: Doc, commentId: string, resolved: boolean, by: "user" | "agent") {
  const c = db.query<DocComment, [string, string]>("SELECT * FROM doc_comments WHERE id = ? AND doc_id = ?").get(commentId, d.id);
  if (!c) throw new Error(`No comment ${commentId} on this doc`);
  db.run("UPDATE doc_comments SET resolved = ? WHERE id = ? OR parent_id = ?", [resolved ? 1 : 0, c.parent_id ?? c.id, c.parent_id ?? c.id]);
  changed(d, by);
}

/** What Claude gets from doc_read: the text with line numbers, open threads, and the user's edits since its last look. */
export function readForAgent(d: Doc): string {
  const parts: string[] = [`# ${d.title} (doc ${d.id}, version ${d.version})`];
  if (d.updated_by === "user" && d.agent_body !== d.body) {
    const diff = unifiedDiff(d.agent_body, d.body, 2);
    parts.push(`The user edited this doc since you last saw it (+${diff.added} -${diff.removed} lines):\n\`\`\`diff\n${diff.text.slice(0, 12_000)}\n\`\`\``);
  }
  parts.push(`Text:\n${d.body || "(empty)"}`);
  const threads = commentsOf(d.id);
  const open = threads.filter((c) => !c.parent_id && !c.resolved);
  if (open.length) {
    parts.push(
      `Open comments (answer with doc_comment, and resolve the ones you dealt with):\n${open
        .map((t) => {
          const replies = threads.filter((r) => r.parent_id === t.id);
          return [`- [${t.id}] ${t.author === "user" ? "User" : "You"}${t.quote ? ` on "${t.quote.slice(0, 200)}"` : ""}: ${t.body}`, ...replies.map((r) => `  - ${r.author === "user" ? "User" : "You"}: ${r.body}`)].join("\n");
        })
        .join("\n")}`,
    );
  }
  db.run("UPDATE docs SET agent_body = body WHERE id = ?", [d.id]);
  db.run("UPDATE doc_comments SET seen = 1 WHERE doc_id = ?", [d.id]);
  return parts.join("\n\n");
}

/** One line per doc for the system prompt, flagging what's new from the user. */
export function docsBrief(wsId: string): string {
  const docs = listDocs(wsId);
  if (!docs.length) return "";
  return docs
    .slice(0, 30)
    .map((d) => {
      const unseen = db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM doc_comments WHERE doc_id = ? AND seen = 0").get(d.id)!.n;
      const flags = [d.updated_by === "user" && d.agent_body !== d.body ? "edited by the user since you last read it" : "", unseen ? `${unseen} new comment${unseen === 1 ? "" : "s"}` : "", d.open ? `${d.open} open` : ""].filter(Boolean);
      return `- ${d.title} (${d.id})${flags.length ? `: ${flags.join(", ")}` : ""}`;
    })
    .join("\n");
}

/** Replace one exact passage; it must occur once. */
export function editPassage(body: string, oldText: string, newText: string): string {
  if (!oldText) throw new Error("old_text is empty. Quote the passage to replace.");
  const at = body.indexOf(oldText);
  if (at < 0) throw new Error("That passage isn't in the doc. Read it again with doc_read; the user may have changed it.");
  if (body.indexOf(oldText, at + 1) >= 0) throw new Error("That passage appears more than once. Quote more of it so it's unique.");
  return body.slice(0, at) + newText + body.slice(at + oldText.length);
}
