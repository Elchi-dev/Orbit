import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Bell, CheckCircle2, OctagonAlert, X } from "lucide-react";
import { useStore } from "../lib/store";

const ICON = { info: Bell, good: CheckCircle2, warn: AlertTriangle, bad: OctagonAlert };

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  const setView = useStore((s) => s.setView);
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = ICON[t.tone];
          return (
            <motion.div
              layout
              key={t.id}
              className={`toast glass tone-${t.tone}`}
              initial={{ opacity: 0, x: 60, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 300, damping: 26 }}
            >
              <Icon size={18} className="toast-icon" />
              <button className="toast-text" onClick={() => t.workspaceId && setView({ kind: "ws", id: t.workspaceId })}>
                <b>{t.title}</b>
                {t.body && <span>{t.body}</span>}
              </button>
              <button className="btn b-ghost icon-btn sm" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                <X size={14} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
