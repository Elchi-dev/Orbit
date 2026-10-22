import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Archive, BookOpen, CalendarClock, FileDiff, FileText, GitBranch, OctagonX, Pin, Plus, Settings2, Terminal, Trash2, Undo2, X, SquareArrowOutUpRight } from "lucide-react";
import { useStore, type Drawer } from "../../lib/store";
import { api } from "../../lib/api";
import { openInEditor } from "../../lib/open";
import type { Detail, Workspace } from "../../lib/types";
import { ago, shortPath } from "../../lib/format";
import { FolderPicker } from "../FolderPicker";
import { GitPanel, type GitState } from "./GitPanel";
import { MissionsPanel } from "./Missions";

const DOCK: { id: Exclude<Drawer, null>; label: string; Icon: typeof Terminal }[] = [
  { id: "shell", label: "Shell", Icon: Terminal },
  { id: "files", label: "Changed files", Icon: FileDiff },
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

function FilesDrawer({ ws, detail }: { ws: Workspace; detail?: Detail }) {
  const home = useStore((s) => s.server?.home);
  const snaps = detail?.snapshots ?? [];
  const pending = snaps.filter((s) => !s.restored);
  async function undo() {
    try {
      const r = await api.post<{ path: string }>(`/api/workspaces/${ws.id}/undo`);
      useStore.getState().toast({ title: "Change undone", body: shortPath(r.path, home), tone: "good" });
    } catch (e) {
      useStore.getState().toast({ title: "Nothing to undo", body: (e as Error).message, tone: "info" });
    }
  }
  return (
    <>
      <p className="muted small">Every file Claude writes or edits is saved first, so you can roll changes back one at a time.</p>
      <button className="btn b-lav sz-m" onClick={undo} disabled={!pending.length}>
        <Undo2 size={16} /> Undo the last change
      </button>
      <ul className="file-list">
        {snaps.length === 0 && <li className="muted">No changes yet.</li>}
        {snaps.map((s) => (
          <li key={s.id} className={`row-react ${s.restored ? "restored" : ""}`}>
            <FileDiff size={15} />
            <span className="mono file-path" title={s.path}>
              {shortPath(s.path, home)}
            </span>
            <span className="muted small">{s.restored ? "undone" : s.existed ? "edited" : "created"}</span>
            <button className="btn b-ghost icon-btn sm file-open" aria-label="Open in editor" data-tip="Open in editor" onClick={() => openInEditor(ws.id, s.path)}>
              <SquareArrowOutUpRight size={14} />
            </button>
          </li>
        ))}
      </ul>
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
