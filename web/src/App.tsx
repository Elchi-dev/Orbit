import { useEffect, useRef } from "react";
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
import { Onboarding } from "./components/Onboarding";
import { Sky } from "./components/Sky";

function viewFromHash(): View {
  const m = location.hash.match(/^#\/w\/(\w+)/);
  return m ? { kind: "ws", id: m[1] } : { kind: "orrery" };
}

export function App() {
  const server = useStore((s) => s.server);
  const view = useStore((s) => s.view);
  const overlay = useStore((s) => s.overlay);
  const connected = useStore((s) => s.connected);
  const prevView = useRef<View>(view);

  useEffect(() => {
    (async () => {
      await ensureSession();
      await useStore.getState().loadServer();
      connectSocket();
      const v = viewFromHash();
      if (v.kind === "ws") useStore.getState().setView(v);
    })().catch(() => setTimeout(() => location.reload(), 2000));
    const onPop = () => {
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

  if (!server)
    return (
      <div className="boot">
        <Sky />
        <motion.div className="boot-orb" animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }} transition={{ repeat: Infinity, duration: 1.6 }} />
      </div>
    );

  if (!server.hasKey && !server.mock)
    return (
      <>
        <Sky />
        <Onboarding />
        <Toasts />
      </>
    );

  return (
    <>
      {view.kind === "ws" && <Sky />}
      <AnimatePresence mode="wait">
        {view.kind === "orrery" ? (
          <motion.div key="orrery" className="screen" initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.1 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
            <Home />
          </motion.div>
        ) : (
          <motion.div key={`ws-${view.id}`} className="screen" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
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
