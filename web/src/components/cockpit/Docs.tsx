import { OriEmpty } from "../ori/OriEmpty";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Check, CheckCheck, Eye, FilePlus2, FileText, Loader2, MessageSquare, MessageSquarePlus, Pencil, RotateCcw, Send, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { panelLocks, useStore } from "../../lib/store";
import { ago } from "../../lib/format";
import type { Doc, DocComment, Workspace } from "../../lib/types";
import { Markdown } from "./Blocks";

/** Mark the passages comments refer to in the rendered doc, so you see what each thread is about. */
function useHighlights(root: React.RefObject<HTMLDivElement | null>, threads: DocComment[], active: string | null, deps: unknown[]) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    el.querySelectorAll("mark.doc-mark").forEach((m) => m.replaceWith(...m.childNodes));
    el.normalize();
    threads.forEach((t, i) => {
      const q = t.quote.trim();
      if (!q || t.resolved) return;
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = walk.nextNode())) {
        const at = n.textContent?.indexOf(q.slice(0, 120)) ?? -1;
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(n, at);
        range.setEnd(n, Math.min(n.textContent!.length, at + q.length));
        const mark = document.createElement("mark");
        mark.className = `doc-mark ${active === t.id ? "on" : ""}`;
        mark.dataset.thread = t.id;
        mark.dataset.n = String(i + 1);
        range.surroundContents(mark);
        break;
      }
    });
  }, [threads, active, ...deps]);
}

