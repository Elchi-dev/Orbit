import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, ChevronRight, EyeOff, Folder, Pencil, Sparkles, SquareArrowOutUpRight } from "lucide-react";
import { useStore } from "../../lib/store";
import { ProfilePicker } from "../profiles/ProfilePicker";
import { PlanBar } from "./PlanBar";
import { AgentIcon, HelperBar } from "./Helpers";
import { agentLabel } from "../../lib/helpers";
import { PreviewPane } from "./Preview";
import { openInEditor } from "../../lib/open";
import { shortPath, tokens } from "../../lib/format";
import { Logo } from "../Logo";
import { Stream } from "./Stream";
import { Composer } from "./Composer";
import { Hud } from "./Hud";
import { ModeSwitch } from "./ModeSwitch";
import { Dock, DrawerHost } from "./Drawers";

function Title({ id, title }: { id: string; title: string }) {
  const patch = useStore((s) => s.patchWorkspace);
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState(title);
  useEffect(() => setVal(title), [title]);
  if (edit)
    return (
      <form
        className="title-edit"
        onSubmit={(e) => {
          e.preventDefault();
          setEdit(false);
          if (val.trim() && val !== title) patch(id, { title: val.trim() });
        }}
      >
        <label htmlFor="ws-title" className="sr">
          Workspace title
        </label>
        <input id="ws-title" autoFocus value={val} onChange={(e) => setVal(e.target.value)} onBlur={() => setEdit(false)} />
      </form>
    );
  return (
    <button className="btn title-btn" onClick={() => setEdit(true)} aria-label="Rename workspace">
      <AnimatePresence mode="wait">
        <motion.span key={title} className="title-text" initial={{ opacity: 0, y: 8, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -8 }}>
          {title}
        </motion.span>
      </AnimatePresence>
      <Pencil size={14} className="title-pen" />
    </button>
  );
}

