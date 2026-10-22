import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Circle, CircleDashed, Minus } from "lucide-react";
import type { Workspace } from "../../lib/types";

/** Claude's plan for the current task, a thin bar above the composer that opens into the checklist. */
export function PlanBar({ ws }: { ws: Workspace }) {
  const [open, setOpen] = useState(true);
  const plan = ws.plan ?? [];
  if (!plan.length) return null;
  const done = plan.filter((i) => i.status === "done" || i.status === "skipped").length;
  const doing = plan.find((i) => i.status === "doing");
  const finished = done === plan.length;
  return (
    <div className={`plan ${open ? "open" : ""}`}>
      <button className="plan-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="plan-meter" aria-hidden="true">
          <i style={{ width: `${(done / plan.length) * 100}%` }} />
        </span>
        <span className="plan-title">{finished ? "Plan done" : doing ? doing.text : "Plan"}</span>
        <span className="plan-count num">
          {done} of {plan.length}
        </span>
        <ChevronDown size={14} className={`chev ${open ? "" : "up"}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ol className="plan-list" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: "spring", stiffness: 320, damping: 34 }}>
            {plan.map((i, n) => (
              <li key={n} className={`plan-item s-${i.status}`}>
                <span className="plan-mark" aria-label={i.status}>
                  {i.status === "done" ? <Check size={13} /> : i.status === "doing" ? <CircleDashed size={13} className="spin-slow" /> : i.status === "skipped" ? <Minus size={13} /> : <Circle size={11} />}
                </span>
                <span className="plan-text">{i.text}</span>
              </li>
            ))}
          </motion.ol>
        )}
      </AnimatePresence>
    </div>
  );
}
