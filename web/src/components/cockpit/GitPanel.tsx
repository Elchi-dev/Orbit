import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, ArrowUp, Check, GitBranch, Loader2, Minus, PenLine, Plus, SquareArrowOutUpRight, Undo2 } from "lucide-react";
import { api } from "../../lib/api";
import { useStore } from "../../lib/store";
import { openInEditor } from "../../lib/open";
import type { Workspace } from "../../lib/types";

interface Change {
  path: string;
  from?: string;
  x: string;
  y: string;
}
export interface GitState {
  repo: boolean;
  installed: boolean;
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  staged?: Change[];
  changes?: Change[];
  conflicts?: Change[];
  branches?: string[];
  log?: { hash: string; subject: string; author: string; when: string }[];
}

const WORD: Record<string, string> = { M: "modified", A: "added", D: "deleted", R: "renamed", C: "copied", "?": "new", U: "conflict", T: "type changed" };

function Letter({ c }: { c: string }) {
  const l = c === "?" ? "N" : c;
  return (
    <span className={`git-letter l-${l}`} title={WORD[c] ?? c}>
      {l}
    </span>
  );
}

export function DiffView({ text }: { text: string }) {
  if (!text.trim()) return <p className="muted small git-nodiff">No text changes (a binary file, or only the mode changed).</p>;
  const lines = text.split("\n").filter((l) => !/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|similarity|rename )/.test(l));
  return (
    <div className="diff mono git-diff">
      {lines.slice(0, 600).map((l, i) => (
        <div key={i} className={l.startsWith("@@") ? "diff-hunk" : l.startsWith("+") ? "diff-add" : l.startsWith("-") ? "diff-del" : ""}>
          {l || " "}
        </div>
      ))}
      {lines.length > 600 && <div className="muted">{lines.length - 600} more lines</div>}
    </div>
  );
}