function Thread({ doc, thread, replies, n, active, onFocus }: { doc: Doc; thread: DocComment; replies: DocComment[]; n: number; active: boolean; onFocus: () => void }) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useStore((s) => s.toast);
  async function post(body: object) {
    setBusy(true);
    try {
      await api.post(`/api/docs/${doc.id}/comments${"resolved" in body ? `/${thread.id}` : ""}`, body);
      setReply("");
    } catch (e) {
      toast({ title: "Not saved", body: (e as Error).message, tone: "warn" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className={`thread ${active ? "on" : ""} ${thread.resolved ? "resolved" : ""}`} onClick={onFocus}>
      <div className="thread-head">
        <span className="pv-pin">{n}</span>
        {thread.quote && <q className="thread-quote">{thread.quote}</q>}
        <button
          className="btn b-ghost icon-btn sm thread-resolve"
          onClick={(e) => {
            e.stopPropagation();
            post({ resolved: !thread.resolved });
          }}
          aria-label={thread.resolved ? "Reopen" : "Resolve"}
          data-tip={thread.resolved ? "Reopen" : "Resolve"}
        >
          {thread.resolved ? <RotateCcw size={13} /> : <Check size={14} />}
        </button>
      </div>
      {[thread, ...replies].map((c) => (
        <div key={c.id} className={`comment ${c.author}`}>
          <span className="comment-who">{c.author === "agent" ? "Claude" : "You"}</span>
          <span className="comment-when">{ago(c.created_at)}</span>
          <p>{c.body}</p>
        </div>
      ))}
      {active && !thread.resolved && (
        <form
          className="thread-reply"
          onSubmit={(e) => {
            e.preventDefault();
            if (reply.trim()) post({ body: reply, parent_id: thread.id });
          }}
        >
          <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply" aria-label="Reply" />
          <button className="btn b-ghost icon-btn sm" disabled={!reply.trim() || busy} aria-label="Send reply">
            <Send size={13} />
          </button>
        </form>
      )}
    </li>
  );
}

function DocView({ ws, id }: { ws: Workspace; id: string }) {
  const doc = useStore((s) => s.docById[id]);
  const selectDoc = useStore((s) => s.selectDoc);
  const send = useStore((s) => s.send);
  const toast = useStore((s) => s.toast);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [base, setBase] = useState(0);
  const [saving, setSaving] = useState(false);
  const [sel, setSel] = useState<{ quote: string; x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<{ quote: string } | null>(null);
  const [comment, setComment] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .get<Doc>(`/api/docs/${id}`)
      .then((d) => useStore.setState({ docById: { ...useStore.getState().docById, [id]: d } }))
      .catch(() => selectDoc(ws.id, null));
  }, [id]);

  const threads = useMemo(() => (doc?.comments ?? []).filter((c) => !c.parent_id), [doc?.comments]);
  const open = threads.filter((t) => !t.resolved);
  const visible = showResolved ? threads : open;
  useHighlights(body, open, active, [doc?.body, editing]);
  // while you edit or write a comment, Claude's work elsewhere doesn't pull the panel away
  useEffect(() => {
    if (editing || draft) panelLocks.add(ws.id);
    else panelLocks.delete(ws.id);
    return () => {
      panelLocks.delete(ws.id);
    };
  }, [editing, !!draft, ws.id]);

  // Claude answered or edited: if you're not mid-edit, you see it at once
  useEffect(() => {
    if (!editing && doc) setBase(doc.version);
  }, [doc?.version, editing]);

  if (!doc) return <div className="loading">Loading the doc…</div>;

  function startEdit() {
    setText(doc!.body);
    setTitle(doc!.title);
    setBase(doc!.version);
    setEditing(true);
  }
  async function save() {
    setSaving(true);
    try {
      await api.put(`/api/docs/${doc!.id}`, { body: text, title, version: base });
      setEditing(false);
    } catch (e) {
      toast({ title: "Claude changed the doc while you edited", body: "Your text is still in the editor. Copy what you need, then reload the doc.", tone: "warn" });
    } finally {
      setSaving(false);
    }
  }
  function onMouseUp() {
    const s = window.getSelection();
    const q = s?.toString().trim() ?? "";
    if (!q || !body.current || !s?.rangeCount || !body.current.contains(s.anchorNode)) return setSel(null);
    const r = s.getRangeAt(0).getBoundingClientRect();
    const box = scroller.current!.getBoundingClientRect();
    setSel({ quote: q.slice(0, 600), x: r.left - box.left + r.width / 2, y: r.top - box.top + scroller.current!.scrollTop - 8 });
  }
  async function addComment() {
    if (!comment.trim()) return;
    try {
      await api.post(`/api/docs/${doc!.id}/comments`, { body: comment, quote: draft?.quote ?? "" });
      setComment("");
      setDraft(null);
    } catch (e) {
      toast({ title: "Not saved", body: (e as Error).message, tone: "warn" });
    }
  }
  // what Claude hasn't answered yet: threads whose last word is yours, and your edits
  const waiting = open.filter((t) => {
    const all = (doc.comments ?? []).filter((c) => c.id === t.id || c.parent_id === t.id);
    return all[all.length - 1]?.author === "user";
  }).length;
  const edited = doc.updated_by === "user";
  function askClaude() {
    const parts = [waiting ? `${waiting} ${waiting === 1 ? "comment" : "comments"}` : "", edited ? "my edits" : ""].filter(Boolean).join(" and ");
    send({ type: "send", workspaceId: ws.id, text: `Please go through ${parts || "the doc"} on "${doc!.title}" (${doc!.id}): read it with doc_read, answer each comment and make the changes.` });
    toast({ title: "Sent to Claude", tone: "good" });
  }

  return (
    <div className="doc">
      <div className="doc-bar">
        <button className="btn b-ghost icon-btn sm" onClick={() => selectDoc(ws.id, null)} aria-label="All docs" data-tip="All docs" data-tip-side="bottom">
          <ArrowLeft size={15} />
        </button>
        {editing ? (
          <input className="doc-title-edit" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
        ) : (
          <h2 className="doc-title">{doc.title}</h2>
        )}
        <span className="doc-meta">
          v{doc.version} · {doc.updated_by === "agent" ? "Claude" : "you"}, {ago(doc.updated_at)}
        </span>
        {editing ? (
          <>
            <button className="btn b-ghost sz-s" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button className="btn b-lav sz-s" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={13} className="spin" /> : <Check size={13} />} Save
            </button>
          </>
        ) : (
          <>
            <button className="btn b-ghost icon-btn sm" onClick={startEdit} aria-label="Edit" data-tip="Edit the Markdown" data-tip-side="bottom">
              <Pencil size={14} />
            </button>
            <button
              className="btn b-ghost icon-btn sm"
              onClick={async () => {
                if (!confirm(`Delete "${doc.title}"?`)) return;
                await api.del(`/api/docs/${doc.id}`);
                selectDoc(ws.id, null);
              }}
              aria-label="Delete"
              data-tip="Delete"
              data-tip-side="bottom"
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>

      <div className="doc-scroll" ref={scroller}>
        {editing ? (
          <textarea
            className="doc-editor mono"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                e.preventDefault();
                save();
              }
              if (e.key === "Escape") setEditing(false);
            }}
            spellCheck
            aria-label="The doc in Markdown"
            autoFocus
          />
        ) : (
          <div
            className="doc-body"
            ref={body}
            onMouseUp={onMouseUp}
            onClick={(e) => {
              const m = (e.target as HTMLElement).closest("mark.doc-mark") as HTMLElement | null;
              if (m) setActive(m.dataset.thread ?? null);
            }}
          >
            {/* remounted when marks change, so React never diffs nodes the highlighter moved */}
            <div key={`${doc.version}:${open.map((t) => t.id).join(",")}:${active}`}>
              {doc.body.trim() ? <Markdown text={doc.body} /> : <p className="muted">Empty. Edit it, or ask Claude to write it.</p>}
            </div>
          </div>
        )}
        <AnimatePresence>
          {sel && !editing && (
            <motion.button
              className="btn b-lav sz-s doc-sel-btn"
              style={{ left: sel.x, top: sel.y }}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setDraft({ quote: sel.quote });
                setSel(null);
                window.getSelection()?.removeAllRanges();
              }}
            >
              <MessageSquarePlus size={13} /> Comment
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <aside className="doc-side" aria-label="Comments">
        <div className="doc-side-head">
          <MessageSquare size={14} /> {open.length ? `${open.length} open` : "No open comments"}
          {threads.length > open.length && (
            <button className="btn b-link" onClick={() => setShowResolved(!showResolved)}>
              {showResolved ? "hide resolved" : `${threads.length - open.length} resolved`}
            </button>
          )}
          <button className="btn b-ghost sz-s doc-new-comment" onClick={() => setDraft({ quote: "" })}>
            <MessageSquarePlus size={13} /> Comment
          </button>
        </div>
        {draft && (
          <form
            className="doc-draft"
            onSubmit={(e) => {
              e.preventDefault();
              addComment();
            }}
          >
            {draft.quote && <q className="thread-quote">{draft.quote}</q>}
            <textarea
              autoFocus
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                  e.preventDefault();
                  addComment();
                }
                if (e.key === "Escape") setDraft(null);
              }}
              placeholder={draft.quote ? "What about this passage?" : "A comment on the doc"}
              aria-label="Comment"
            />
            <span className="doc-draft-row">
              <button type="button" className="btn b-ghost sz-s" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button className="btn b-outline sz-s" disabled={!comment.trim()}>
                Add
              </button>
            </span>
          </form>
        )}
        <ol className="threads">
          {visible.map((t) => (
            <Thread key={t.id} doc={doc} thread={t} n={threads.indexOf(t) + 1} replies={(doc.comments ?? []).filter((c) => c.parent_id === t.id)} active={active === t.id} onFocus={() => setActive(t.id)} />
          ))}
        </ol>
        {(waiting > 0 || edited) && (
          <button className="btn b-peach sz-s doc-ask" onClick={askClaude} disabled={ws.running && !waiting}>
            <Send size={13} /> {waiting ? `Send ${waiting} ${waiting === 1 ? "comment" : "comments"} to Claude` : "Tell Claude about your edits"}
          </button>
        )}
      </aside>
    </div>
  );
}

