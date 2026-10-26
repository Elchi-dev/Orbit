import { useState } from "react";
import { motion } from "motion/react";
import { Accessibility, ChevronDown, Gauge, Send, X } from "lucide-react";
import { Ori } from "../ori/Ori";

export interface Report {
  target: string;
  width: number;
  perf: {
    fcp: number | null;
    lcp: number | null;
    load: number | null;
    tbt: number;
    cls: number;
    domNodes: number;
    requests: number;
    bytes: { total: number; js: number; css: number; image: number; font: number; other: number };
    verdict: { lcp: string; cls: string; tbt: string };
    largest: { url: string; bytes: number; kind: string }[];
  };
  a11y: { rule: string; title: string; wcag: string; impact: string; count: number; examples: { selector: string; text: string; detail?: string }[] }[];
  console: string[];
  notes: string[];
}

const kb = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const tone = (v: string) => (v === "good" ? "good" : v === "poor" ? "bad" : v === "unknown" ? "quiet" : "warn");

/** The result of a performance and accessibility check, over the preview. */
export function CheckReportView({ r, onClose, onFix }: { r: Report; onClose: () => void; onFix: () => void }) {
  const [open, setOpen] = useState<string | null>(r.a11y[0]?.rule ?? null);
  const problems = r.a11y.reduce((n, i) => n + i.count, 0);
  const metric = (label: string, value: string, v: string, help: string) => (
    <div className={`ck-metric t-${tone(v)}`} title={help}>
      <span className="small muted">{label}</span>
      <b className="num">{value}</b>
      <span className="ck-verdict">{v}</span>
    </div>
  );
  const parts = (["js", "css", "image", "font", "other"] as const).filter((k) => r.perf.bytes[k] > 0);
  return (
    <motion.aside className="ck glass panel" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24, transition: { duration: 0.14 } }} transition={{ type: "spring", stiffness: 300, damping: 30 }} aria-label="Check results">
      <header className="ck-head">
        <Ori pose={problems ? (problems > 5 ? "oops" : "thinking") : "done"} size={44} />
        <div>
          <b>
            {r.target} at {r.width} px
          </b>
          <span className="muted small">{problems ? `${problems} accessibility ${problems === 1 ? "problem" : "problems"}` : "No accessibility problems found"}</span>
        </div>
        <button className="btn b-ghost icon-btn sm" onClick={onClose} aria-label="Close">
          <X size={15} />
        </button>
      </header>
      <div className="ck-body">
        <h4>
          <Gauge size={14} /> Speed
        </h4>
        <div className="ck-metrics">
          {metric("Largest paint", r.perf.lcp != null ? `${(r.perf.lcp / 1000).toFixed(2)} s` : "?", r.perf.verdict.lcp, "When the biggest thing on screen appears. Good under 2.5 s.")}
          {metric("Layout shift", String(r.perf.cls), r.perf.verdict.cls, "How much the page jumps while loading. Good under 0.1.")}
          {metric("Blocking", `${r.perf.tbt} ms`, r.perf.verdict.tbt, "Time the page couldn't respond to input. Good under 200 ms.")}
        </div>
        <div className="ck-bytes" aria-label={`Page weight ${kb(r.perf.bytes.total)}`}>
          <div className="ck-bar">
            {parts.map((k) => (
              <i key={k} className={`b-${k}`} style={{ flexGrow: r.perf.bytes[k] }} title={`${k} ${kb(r.perf.bytes[k])}`} />
            ))}
          </div>
          <span className="small muted">
            {kb(r.perf.bytes.total)} in {r.perf.requests} requests:{" "}
            {parts.map((k, i) => (
              <span key={k}>
                <span className={`ck-dot b-${k}`} /> {k === "js" ? "JS" : k === "css" ? "CSS" : k} {kb(r.perf.bytes[k])}
                {i < parts.length - 1 ? ", " : ""}
              </span>
            ))}
          </span>
        </div>

        <h4>
          <Accessibility size={14} /> Accessibility
        </h4>
        {r.a11y.length === 0 ? (
          <p className="small muted">The automatic checks found nothing. Try it with Tab and a screen reader too.</p>
        ) : (
          <ul className="ck-issues">
            {r.a11y.map((i) => (
              <li key={i.rule} className={`ck-issue i-${i.impact}`}>
                <button className="btn ck-issue-head" onClick={() => setOpen(open === i.rule ? null : i.rule)} aria-expanded={open === i.rule}>
                  <span className="ck-impact" />
                  <span className="ck-issue-title">{i.title}</span>
                  <span className="num muted small">{i.count}</span>
                  <ChevronDown size={14} className={`pl-chev ${open === i.rule ? "on" : ""}`} />
                </button>
                {open === i.rule && (
                  <div className="ck-ex small">
                    <span className="muted">WCAG {i.wcag}</span>
                    {i.examples.map((e, n) => (
                      <code key={n}>
                        {e.selector}
                        {e.detail ? `  ${e.detail}` : ""}
                      </code>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {r.console.length > 0 && (
          <>
            <h4>Console</h4>
            <pre className="ck-console">{r.console.join("\n")}</pre>
          </>
        )}
        <p className="small muted ck-note">{r.notes[0]}</p>
      </div>
      {(problems > 0 || r.perf.verdict.lcp !== "good" || r.perf.verdict.tbt !== "good" || r.perf.verdict.cls !== "good") && (
        <footer className="ck-foot">
          <button className="btn b-peach sz-s" onClick={onFix}>
            <Send size={13} /> Ask Claude to fix these
          </button>
        </footer>
      )}
    </motion.aside>
  );
}
