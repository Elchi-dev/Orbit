import { useTabs } from "./SidePanel";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Archive, BookOpen, CalendarClock, Check, FileDiff, FileText, GitBranch, Loader2, MonitorPlay, OctagonX, Pin, Plus, Settings2, SquareArrowOutUpRight, Terminal, Trash2, Undo2, X } from "lucide-react";
import { useStore, type Drawer } from "../../lib/store";
import { api } from "../../lib/api";
import { openInEditor } from "../../lib/open";
import type { Detail, Workspace } from "../../lib/types";
import { ago, shortPath } from "../../lib/format";
import { FolderPicker } from "../FolderPicker";
import { DiffView, GitPanel, type GitState } from "./GitPanel";
import { MissionsPanel } from "./Missions";

const DOCK: { id: Exclude<Drawer, null>; label: string; Icon: typeof Terminal }[] = [
  { id: "shell", label: "Shell", Icon: Terminal },
  { id: "files", label: "Review changes", Icon: FileDiff },
  { id: "git", label: "Git", Icon: GitBranch },
  { id: "missions", label: "Missions", Icon: CalendarClock },
  { id: "memory", label: "Memory shelf", Icon: Pin },
  { id: "workspace", label: "Workspace settings", Icon: Settings2 },
];

export function Dock({ ws, detail }: { ws: Workspace; detail?: Detail }) {
  const drawer = useStore((s) => s.drawer);
  const setDrawer = useStore((s) => s.setDrawer);
  const calls = Object.values(detail?.calls ?? {});
  const [gitCount, setGitCount] = useState(0);
  const previewOpen = useStore((s) => s.previewOpen[ws.id]);
  const hasPreview = useStore((s) => !!s.previews[ws.id]?.url);
  const profilePreview = useStore((s) => !!s.server?.profiles.find((p) => p.id === ws.profile)?.preview);
  const previewShown = previewOpen ?? (profilePreview || hasPreview);
  const panelTab = useStore((s) => s.panelTab[ws.id]);
  const fresh = useStore((s) => s.fresh[ws.id]);
  const tabs = useTabs();
  // how many files differ from the last commit; refreshed when a run ends
  useEffect(() => {
    if (ws.running) return;
    api
      .get<GitState>(`/api/workspaces/${ws.id}/git`)
      .then((s) => setGitCount((s.staged?.length ?? 0) + (s.changes?.length ?? 0)))
      .catch(() => setGitCount(0));
  }, [ws.id, ws.running, drawer]);
  const badges: Record<string, number | boolean> = {
    git: gitCount,
    shell: calls.some((c) => c.name === "bash" && c.status === "running"),
    files: (detail?.snapshots ?? []).filter((s) => !s.restored).length,
    memory: detail?.pins.length ?? 0,
  };
  return (
    <nav className="dock glass-soft" aria-label="Panels">
      {DOCK.map(({ id, label, Icon }) => (
        <button
          key={id}
          className={`btn b-ghost icon-btn dock-btn ${drawer === id ? "on" : ""}`}
          onClick={() => setDrawer(id)}
          aria-label={label}
          aria-pressed={drawer === id}
          data-tip={label}
          data-tip-side="left"
        >
          <Icon size={19} />
          {badges[id] === true && <span className="badge live" />}
          {typeof badges[id] === "number" && (badges[id] as number) > 0 && <span className="badge">{badges[id] as number}</span>}
        </button>
      ))}
      <span className="dock-sep" aria-hidden="true" />
      {tabs.map(({ id, label, Icon }) => {
        const on = previewShown && (panelTab ?? "preview") === id;
        const dot = id === "preview" ? hasPreview && !previewShown : !!fresh?.[id];
        return (
          <button
            key={id}
            className={`btn b-ghost icon-btn dock-btn ${on ? "on" : ""}`}
            onClick={() => useStore.getState().openPanel(ws.id, on ? null : id)}
            aria-label={label}
            aria-pressed={on}
            data-tip={on ? `Hide ${label.toLowerCase()}` : label}
            data-tip-side="left"
          >
            <Icon size={19} />
            {dot && <span className="badge live" />}
          </button>
        );
      })}
      {ws.running && (
        <button
          className="btn b-ghost icon-btn dock-btn kill"
          onClick={() => useStore.getState().send({ type: "kill", workspaceId: ws.id })}
          aria-label="Kill switch"
          data-tip="Kill switch: stop and end the shell"
          data-tip-side="left"
        >
          <OctagonX size={19} />
        </button>
      )}
    </nav>
  );
}

