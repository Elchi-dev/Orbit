import { AskOri } from "../ori/Guide";
import { Galaxy } from "../ui/Galaxy";
import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  BookOpen,
  Archive,
  ChevronUp,
  EyeOff,
  Folder,
  FolderOpen,
  Info,
  LayoutList,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Wallet,
  X,
  ArrowUpRight,
} from "lucide-react";
import { useStore } from "../../lib/store";
import { api } from "../../lib/api";
import { ago, money, shortPath, tokens } from "../../lib/format";
import type { Mode } from "../../lib/types";
import { Logo } from "../Logo";
import { ModeSwitch } from "../cockpit/ModeSwitch";
import { ProfilePicker } from "../profiles/ProfilePicker";
import { FolderPicker } from "../FolderPicker";
import { FlatOrrery, hasWebGL } from "./FlatOrrery";

/** If the 3D scene fails at runtime (lost context, driver error), show the flat sky instead of a blank page. */
class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.warn("Orbit: the 3D sky failed, showing the flat one", e);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const OrreryScene = lazy(() => import("./OrreryScene").then((m) => ({ default: m.OrreryScene })));

export function Home() {
  const workspaces = useStore((s) => s.workspaces);
  const server = useStore((s) => s.server);
  const approvals = useStore((s) => s.approvals);
  const setView = useStore((s) => s.setView);
  const setOverlay = useStore((s) => s.setOverlay);
  const createWorkspace = useStore((s) => s.createWorkspace);
  const send = useStore((s) => s.send);
  const motionPref = server?.config.ui.motion ?? "full";

  const list = useMemo(() => Object.values(workspaces).filter((w) => !w.archived && !w.parent_id), [workspaces]);
  const [text, setText] = useState("");
  const [opts, setOpts] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [cwd, setCwd] = useState("");
  const [incognito, setIncognito] = useState(false);
  const [mode, setMode] = useState<Mode>(server?.config.permissions.default_mode ?? "manual");
  // the profile for the next workspace, remembered in this browser
  const [profile, setProfile] = useState<string>(() => {
    try {
      return localStorage.getItem("orbit.profile") || server?.config.workspaces.default_profile || "pair";
    } catch {
      return server?.config.workspaces.default_profile || "pair";
    }
  });
  useEffect(() => {
    const p = server?.profiles.find((x) => x.id === profile);
    if (p) setMode(p.mode);
  }, [profile, server?.profiles]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (server) setMode(server.config.permissions.default_mode);
  }, [server?.config.permissions.default_mode]);

  // start typing anywhere to launch
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
      const t = e.target as HTMLElement;
      if (t.closest("input,textarea,select,[contenteditable]")) return;
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function launch(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const w = await createWorkspace({ cwd: cwd || undefined, incognito, mode, profile });
      setView({ kind: "ws", id: w.id });
      if (text.trim()) setTimeout(() => send({ type: "send", workspaceId: w.id, text: text.trim() }), 120);
      setText("");
      setOpts(false);
    } catch (err) {
      useStore.getState().toast({ title: "Couldn't create the workspace", body: (err as Error).message, tone: "bad" });
    } finally {
      setBusy(false);
    }
  }

  const empty = list.length === 0;

  return (
    <div className="home">
      <div className="home-canvas" data-tour="sky">
        {hasWebGL() ? (
          <SceneBoundary fallback={<FlatOrrery workspaces={list} onSelect={(id) => setView({ kind: "ws", id })} motion={motionPref} />}>
            <Suspense fallback={null}>
              <OrreryScene workspaces={list} onSelect={(id) => setView({ kind: "ws", id })} motion={motionPref} />
            </Suspense>
          </SceneBoundary>
        ) : (
          <FlatOrrery workspaces={list} onSelect={(id) => setView({ kind: "ws", id })} motion={motionPref} />
        )}
      </div>

      <AskOri nudge="sky" />

      <header className="home-top">
        <div className="brand">
          <Logo />
          <span className="wordmark brand-word">orbit</span>
          <span className="brand-meta">
            {list.length} {list.length === 1 ? "workspace" : "workspaces"}
            {approvals.length > 0 && <b className="need-text">, {approvals.length} need you</b>}
          </span>
        </div>
        <div className="top-actions">
          <button data-tour="search" className="btn b-ghost icon-btn glass-soft" data-tip="Search (Ctrl K)" data-tip-side="bottom" onClick={() => setOverlay("palette")} aria-label="Search">
            <Search size={18} />
          </button>
          <button data-tour="list" className="btn b-ghost icon-btn glass-soft" data-tip="All workspaces" data-tip-side="bottom" onClick={() => setListOpen(!listOpen)} aria-label="All workspaces" aria-expanded={listOpen}>
            <LayoutList size={18} />
          </button>
          <div className="peek" data-tour="budget">
            <button className="btn b-ghost sz-m glass-soft" aria-label="Spending">
              <Wallet size={17} />
              <span className="num">{money(server?.today.cost)}</span>
            </button>
            <div className="peek-card glass panel">
              <dl className="kv">
                <dt>Today</dt>
                <dd>{money(server?.today.cost)}, {tokens(server?.today.tokens)} tokens</dd>
                <dt>This month</dt>
                <dd>{money(server?.month.cost)}</dd>
                <dt>Daily budget</dt>
                <dd>{server?.config.budget.daily_usd ? money(server.config.budget.daily_usd) : "none"}</dd>
                {server?.rate?.tokens_limit ? (
                  <>
                    <dt>Rate limit left</dt>
                    <dd>{Math.round(((server.rate.tokens_remaining ?? 0) / server.rate.tokens_limit) * 100)}%</dd>
                  </>
                ) : null}
              </dl>
            </div>
          </div>
          <button className="btn b-ghost icon-btn glass-soft" data-tip="Library: skills and knowledge" data-tip-side="bottom" onClick={() => useStore.getState().openSettings("library")} aria-label="Library">
            <BookOpen size={18} />
          </button>
          <button data-tour="settings" className="btn b-ghost icon-btn glass-soft" data-tip="Settings" data-tip-side="bottom" onClick={() => setOverlay("settings")} aria-label="Settings">
            <Settings2 size={18} />
          </button>
        </div>
      </header>

      <AnimatePresence>
        {listOpen && (
          <motion.aside
            className="ws-list glass panel"
            initial={{ opacity: 0, x: 40, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
          >
            <div className="drawer-head">
              <h2>Workspaces</h2>
              <button className="btn b-ghost icon-btn sm" onClick={() => setListOpen(false)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="ws-rows">
              {list.length === 0 && <p className="muted">Nothing here yet. Start one below.</p>}
              {list
                .sort((a, b) => b.updated_at - a.updated_at)
                .map((w, n) => (
                  <div key={w.id} className="ws-row row-react rise" style={{ "--i": n } as any}>
                    <button className="ws-row-main" onClick={() => setView({ kind: "ws", id: w.id })}>
                      <span className="ws-dot" style={{ background: w.style?.color }} />
                      <span className="ws-row-text">
                        <span className="ws-row-title">
                          {w.title} {w.incognito ? <EyeOff size={13} /> : null}
                        </span>
                        <span className="ws-row-sub">
                          {shortPath(w.cwd, server?.home)}, {ago(w.updated_at)}
                        </span>
                      </span>
                      {w.pending > 0 && <AlertCircle size={16} className="need-text" />}
                    </button>
                    <button
                      className="btn b-ghost icon-btn sm"
                      data-tip="Archive"
                      aria-label="Archive"
                      onClick={() => useStore.getState().patchWorkspace(w.id, { archived: 1 } as any).then(() => useStore.getState().loadWorkspaces())}
                    >
                      <Archive size={15} />
                    </button>
                    <button
                      className="btn b-ghost icon-btn sm"
                      data-tip="Delete"
                      aria-label="Delete"
                      onClick={() => {
                        if (confirm(`Delete "${w.title}" and its history? Files in the folder stay.`)) api.del(`/api/workspaces/${w.id}`);
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <div className="home-bottom">
        <div className="launch-wrap">
          <AnimatePresence>
            {empty && (
              <motion.p className="launch-hint" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                Your first workspace starts here. Say what you want done.
              </motion.p>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {opts && (
              <motion.div
                className="launch-opts glass panel"
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.97 }}
                transition={{ type: "spring", stiffness: 300, damping: 26 }}
              >
                <div className="opt-row">
                  <span className="opt-label">
                    <Folder size={16} /> Folder
                  </span>
                  <FolderPicker value={cwd} onChange={setCwd} placeholder={`New folder in ${shortPath(server?.config.workspaces.home ?? "", server?.home)}`} />
                </div>
                <div className="opt-row">
                  <span className="opt-label">
                    <SlidersHorizontal size={16} /> Approvals
                  </span>
                  <ModeSwitch value={mode} onChange={setMode} />
                </div>
                <div className="opt-row">
                  <span className="opt-label">
                    <EyeOff size={16} /> Incognito
                  </span>
                  <span className="opt-help">Kept out of search and memory, deleted when you leave it</span>
                  <button className="switch" role="switch" aria-checked={incognito} aria-label="Incognito" onClick={() => setIncognito(!incognito)} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <form className="launch glass" onSubmit={launch} data-tour="launch">
            <button
              type="button"
              className={`btn b-ghost icon-btn ${opts ? "on" : ""}`}
              onClick={() => setOpts(!opts)}
              aria-label="Workspace options"
              aria-expanded={opts}
              data-tip="Folder, approvals, incognito"
            >
              {opts ? <ChevronUp size={18} /> : <FolderOpen size={18} />}
            </button>
            <ProfilePicker
              value={profile}
              up
              onChange={(p) => {
                setProfile(p.id);
                try {
                  localStorage.setItem("orbit.profile", p.id);
                } catch {}
              }}
            />
            {incognito && (
              <span className="chip chip-ro" title="Incognito">
                <EyeOff /> incognito
              </span>
            )}
            <label htmlFor="launch" className="sr">
              Start a new workspace
            </label>
            <input id="launch" ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder="What are we working on?" autoComplete="off" />
            <button type="submit" className="btn b-peach sz-l launch-go gbtn" disabled={busy}>
              <Galaxy />
              <span className="lbl">
                Launch <ArrowUpRight size={17} strokeWidth={2.4} />
              </span>
            </button>
          </form>
        </div>

        <div className="needs">
          <AnimatePresence>
            {approvals.slice(0, 3).map((a) => (
              <motion.button
                layout
                key={a.id}
                className="need-card glass"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 30 }}
                onClick={() => setView({ kind: "ws", id: a.workspaceId })}
              >
                <span className="need-orb">
                  <AlertCircle size={18} />
                </span>
                <span className="need-text-wrap">
                  <b>{workspaces[a.workspaceId]?.title ?? a.workspaceTitle} needs you</b>
                  <span className="need-sub">{a.subject.slice(0, 48)}</span>
                </span>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
