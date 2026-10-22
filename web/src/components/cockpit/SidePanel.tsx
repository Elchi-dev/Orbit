import { FileText, LayoutDashboard, MonitorPlay, X } from "lucide-react";
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

/** Which tabs this setup offers: docs and the board can be switched off in settings. */
export function useTabs() {
  const ui = useStore((s) => s.server?.config.ui_tools);
  return PANEL_TABS.filter((t) => (t.id === "docs" ? ui?.docs !== false : t.id === "board" ? ui?.whiteboard !== false : true));
}

/** Beside the conversation: what Claude builds, writes and lays out, each in its own tab. */
export function SidePanel({ ws, tab }: { ws: Workspace; tab: PanelTab }) {
  const openPanel = useStore((s) => s.openPanel);
  const fresh = useStore((s) => s.fresh[ws.id]);
  const tabs = useTabs();
  const current = tabs.some((t) => t.id === tab) ? tab : "preview";
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
      </div>
    </section>
  );
}