export function DrawerHost({ ws, detail }: { ws: Workspace; detail?: Detail }) {
  const drawer = useStore((s) => s.drawer);
  const setDrawer = useStore((s) => s.setDrawer);
  const title = DOCK.find((d) => d.id === drawer)?.label;
  return (
    <AnimatePresence mode="wait">
      {drawer && (
        <motion.aside
          key={drawer}
          className="drawer glass panel"
          initial={{ opacity: 0, x: 48, scale: 0.97 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 48, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 260, damping: 26 }}
          aria-label={title}
        >
          <div className="drawer-head">
            <h2>{title}</h2>
            <button className="btn b-ghost icon-btn sm" onClick={() => setDrawer(null)} aria-label="Close">
              <X size={16} />
            </button>
          </div>
          <div className="drawer-body">
            {drawer === "shell" && <ShellDrawer ws={ws} detail={detail} />}
            {drawer === "files" && <FilesDrawer ws={ws} detail={detail} />}
            {drawer === "git" && <GitPanel ws={ws} />}
            {drawer === "missions" && <MissionsPanel ws={ws} />}
            {drawer === "memory" && <MemoryDrawer ws={ws} detail={detail} />}
            {drawer === "workspace" && <WorkspaceDrawer ws={ws} />}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function ShellDrawer({ ws, detail }: { ws: Workspace; detail?: Detail }) {
  const shellOut = useStore((s) => s.shellOut);
  const cmds = Object.values(detail?.calls ?? {})
    .filter((c) => c.name === "bash")
    .sort((a, b) => a.created_at - b.created_at)
    .slice(-30);
  return (
    <>
      <p className="muted small">One shared shell for this workspace, so folders and variables carry over between commands.</p>
      <div className="term mono">
        {cmds.length === 0 && <span className="muted">No commands yet.</span>}
        {cmds.map((c) => {
          const input = JSON.parse(c.input || "{}");
          const out = c.status === "running" ? shellOut[c.id] : c.output;
          return (
            <div key={c.id} className={`term-cmd ${c.status}`}>
              <div className="term-line">
                <span className="term-prompt">$</span> {input.command}
              </div>
              {out && <pre className="term-out">{out.slice(-4000)}</pre>}
              {c.status === "denied" && <div className="term-denied">not run: {c.reason}</div>}
            </div>
          );
        })}
      </div>
      <button className="btn b-danger sz-m" onClick={() => useStore.getState().send({ type: "kill", workspaceId: ws.id })}>
        <OctagonX size={16} /> Kill the shell
      </button>
    </>
  );
}

interface FileReview {
  path: string;
  status: "created" | "edited" | "deleted";
  edits: number;
  since: number;
  added: number;
  removed: number;
  diff: string;
  binary: boolean;
}

/** Every file Claude changed here, against how it was before; keep the change or put the file back. */
function FilesDrawer({ ws, detail }: { ws: Workspace; detail?: Detail }) {
  const home = useStore((s) => s.server?.home);
  const toast = useStore((s) => s.toast);
  const [files, setFiles] = useState<FileReview[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const base = `/api/workspaces/${ws.id}/review`;
  const snapKey = (detail?.snapshots ?? []).map((s) => `${s.id}${s.restored}`).join(",");
  useEffect(() => {
    api.get<FileReview[]>(base).then(setFiles).catch(() => setFiles([]));
  }, [base, snapKey, ws.running]);
  const act = async (what: "keep" | "undo", body: object, done: string) => {
    try {
      setFiles(await api.post<FileReview[]>(`${base}/${what}`, body));
      toast({ title: done, tone: "good" });
    } catch (e) {
      toast({ title: "That didn't work", body: (e as Error).message, tone: "warn" });
    }
  };
  if (!files) return <Loader2 size={16} className="spin muted" />;
  const short = (p: string) => (p.startsWith(ws.cwd) ? p.slice(ws.cwd.length).replace(/^[\\/]/, "") : shortPath(p, home));
  return (
    <>
      <p className="muted small">
        Each file Claude changed, compared with how it was before its first change. Keep the change, or put the file back. Every version stays in the
        undo journal.
      </p>
      {files.length === 0 ? (
        <p className="muted">Nothing to review. Changes Claude makes show up here.</p>
      ) : (
        <>
          <div className="rev-bar">
            <span className="num muted small">
              {files.length} {files.length === 1 ? "file" : "files"}, <span className="rev-add">+{files.reduce((n, f) => n + f.added, 0)}</span>{" "}
              <span className="rev-del">−{files.reduce((n, f) => n + f.removed, 0)}</span>
            </span>
            <span className="grow" />
            {confirmAll ? (
              <>
                <span className="small">Undo every change here?</span>
                <button className="btn b-danger sz-s" onClick={() => act("undo", { all: true }, "Every file is back").then(() => setConfirmAll(false))}>
                  Undo all
                </button>
                <button className="btn b-ghost sz-s" onClick={() => setConfirmAll(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button className="btn b-ghost sz-s" onClick={() => setConfirmAll(true)} disabled={ws.running}>
                  <Undo2 size={14} /> Undo all
                </button>
                <button className="btn b-lav sz-s" onClick={() => act("keep", { all: true }, "Kept every change")}>
                  <Check size={14} /> Keep all
                </button>
              </>
            )}
          </div>
          <ul className="git-list">
            {files.map((f) => {
              const name = short(f.path);
              const isOpen = open === f.path;
              return (
                <li key={f.path} className={`git-file ${isOpen ? "open" : ""}`}>
                  <div className="git-row">
                    <button className="git-name" onClick={() => setOpen(isOpen ? null : f.path)} aria-expanded={isOpen} title={f.path}>
                      <span className={`git-letter l-${f.status === "created" ? "N" : f.status === "deleted" ? "D" : "M"}`}>{f.status === "created" ? "N" : f.status === "deleted" ? "D" : "M"}</span>
                      <span className="git-base">{name}</span>
                      <span className="git-dir num">
                        <span className="rev-add">+{f.added}</span> <span className="rev-del">−{f.removed}</span>
                        {f.edits > 1 ? `, ${f.edits} edits` : ""}
                      </span>
                    </button>
                    <span className="git-acts rev-acts">
                      <button className="btn b-ghost icon-btn sm" aria-label="Open in editor" data-tip="Open" onClick={() => openInEditor(ws.id, f.path)} disabled={f.status === "deleted"}>
                        <SquareArrowOutUpRight size={14} />
                      </button>
                      <button className="btn b-ghost icon-btn sm" aria-label="Undo this file" data-tip="Put it back" onClick={() => act("undo", { path: f.path }, `${name} is back`)} disabled={ws.running}>
                        <Undo2 size={14} />
                      </button>
                      <button className="btn b-ghost icon-btn sm" aria-label="Keep this file" data-tip="Keep" onClick={() => act("keep", { path: f.path }, `Kept ${name}`)}>
                        <Check size={15} />
                      </button>
                    </span>
                  </div>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div className="git-diff-wrap" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                        {f.binary ? <p className="muted small">A binary file; open it to compare.</p> : <DiffView text={f.diff} />}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}

function MemoryDrawer({ ws, detail }: { ws: Workspace; detail?: Detail }) {
  const [text, setText] = useState("");
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    await api.post(`/api/workspaces/${ws.id}/pins`, { text });
    setText("");
  };
  return (
    <>
      <p className="muted small">Pinned facts are sent with every message in this workspace. Claude can pin things too.</p>
      <form className="field" onSubmit={add}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Something Claude should always know here" aria-label="New pin" />
        <button className="btn b-ghost icon-btn sm" aria-label="Add pin" data-tip="Pin">
          <Plus size={16} />
        </button>
      </form>
      <ul className="pin-list">
        <AnimatePresence initial={false}>
          {(detail?.pins ?? []).map((p) => (
            <motion.li key={p.id} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="row-react">
              <Pin size={15} className="lav-text" />
              <span>{p.text}</span>
              <button className="btn b-ghost icon-btn sm" aria-label="Remove pin" onClick={() => api.del(`/api/workspaces/${ws.id}/pins/${p.id}`)}>
                <Trash2 size={14} />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {ws.summary && (
        <div className="summary-mini">
          <h3>Summary of cleared history</h3>
          <p className="small">{ws.summary.slice(0, 1200)}</p>
        </div>
      )}
    </>
  );
}

interface ContextInfo {
  files: { path: string; chars: number; cut: boolean }[];
  skills: { name: string; description: string; source: string; dir: string }[];
}

/** What Claude reads from the folder besides your messages: instruction files and skills. */
function ContextList({ ws }: { ws: Workspace }) {
  const [info, setInfo] = useState<ContextInfo | null>(null);
  useEffect(() => {
    api.get<ContextInfo>(`/api/workspaces/${ws.id}/context`).then(setInfo).catch(() => {});
  }, [ws.id, ws.cwd]);
  if (!info) return null;
  return (
    <div className="ctx-list">
      <span className="form-label">Read from the folder</span>
      {info.files.length === 0 ? (
        <p className="muted small">No AGENTS.md, CLAUDE.md or editor rules here. Add one and Claude follows it.</p>
      ) : (
        <ul className="file-list">
          {info.files.map((f) => (
            <li key={f.path} className="row-react">
              <FileText size={15} />
              <span className="mono file-path">{f.path}</span>
              <span className="muted small num">{f.cut ? "cut to 20k" : f.chars < 1000 ? `${f.chars} chars` : `${Math.round(f.chars / 1000)}k chars`}</span>
              <button className="btn b-ghost icon-btn sm file-open" aria-label="Open in editor" data-tip="Open in editor" onClick={() => openInEditor(ws.id, f.path)}>
                <SquareArrowOutUpRight size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="form-label">Skills</span>
      {info.skills.length === 0 ? (
        <p className="muted small">None found in .claude/skills, ~/.orbit/skills or ~/.claude/skills.</p>
      ) : (
        <ul className="file-list">
          {info.skills.map((s) => (
            <li key={s.name} className="row-react" title={s.dir}>
              <BookOpen size={15} />
              <span className="ctx-skill">
                <b>{s.name}</b>
                <span className="muted small">{s.description}</span>
              </span>
              <span className="muted small">{s.source === "project" ? "this project" : s.source === "claude" ? "~/.claude" : "Orbit"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WorkspaceDrawer({ ws }: { ws: Workspace }) {
  const server = useStore((s) => s.server);
  const patch = useStore((s) => s.patchWorkspace);
  const setView = useStore((s) => s.setView);
  const [form, setForm] = useState({ cwd: ws.cwd, system_prompt: ws.system_prompt, judge_notes: ws.judge_notes, model: ws.model ?? "" });
  const [saved, setSaved] = useState(false);
  useEffect(() => setForm({ cwd: ws.cwd, system_prompt: ws.system_prompt, judge_notes: ws.judge_notes, model: ws.model ?? "" }), [ws.id]);
  const models = Object.keys(server?.config.pricing ?? {});
  const save = async () => {
    await patch(ws.id, { ...form, model: form.model || null } as any);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  return (
    <div className="form">
      <label className="form-label">Folder</label>
      <FolderPicker value={form.cwd} onChange={(cwd) => setForm({ ...form, cwd })} />
      <label className="form-label" htmlFor="ws-model">
        Model
      </label>
      <div className="field">
        <select id="ws-model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}>
          <option value="">Default ({server?.config.models.pilot})</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <label className="form-label" htmlFor="ws-instr">
        Instructions for this workspace
      </label>
      <div className="field">
        <textarea id="ws-instr" rows={4} value={form.system_prompt} onChange={(e) => setForm({ ...form, system_prompt: e.target.value })} placeholder="e.g. Use pnpm. Never touch the migrations folder." />
      </div>
      <label className="form-label" htmlFor="ws-judge">
        Notes for the judge here
      </label>
      <div className="field">
        <textarea id="ws-judge" rows={3} value={form.judge_notes} onChange={(e) => setForm({ ...form, judge_notes: e.target.value })} placeholder="e.g. rm -rf inside ./build is fine" />
      </div>
      <button className="btn b-lav sz-m" onClick={save}>
        {saved ? "Saved" : "Save"}
      </button>
      <ContextList ws={ws} />
      <hr className="sep" />
      <p className="muted small">
        Created {ago(ws.created_at)}. {ws.incognito ? "Incognito: deleted when you leave." : ""}
      </p>
      <button
        className="btn b-danger sz-m"
        onClick={async () => {
          if (!confirm(`Delete "${ws.title}" and its history? Files in the folder stay where they are.`)) return;
          await api.del(`/api/workspaces/${ws.id}`);
          setView({ kind: "orrery" });
        }}
      >
        <Trash2 size={16} /> Delete workspace
      </button>
      <button className="btn b-ghost sz-m" onClick={() => patch(ws.id, { archived: 1 } as any).then(() => setView({ kind: "orrery" }))}>
        <Archive size={16} /> Archive and go home
      </button>
    </div>
  );
}
