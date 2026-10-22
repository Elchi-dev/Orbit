import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, CheckCheck, MessageSquareText, Scale, ShieldQuestion, X } from "lucide-react";
import { useStore } from "../lib/store";
import { agentLabel } from "../lib/helpers";
import type { Approval as A } from "../lib/types";

function headline(a: A) {
  switch (a.name) {
    case "bash":
      return "Claude wants to run a command";
    case "write_file":
      return "Claude wants to write a file";
    case "edit_file":
      return "Claude wants to edit a file";
    case "fetch_url":
      return "Claude wants to open a web address";
    default:
      return `Claude wants to use ${a.name}`;
  }
}

export function ApprovalEclipse() {
  const view = useStore((s) => s.view);
  const approvals = useStore((s) => s.approvals);
  const send = useStore((s) => s.send);
  // a helper's questions come up in its parent as well as in its own view
  const here = (a: A) => view.kind === "ws" && (a.workspaceId === view.id || a.parentId === view.id);
  const current = approvals.find(here);
  const queued = approvals.filter(here).length;
  const [pattern, setPattern] = useState("");
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);

  useEffect(() => {
    setPattern(current?.suggestion ?? current?.subject ?? "");
    setNote("");
    setShowNote(false);
  }, [current?.id]);

  const answer = (decision: "allow" | "deny" | "always") => {
    if (!current) return;
    send({ type: "approval", id: current.id, decision, pattern: decision === "always" ? pattern : undefined, note: decision === "deny" && note ? `You denied it: ${note}` : undefined });
  };

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input,textarea") || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === "y") answer("allow");
      else if (k === "n") answer("deny");
      else if (k === "a") answer("always");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current?.id, pattern, note]);

  return (
    <AnimatePresence>
      {current && (
        <motion.div className="eclipse-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
          <div className="eclipse-dim" />
          <motion.div className="eclipse-orb" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ type: "spring", stiffness: 180, damping: 18 }}>
            <span className="eclipse-rays" />
          </motion.div>
          <motion.section
            key={current.id}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ask-title"
            className="eclipse glass"
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 220, damping: 24 }}
          >
            <span className="eclipse-ws">
              <ShieldQuestion size={15} />{" "}
              {current.parentId ? (
                <span className="approval-helper">
                  {agentLabel(current.agent)} helper, {current.workspaceTitle}
                  {view.kind === "ws" && view.id !== current.parentId ? `, for ${current.parentTitle}` : ""}
                </span>
              ) : (
                current.workspaceTitle
              )}{" "}
              {queued > 1 && <span className="muted">, {queued - 1} more waiting</span>}
            </span>
            <h1 id="ask-title" className="display">
              {headline(current)}
            </h1>
            <pre className="eclipse-cmd mono">{current.name === "bash" ? current.input?.command : current.subject}</pre>
            {current.name === "edit_file" && (
              <div className="diff mono small-diff">
                {String(current.input?.old_string ?? "")
                  .split("\n")
                  .slice(0, 8)
                  .map((l, i) => (
                    <div key={`o${i}`} className="diff-del">
                      - {l}
                    </div>
                  ))}
                {String(current.input?.new_string ?? "")
                  .split("\n")
                  .slice(0, 8)
                  .map((l, i) => (
                    <div key={`n${i}`} className="diff-add">
                      + {l}
                    </div>
                  ))}
              </div>
            )}
            {current.judge ? (
              <div className="eclipse-why">
                <Scale size={16} />
                <p>
                  <b>The judge wasn't sure.</b> {current.judge.reason}
                </p>
              </div>
            ) : (
              <div className="eclipse-why">
                <ShieldQuestion size={16} />
                <p>Manual mode: you approve anything that isn't read-only or covered by one of your rules.</p>
              </div>
            )}
            <div className="eclipse-actions">
              <button className="btn b-peach sz-l" onClick={() => answer("allow")} autoFocus>
                <Check size={18} /> Allow once <kbd>Y</kbd>
              </button>
              <button className="btn b-outline sz-l" onClick={() => answer("always")}>
                <CheckCheck size={18} /> Always allow <kbd>A</kbd>
              </button>
              <button className="btn b-ghost sz-l deny-btn" onClick={() => answer("deny")}>
                <X size={18} /> Deny <kbd>N</kbd>
              </button>
              <button className={`btn b-ghost icon-btn ${showNote ? "on" : ""}`} onClick={() => setShowNote(!showNote)} aria-label="Add a reason" data-tip="Tell Claude why">
                <MessageSquareText size={18} />
              </button>
            </div>
            <div className="eclipse-rule">
              <label htmlFor="always-pattern">Always allow saves this rule for the workspace:</label>
              <div className="field">
                <input id="always-pattern" className="mono" value={pattern} onChange={(e) => setPattern(e.target.value)} spellCheck={false} />
              </div>
            </div>
            <AnimatePresence>
              {showNote && (
                <motion.div className="field" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                  <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why not? Claude reads this and tries another way" aria-label="Reason for denying" />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