/** "Context collapse": a short burst when the history is cleared. */
function ClearedBurst() {
  const [freed, setFreed] = useState<number | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      setFreed((e as CustomEvent).detail.freed ?? 0);
      setTimeout(() => setFreed(null), 2200);
    };
    window.addEventListener("orbit:cleared", on);
    return () => window.removeEventListener("orbit:cleared", on);
  }, []);
  return (
    <AnimatePresence>
      {freed != null && (
        <motion.div className="burst" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.span className="burst-core" initial={{ scale: 3, opacity: 0 }} animate={{ scale: [3, 0.2, 1], opacity: [0, 1, 1] }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }} />
          <motion.p initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.6 }}>
            <Sparkles size={16} /> History cleared{freed ? `, ${tokens(freed)} tokens freed` : ""}
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Cockpit({ id }: { id: string }) {
  const ws = useStore((s) => s.workspaces[id]);
  const detail = useStore((s) => s.details[id]);
  const server = useStore((s) => s.server);
  const previewOpen = useStore((s) => s.previewOpen[id]);
  const hasPreview = useStore((s) => !!s.previews[id]?.url);
  // how much of the width the conversation takes when the preview is open
  const [split, setSplit] = useState<number>(() => {
    try {
      return Number(localStorage.getItem("orbit.split")) || 46;
    } catch {
      return 46;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("orbit.split", String(split));
    } catch {}
  }, [split]);
  const startDrag = (e: React.PointerEvent) => {
    const main = (e.currentTarget as HTMLElement).parentElement!;
    const rect = main.getBoundingClientRect();
    const move = (ev: PointerEvent) => setSplit(Math.min(72, Math.max(28, ((ev.clientX - rect.left) / rect.width) * 100)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("dragging");
    };
    document.body.classList.add("dragging");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const approvals = useStore((s) => s.approvals);
  const workspaces = useStore((s) => s.workspaces);
  const setView = useStore((s) => s.setView);
  const patch = useStore((s) => s.patchWorkspace);
  const send = useStore((s) => s.send);
  const lastEsc = useRef(0);

  // Esc once stops, Esc twice within a second kills the shell too
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !ws?.running || useStore.getState().overlay) return;
      const t = Date.now();
      if (t - lastEsc.current < 900) send({ type: "kill", workspaceId: id });
      else send({ type: "stop", workspaceId: id });
      lastEsc.current = t;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ws?.running, id]);

  if (!ws) return <div className="loading">Loading the workspace…</div>;
  const profileOfWs = server?.profiles.find((p) => p.id === ws.profile);
  const showPreview = previewOpen ?? !!(profileOfWs?.preview || hasPreview);
  const layout = server?.profiles.find((p) => p.id === ws.profile)?.layout ?? "log";
  // a helper's questions are answered here too, so they don't count as another workspace
  const others = approvals.filter((a) => a.workspaceId !== id && a.parentId !== id && !(ws.parent_id && a.workspaceId === ws.parent_id));
  const parent = ws.parent_id ? workspaces[ws.parent_id] : undefined;

  return (
    <div className={`cockpit layout-${layout}`}>
      <header className="cockpit-top">
        <nav className="crumbs" aria-label="Location">
          <button className="btn b-ghost home-btn" onClick={() => setView({ kind: "orrery" })} data-tip="Back to the Orrery" data-tip-side="bottom" aria-label="Back to all workspaces">
            <Logo />
          </button>
          {parent ? (
            <>
              <button className="btn b-ghost sz-s crumb-parent" onClick={() => setView({ kind: "ws", id: parent.id })} data-tip="Back to the workspace that sent it" data-tip-side="bottom">
                <span className="planet-dot" style={{ background: parent.style?.color }} aria-hidden="true" />
                <span>{parent.title}</span>
              </button>
              <ChevronRight size={14} className="crumb-sep" aria-hidden="true" />
              <span className="helper-chip">
                <AgentIcon agent={ws.agent} size={13} /> {agentLabel(ws.agent)}
              </span>
            </>
          ) : (
            <span className="planet-dot" style={{ background: ws.style?.color }} aria-hidden="true" />
          )}
          <Title id={ws.id} title={ws.title} />
          {ws.incognito ? (
            <span className="chip chip-ro" title="Incognito: deleted when you leave">
              <EyeOff /> incognito
            </span>
          ) : null}
          <button className="btn b-ghost sz-s cwd-btn" onClick={() => useStore.getState().setDrawer("workspace")} data-tip="Change folder" data-tip-side="bottom">
            <Folder size={14} /> <span>{shortPath(ws.cwd, server?.home)}</span>
          </button>
          {server?.config.integrations.editor !== "none" && (
            <button className="btn b-ghost icon-btn sm open-folder" onClick={() => openInEditor(ws.id)} aria-label="Open the folder in your editor" data-tip="Open in editor" data-tip-side="bottom">
              <SquareArrowOutUpRight size={15} />
            </button>
          )}
        </nav>
        <div className="cockpit-actions">
          <ProfilePicker value={ws.profile} compact onChange={(p) => patch(ws.id, { profile: p.id, mode: p.mode } as any)} />
          <ModeSwitch value={ws.mode} onChange={(mode) => patch(ws.id, { mode })} compact />
          <Hud ws={ws} detail={detail} />
        </div>
      </header>

      <AnimatePresence>
        {others.length > 0 && (
          <motion.button
            className="others-banner glass pill btn"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            onClick={() => setView({ kind: "ws", id: others[0].workspaceId })}
          >
            <AlertCircle size={16} /> {others.length === 1 ? `${others[0].workspaceTitle ?? "Another workspace"} needs you` : `${others.length} other workspaces need you`}
          </motion.button>
        )}
      </AnimatePresence>

      <main className={`cockpit-main ${showPreview ? "split" : ""}`} style={showPreview ? ({ "--split": `${split}%` } as any) : undefined}>
        <div className="work">
          {detail ? <Stream ws={ws} detail={detail} /> : <div className="loading">Loading…</div>}
          {ws.parent_id && <HelperBar ws={ws} />}
          <PlanBar ws={ws} />
          <Composer ws={ws} />
        </div>
        {showPreview && (
          <>
            <div
              className="split-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the preview"
              tabIndex={0}
              onPointerDown={startDrag}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") setSplit((v) => Math.max(28, v - 3));
                if (e.key === "ArrowRight") setSplit((v) => Math.min(72, v + 3));
              }}
            />
            <PreviewPane ws={ws} onClose={() => useStore.getState().setPreviewOpen(ws.id, false)} />
          </>
        )}
      </main>
      <Dock ws={ws} detail={detail} />
      <DrawerHost ws={ws} detail={detail} />
      <ClearedBurst />
    </div>
  );
}
