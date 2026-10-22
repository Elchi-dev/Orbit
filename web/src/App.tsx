import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { WifiOff } from "lucide-react";
import { connectSocket, useStore, type View } from "./lib/store";
import { api, ensureSession } from "./lib/api";
import { Home } from "./components/orrery/Home";
import { Cockpit } from "./components/cockpit/Cockpit";
import { ApprovalEclipse } from "./components/Approval";
import { Settings } from "./components/Settings";
import { Palette } from "./components/Palette";
import { Toasts } from "./components/Toasts";
import { Welcome } from "./components/ori/Welcome";
import { Sky } from "./components/Sky";
import { OriSheet } from "./components/ori/OriSheet";
import { Tour, useGuideShortcut } from "./components/ori/Guide";
import { setFaviconState, waveFavicon } from "./lib/favicon";

// where the last click was, so a workspace grows out of the planet you clicked
let lastPoint: { x: number; y: number } | null = null;
if (typeof window !== "undefined") window.addEventListener("pointerdown", (e) => (lastPoint = { x: e.clientX, y: e.clientY }), true);
const zoomOrigin = () => (lastPoint ? `${lastPoint.x}px ${lastPoint.y}px` : "50% 50%");

function viewFromHash(): View {
  const m = location.hash.match(/^#\/w\/(\w+)/);
  return m ? { kind: "ws", id: m[1] } : { kind: "orrery" };
}

/**
 * #/open?path=/abs/folder&file=src/a.ts&line=12&text=... comes from `orbit <folder>`
 * and the editor extensions: find or make the workspace for that folder, and put any
 * text into its composer without sending it.
 */
async function handleOpenLink(): Promise<boolean> {
  if (!location.hash.startsWith("#/open?")) return false;
  const q = new URLSearchParams(location.hash.slice("#/open?".length));
  history.replaceState(null, "", "#/");
  const path = q.get("path");
  if (!path) return false;
  try {
    const ws = await api.post<{ id: string }>("/api/workspaces/open", { path });
    const file = q.get("file");
    const line = q.get("line");
    const end = q.get("end");
    const sel = q.get("text");
    let draft = "";
    if (file && sel) draft = `In \`${file}\`${line ? `, line${end && end !== line ? `s ${line} to ${end}` : ` ${line}`}` : ""}:\n\n\`\`\`\n${sel}\n\`\`\`\n\n`;
    else if (file) draft = `\`${file}\`${line ? ` line ${line}` : ""}: `;
    else if (sel) draft = sel;
    await useStore.getState().loadWorkspaces();
    if (draft) useStore.getState().setIncoming(ws.id, draft);
    useStore.getState().setView({ kind: "ws", id: ws.id });
    return true;
  } catch (e) {
    useStore.getState().toast({ title: "Couldn't open that folder", body: (e as Error).message, tone: "warn" });
    return false;
  }
}

export function App() {
  const server = useStore((s) => s.server);
  const view = useStore((s) => s.view);
  const overlay = useStore((s) => s.overlay);
  const connected = useStore((s) => s.connected);
  const prevView = useRef<View>(view);
  useGuideShortcut();
  // the tab: Ori waves once, then shows whether anything needs you or is running
  const approvals = useStore((s) => s.approvals.length);
  const busy = useStore((s) => Object.values(s.workspaces).some((w) => w.running));
  useEffect(() => waveFavicon(), []);
  useEffect(() => {
    setFaviconState(approvals ? "needs" : busy ? "working" : null);
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = approvals ? `(${approvals}) ${base}` : base;
  }, [approvals, busy]);
  const [welcome, setWelcome] = useState(() => location.hash === "#/welcome");
  useEffect(() => {
    const on = () => setWelcome(location.hash === "#/welcome");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  useEffect(() => {
    (async () => {
      await ensureSession();
      await useStore.getState().loadServer();
      connectSocket();
      if (await handleOpenLink()) return;
      const v = viewFromHash();
      if (v.kind === "ws") useStore.getState().setView(v);
    })().catch(() => setTimeout(() => location.reload(), 2000));
    const onPop = () => {
      if (location.hash.startsWith("#/open?")) {
        handleOpenLink();
        return;
      }
      const v = viewFromHash();
      useStore.setState({ view: v, drawer: null });
      if (v.kind === "ws") useStore.getState().loadDetail(v.id);
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onPop);
    // ask for notification permission on the first click, never on load
    const ask = () => {
      if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission();
      window.removeEventListener("pointerdown", ask);
    };
    window.addEventListener("pointerdown", ask);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useStore.getState().setOverlay(useStore.getState().overlay === "palette" ? null : "palette");
      } else if (mod && e.key === ",") {
        e.preventDefault();
        useStore.getState().setOverlay("settings");
      } else if (e.key === "Escape" && useStore.getState().overlay) {
        useStore.getState().setOverlay(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // incognito workspaces disappear when you leave them
  useEffect(() => {
    const prev = prevView.current;
    prevView.current = view;
    if (prev.kind === "ws" && !(view.kind === "ws" && view.id === prev.id)) {
      const w = useStore.getState().workspaces[prev.id];
      if (w?.incognito && !w.running) api.del(`/api/workspaces/${prev.id}?purge=1`).catch(() => {});
    }
  }, [view]);

  useEffect(() => {
    document.documentElement.dataset.motion = server?.config.ui.motion ?? "full";
  }, [server?.config.ui.motion]);

  if (location.hash === "#/ori") return <OriSheet />;

  if (!server)
    return (
      <div className="boot">
        <Sky />
        <motion.div className="boot-orb" animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }} transition={{ repeat: Infinity, duration: 1.6 }} />
      </div>
    );

  if ((!server.hasKey && !server.mock) || welcome)
    return (
      <>
        <Sky />
        <Welcome
          onDone={() => {
            setWelcome(false);
            if (location.hash.startsWith("#/welcome")) history.replaceState(null, "", "#/");
          }}
        />
        <Toasts />
      </>
    );

  return (
    <>
      {view.kind === "ws" && <Sky />}
      <AnimatePresence mode="wait">
        {view.kind === "orrery" ? (
          <motion.div key="orrery" className="screen" style={{ transformOrigin: zoomOrigin() }} initial={{ opacity: 0, scale: 1.15 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.6, transition: { duration: 0.32, ease: [0.55, 0, 0.75, 0.1] } }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
            <Home />
          </motion.div>
        ) : (
          <motion.div key={`ws-${view.id}`} className="screen" style={{ transformOrigin: zoomOrigin() }} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.22, ease: [0.55, 0, 0.75, 0.1] } }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
            <Cockpit id={view.id} />
          </motion.div>
        )}
      </AnimatePresence>
      <ApprovalEclipse />
      <AnimatePresence>
        {overlay === "settings" && <Settings key="settings" />}
        {overlay === "palette" && <Palette key="palette" />}
      </AnimatePresence>
      <Toasts />
      <Tour />
      <AnimatePresence>
        {!connected && (
          <motion.div className="offline glass pill" initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -40, opacity: 0 }}>
            <WifiOff size={15} /> Reconnecting to Orbit…
          </motion.div>
        )}
      </AnimatePresence>
      {server.mock && <div className="mock-tag pill">mock model</div>}
    </>
  );
}
