import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useStore } from "../lib/store";
import { Ori, type OriPose } from "./ori/Ori";

const POSE: Record<string, OriPose> = { info: "idle", good: "done", warn: "thinking", bad: "oops" };

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  const setView = useStore((s) => s.setView);
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => {
          return (
            <motion.div
              layout
              key={t.id}
              className={`toast glass tone-${t.tone}`}
              initial={{ opacity: 0, x: 80, scale: 0.94 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 80, scale: 0.96, transition: { duration: 0.18, ease: [0.55, 0, 0.75, 0.1] } }}
              transition={{ type: "spring", stiffness: 340, damping: 24 }}
            >
              <span className="toast-ori">
                <Ori pose={POSE[t.tone] ?? "idle"} size={40} />
              </span>
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