function FileRow({
  ws,
  c,
  staged,
  busy,
  act,
}: {
  ws: Workspace;
  c: Change;
  staged: boolean;
  busy: boolean;
  act: (action: string, body: object) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const letter = staged ? c.x : c.y === "?" ? "?" : c.y;
  const name = c.path.split("/").pop();
  const dir = c.path.slice(0, c.path.length - (name?.length ?? 0)).replace(/\/$/, "");
  useEffect(() => {
    if (!open) return;
    setDiff(null);
    api
      .get<{ diff: string }>(`/api/workspaces/${ws.id}/git/diff?path=${encodeURIComponent(c.path)}&staged=${staged ? 1 : 0}`)
      .then((r) => setDiff(r.diff))
      .catch((e) => setDiff(`(${(e as Error).message})`));
  }, [open, c.path, c.x, c.y, staged, ws.id]);
  return (
    <li className={`git-file ${open ? "open" : ""}`}>
      <div className="git-row">
        <button className="git-name" onClick={() => setOpen(!open)} aria-expanded={open} title={c.from ? `${c.path}, renamed from ${c.from}` : c.path}>
          <Letter c={letter} />
          <span className="git-base">{name}</span>
          <span className="git-dir">{dir}</span>
        </button>
        <span className="git-acts">
          <button className="btn b-ghost icon-btn sm" aria-label="Open in editor" data-tip="Open" onClick={() => openInEditor(ws.id, c.path)}>
            <SquareArrowOutUpRight size={14} />
          </button>
          {!staged && (
            <button className="btn b-ghost icon-btn sm" aria-label="Discard changes" data-tip="Discard" onClick={() => setConfirm(true)} disabled={busy}>
              <Undo2 size={14} />
            </button>
          )}
          <button
            className="btn b-ghost icon-btn sm"
            aria-label={staged ? "Unstage" : "Stage"}
            data-tip={staged ? "Unstage" : "Stage"}
            disabled={busy}
            onClick={() => act(staged ? "unstage" : "stage", { paths: [c.path] })}
          >
            {staged ? <Minus size={15} /> : <Plus size={15} />}
          </button>
        </span>
      </div>
      <AnimatePresence initial={false}>
        {confirm && (
          <motion.div className="git-confirm" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <span>{c.y === "?" ? "Delete this new file?" : "Throw away the changes to this file?"} This can't be undone.</span>
            <button className="btn b-danger sz-s" onClick={() => act("discard", { paths: [c.path] }).then(() => setConfirm(false))}>
              {c.y === "?" ? "Delete" : "Discard"}
            </button>
            <button className="btn b-ghost sz-s" onClick={() => setConfirm(false)}>
              Keep
            </button>
          </motion.div>
        )}
        {open && (
          <motion.div className="git-diff-wrap" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: "spring", stiffness: 300, damping: 32 }}>
            {diff === null ? <Loader2 size={15} className="spin muted" /> : <DiffView text={diff} />}
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

export function GitPanel({ ws, onCount }: { ws: Workspace; onCount?: (n: number) => void }) {
  const toast = useStore((s) => s.toast);
  const [st, setSt] = useState<GitState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [newBranch, setNewBranch] = useState<string | null>(null);
  const base = `/api/workspaces/${ws.id}/git`;
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const s = await api.get<GitState>(base);
      if (!alive.current) return;
      setSt(s);
      onCount?.((s.staged?.length ?? 0) + (s.changes?.length ?? 0));
    } catch {}
  }, [base, onCount]);

  // follow along while Claude works, and when you come back to the window
  useEffect(() => {
    alive.current = true;
    load();
    const t = setInterval(load, ws.running ? 2500 : 8000);
    window.addEventListener("focus", load);
    return () => {
      alive.current = false;
      clearInterval(t);
      window.removeEventListener("focus", load);
    };
  }, [load, ws.running]);

  async function act(action: string, body: object = {}, done?: string) {
    setBusy(action);
    try {
      const s = await api.post<GitState>(`${base}/${action}`, body);
      setSt(s);
      onCount?.((s.staged?.length ?? 0) + (s.changes?.length ?? 0));
      if (done) toast({ title: done, tone: "good" });
    } catch (e) {
      toast({ title: `git ${action} didn't work`, body: (e as Error).message, tone: "warn" });
      throw e;
    } finally {
      setBusy(null);
    }
  }

  async function draft() {
    setBusy("draft");
    try {
      const r = await api.post<{ message: string }>(`${base}/draft`);
      setMsg(r.message);
    } catch (e) {
      toast({ title: "No message written", body: (e as Error).message, tone: "warn" });
    } finally {
      setBusy(null);
    }
  }

  if (!st) return <Loader2 size={16} className="spin muted" />;
  if (!st.installed) return <p className="muted">Git isn't installed on this machine.</p>;
  if (!st.repo)
    return (
      <div className="git-empty">
        <p>This folder isn't a git repository.</p>
        <button className="btn b-lav sz-m" onClick={() => act("init", {}, "Repository created").catch(() => {})} disabled={!!busy}>
          <GitBranch size={16} /> Start one here
        </button>
      </div>
    );

  const staged = st.staged ?? [];
  const changes = st.changes ?? [];
  const conflicts = st.conflicts ?? [];
  const canCommit = (staged.length > 0 || changes.length > 0) && msg.trim() && !busy;

  return (
    <div className="git">
      <div className="git-head">
        {newBranch === null ? (
          <div className="field git-branch">
            <GitBranch size={15} className="field-icon" />
            <select
              value={st.branch}
              aria-label="Branch"
              onChange={(e) => {
                if (e.target.value === "__new") setNewBranch("");
                else act("switch", { branch: e.target.value }, `On ${e.target.value}`).catch(() => {});
              }}
            >
              {!st.branches?.includes(st.branch ?? "") && <option value={st.branch}>{st.branch}</option>}
              {st.branches?.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
              <option value="__new">New branch…</option>
            </select>
          </div>
        ) : (
          <form
            className="field git-branch"
            onSubmit={(e) => {
              e.preventDefault();
              act("branch", { branch: newBranch }, `On ${newBranch}`)
                .then(() => setNewBranch(null))
                .catch(() => {});
            }}
          >
            <GitBranch size={15} className="field-icon" />
            <input autoFocus value={newBranch} onChange={(e) => setNewBranch(e.target.value)} placeholder="feature/name" aria-label="New branch name" onKeyDown={(e) => e.key === "Escape" && setNewBranch(null)} />
          </form>
        )}
        <button className="btn b-ghost sz-s" onClick={() => act("pull", {}, "Pulled").catch(() => {})} disabled={!!busy || !st.upstream} data-tip={st.upstream ? `Pull from ${st.upstream}` : "No upstream yet"}>
          {busy === "pull" ? <Loader2 size={15} className="spin" /> : <ArrowDown size={15} />}
          {st.behind ? <span className="num">{st.behind}</span> : null}
        </button>
        <button className="btn b-ghost sz-s" onClick={() => act("push", {}, "Pushed").catch(() => {})} disabled={!!busy} data-tip={st.upstream ? `Push to ${st.upstream}` : "Push and set upstream"}>
          {busy === "push" ? <Loader2 size={15} className="spin" /> : <ArrowUp size={15} />}
          {st.ahead ? <span className="num">{st.ahead}</span> : null}
        </button>
      </div>

      <div className="git-commit">
        <textarea
          className="git-msg"
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          placeholder={staged.length ? "Commit message" : changes.length ? "Commit message (commits every change)" : "Nothing to commit"}
          rows={msg.includes("\n") ? 4 : 2}
          aria-label="Commit message"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canCommit)
              act("commit", { message: msg, all: !staged.length }, "Committed")
                .then(() => setMsg(""))
                .catch(() => {});
          }}
        />
        <div className="git-commit-bar">
          <button className="btn b-ghost sz-s" onClick={draft} disabled={!!busy || !staged.length} data-tip={staged.length ? "Claude reads the staged diff" : "Stage something first"}>
            {busy === "draft" ? <Loader2 size={14} className="spin" /> : <PenLine size={14} />} Write it for me
          </button>
          <button
            className="btn b-peach sz-s"
            disabled={!canCommit}
            onClick={() =>
              act("commit", { message: msg, all: !staged.length }, "Committed")
                .then(() => setMsg(""))
                .catch(() => {})
            }
          >
            <Check size={15} /> Commit {staged.length ? staged.length : changes.length} {(staged.length || changes.length) === 1 ? "file" : "files"}
          </button>
        </div>
      </div>

      {conflicts.length > 0 && (
        <section className="git-sec">
          <h3 className="need-text">Conflicts {conflicts.length}</h3>
          <ul className="git-list">
            {conflicts.map((c) => (
              <FileRow key={"c" + c.path} ws={ws} c={{ ...c, y: "U" }} staged={false} busy={!!busy} act={act} />
            ))}
          </ul>
        </section>
      )}
      {staged.length > 0 && (
        <section className="git-sec">
          <h3>
            Staged <span className="num">{staged.length}</span>
            <button className="btn b-ghost sz-s git-all" onClick={() => act("unstage", { paths: staged.map((c) => c.path) }).catch(() => {})} disabled={!!busy}>
              Unstage all
            </button>
          </h3>
          <ul className="git-list">
            {staged.map((c) => (
              <FileRow key={"s" + c.path} ws={ws} c={c} staged busy={!!busy} act={act} />
            ))}
          </ul>
        </section>
      )}
      <section className="git-sec">
        <h3>
          Changes <span className="num">{changes.length}</span>
          {changes.length > 0 && (
            <button className="btn b-ghost sz-s git-all" onClick={() => act("stage", { all: true }).catch(() => {})} disabled={!!busy}>
              Stage all
            </button>
          )}
        </h3>
        {changes.length === 0 ? (
          <p className="muted small">The folder matches the last commit{staged.length ? ", apart from what's staged" : ""}.</p>
        ) : (
          <ul className="git-list">
            {changes.map((c) => (
              <FileRow key={"w" + c.path} ws={ws} c={c} staged={false} busy={!!busy} act={act} />
            ))}
          </ul>
        )}
      </section>

      {st.log && st.log.length > 0 && (
        <section className="git-sec">
          <h3>Recent commits</h3>
          <ul className="git-log">
            {st.log.slice(0, 8).map((l) => (
              <li key={l.hash}>
                <span className="mono git-hash">{l.hash}</span>
                <span className="git-subject">{l.subject}</span>
                <span className="muted small git-when">{l.when}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
