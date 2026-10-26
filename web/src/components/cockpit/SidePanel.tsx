import { useEffect } from "react";
import { FileText, LayoutDashboard, MonitorPlay, Puzzle, X } from "lucide-react";
import { motion } from "motion/react";
import { useStore } from "../../lib/store";
import type { PanelTab, Workspace } from "../../lib/types";
import { PreviewPane } from "./Preview";
import { DocsPane } from "./Docs";
import { BoardPane } from "./Board";

export const PANEL_TABS: { id: PanelTab; label: string; Icon: typeof X }[] = [
  { id: "preview", label: "Preview", Icon: MonitorPlay },
  { id: "docs", label: "Docs", Icon: FileText },
  { id: "board", label: "Board", Icon: LayoutDashboard },
];

/** Which tabs this setup offers: docs and the board can be switched off in settings; plugins add their panels. */
export function useTabs() {
  const ui = useStore((s) => s.server?.config.ui_tools);
  const plugins = useStore((s) => s.plugins);
  useEffect(() => {
    if (!useStore.getState().plugins.length) useStore.getState().loadPlugins();
  }, []);
  const own = PANEL_TABS.filter((t) => (t.id === "docs" ? ui?.docs !== false : t.id === "board" ? ui?.whiteboard !== false : true));
  const extra = plugins
    .filter((p) => p.enabled && p.manifest && (p.state === "running" || !p.manifest.run))
    .flatMap((p) => p.manifest!.contributes.panels.map((x) => ({ id: `plugin:${p.id}:${x.id}` as PanelTab, label: x.title, Icon: Puzzle, src: `/plugins/${p.id}/${x.entry}` })));
  return [...own.map((t) => ({ ...t, src: "" })), ...extra];
}

function PluginPane({ ws, src, title }: { ws: Workspace; src: string; title: string }) {
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== location.origin || !e.data?.orbitPanel) return;
      const st = useStore.getState();
      if (e.data.type === "toast") st.toast({ title: String(e.data.title ?? title), body: e.data.body ? String(e.data.body) : undefined, tone: e.data.tone ?? "info" });
      if (e.data.type === "open" && e.data.workspace) st.setView({ kind: "ws", id: String(e.data.workspace) });
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [title]);
  return <iframe className="plugin-frame" title={title} src={`${src}?workspace=${encodeURIComponent(ws.id)}`} />;
}

/** Beside the conversation: what Claude builds, writes and lays out, each in its own tab. */
export function SidePanel({ ws, tab }: { ws: Workspace; tab: PanelTab }) {
  const openPanel = useStore((s) => s.openPanel);
  const fresh = useStore((s) => s.fresh[ws.id]);
  const tabs = useTabs();
  const current = tabs.some((t) => t.id === tab) ? tab : "preview";
  const plugin = tabs.find((t) => t.id === current && t.src);
  return (
    <section className="side-panel" aria-label="Side panel">
      <header className="sp-tabs" role="tablist" aria-label="Show">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={current === id}
            className={`btn sp-tab ${current === id ? "on" : ""}`}
            onClick={() => openPanel(ws.id, id)}
          >
            <Icon size={14} /> {label}
            {current === id && <motion.span layoutId={`sp-ul-${ws.id}`} className="sp-ul" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            {fresh?.[id] && current !== id && <span className="sp-dot" aria-label="new from Claude" />}
          </button>
        ))}
        <button className="btn b-ghost icon-btn sm sp-close" onClick={() => openPanel(ws.id, null)} aria-label="Hide the panel" data-tip="Hide" data-tip-side="bottom">
          <X size={15} />
        </button>
      </header>
      <div className="sp-body" role="tabpanel">
        {current === "preview" && <PreviewPane ws={ws} />}
        {current === "docs" && <DocsPane ws={ws} />}
        {current === "board" && <BoardPane ws={ws} />}
        {plugin && <PluginPane key={plugin.id} ws={ws} src={plugin.src} title={plugin.label} />}
      </div>
    </section>
  );
}