export function DocsPane({ ws }: { ws: Workspace }) {
  const docs = useStore((s) => s.docs[ws.id]);
  const sel = useStore((s) => s.docSel[ws.id]);
  const loadDocs = useStore((s) => s.loadDocs);
  const selectDoc = useStore((s) => s.selectDoc);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    loadDocs(ws.id).catch(() => {});
  }, [ws.id]);

  if (sel) return <DocView ws={ws} id={sel} />;
  async function create() {
    setCreating(true);
    try {
      const d = await api.post<Doc>(`/api/workspaces/${ws.id}/docs`, { title: "Untitled", body: "" });
      selectDoc(ws.id, d.id);
    } finally {
      setCreating(false);
    }
  }
  return (
    <div className="docs">
      <div className="docs-head">
        <span className="eyebrow">Docs in this workspace</span>
        <button className="btn b-outline sz-s" onClick={create} disabled={creating}>
          <FilePlus2 size={14} /> New doc
        </button>
      </div>
      {!docs ? (
        <div className="loading">Loading…</div>
      ) : docs.length === 0 ? (
        <OriEmpty pose="writing" title="No docs yet">
          <p>Ask Claude to write a plan, a spec or notes as a doc. You both edit it, and you comment on any passage.</p>
        </OriEmpty>
      ) : (
        <ul className="doc-list">
          {docs.map((d) => (
            <li key={d.id}>
              <button className="btn doc-row" onClick={() => selectDoc(ws.id, d.id)}>
                <FileText size={16} className="doc-row-icon" />
                <span className="doc-row-main">
                  <span className="doc-row-title">{d.title}</span>
                  <span className="doc-row-sub">
                    {d.updated_by === "agent" ? "Claude" : "You"}, {ago(d.updated_at)}
                    {d.body ? ` · ${d.body.split(/\s+/).filter(Boolean).length} words` : ""}
                  </span>
                </span>
                {(d.open ?? 0) > 0 && (
                  <span className="doc-row-open" data-tip="Open comments">
                    <MessageSquare size={12} /> {d.open}
                  </span>
                )}
                {d.updated_by === "agent" ? <Eye size={14} className="muted" /> : <CheckCheck size={14} className="muted" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
