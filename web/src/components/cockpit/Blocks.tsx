import { memo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { AnimatePresence, motion } from "motion/react";
import {
  AppWindow,
  BookOpen,
  Boxes,
  Bell,
  Brain,
  Check,
  ChevronDown,
  Copy,
  FilePen,
  FilePlus2,
  FileText,
  FolderOpen,
  FolderSearch,
  Globe,
  Loader2,
  Orbit,
  PanelTop,
  SquareArrowOutUpRight,
  Pin,
  Terminal,
  TextSearch,
  Type,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ToolCall } from "../../lib/types";
import { useStore } from "../../lib/store";
import { openInEditor } from "../../lib/open";

// ---------- markdown ----------
function CodeBlock({ children, ...props }: any) {
  const [copied, setCopied] = useState(false);
  const text = extractText(children);
  return (
    <pre {...props}>
      <button
        className={`btn b-ghost icon-btn sm code-copy ${copied ? "done" : ""}`}
        aria-label="Copy code"
        data-tip={copied ? "Copied" : "Copy"}
        onClick={() => {
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
      {children}
    </pre>
  );
}
function extractText(node: any): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  return extractText(node.props?.children);
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          pre: CodeBlock,
          a: ({ title, children, ...p }) =>
            title === "cite" ? (
              <a {...p} className="cite" target="_blank" rel="noreferrer">
                {children}
              </a>
            ) : (
              <a {...p} title={title} target="_blank" rel="noreferrer" />
            ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

// ---------- thinking ----------
export function ThoughtTrail({ text, live }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text.trim() && !live) return null;
  return (
    <div className={`thought ${open ? "open" : ""}`}>
      <button className="btn b-ghost thought-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Brain size={15} className={live ? "pulse-icon" : ""} />
        <span>{live ? "Thinking" : "Thought trail"}</span>
        {live && (
          <span className="dots">
            <i />
            <i />
            <i />
          </span>
        )}
        <ChevronDown size={14} className={`chev ${open ? "up" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && text.trim() && (
          <motion.div
            className="thought-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
          >
            <Markdown text={text} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------- tools ----------
const TOOL_ICON: Record<string, LucideIcon> = {
  bash: Terminal,
  read_file: FileText,
  write_file: FilePlus2,
  edit_file: FilePen,
  list_dir: FolderOpen,
  glob: FolderSearch,
  grep: TextSearch,
  fetch_url: Globe,
  ui_set_title: Type,
  ui_set_planet: Orbit,
  ui_notify: Bell,
  ui_pin: Pin,
  ui_show: PanelTop,
  ui_widget: AppWindow,
  load_skill: BookOpen,
};

const base = (p: string) => (p ? p.split(/[\\/]/).filter(Boolean).slice(-2).join("/") : "");

export function toolLabel(name: string, input: any): ReactNode {
  const code = (s: string) => <code className="cap-code">{s}</code>;
  switch (name) {
    case "bash":
      return code(String(input?.command ?? "").split("\n")[0].slice(0, 140));
    case "read_file":
      return <>Read {code(base(input?.path))}</>;
    case "write_file":
      return <>Wrote {code(base(input?.path))}</>;
    case "edit_file":
      return <>Edited {code(base(input?.path))}</>;
    case "list_dir":
      return <>Looked in {code(base(input?.path) || "the folder")}</>;
    case "glob":
      return <>Found files matching {code(input?.pattern ?? "")}</>;
    case "grep":
      return <>Searched for {code(input?.pattern ?? "")}</>;
    case "fetch_url": {
      let host = input?.url ?? "";
      try {
        host = new URL(input.url).host;
      } catch {}
      return <>Fetched {code(host)}</>;
    }
    case "load_skill":
      return <>Loaded the skill {code(input?.name ?? "")}</>;
    case "ui_set_title":
      return <>Renamed the workspace to “{input?.title}”</>;
    case "ui_set_planet":
      return <>Restyled this planet</>;
    case "ui_notify":
      return <>Sent you a notification</>;
    case "ui_pin":
      return <>Pinned to memory: {input?.text}</>;
    case "ui_show":
      return <>{input?.title ?? "Showed a panel"}</>;
    case "ui_widget":
      return <>Built {input?.title ?? "a widget"}</>;
    default:
      if (name.startsWith("mcp__")) {
        const [, server, tool] = name.split("__");
        return (
          <>
            {server} {code(tool ?? "")}
          </>
        );
      }
      return <>{name}</>;
  }
}

// who let an action through, said in words; colour only marks the two states that matter: you, and refused
const VERDICT: Record<string, { label: string; tone: string }> = {
  readonly: { label: "read-only", tone: "quiet" },
  rule: { label: "your rule", tone: "quiet" },
  judge: { label: "judge", tone: "lav" },
  user: { label: "you", tone: "peach" },
  builtin: { label: "interface", tone: "quiet" },
  mode: { label: "blocked", tone: "bad" },
  full: { label: "full autonomy", tone: "quiet" },
};

function Verdict({ call }: { call?: ToolCall }) {
  if (!call) return <span className="vd quiet"><Loader2 size={12} className="spin" /> preparing</span>;
  if (call.status === "pending") return <span className="vd peach strong"><i /> waiting for you</span>;
  if (call.status === "judging") return <span className="vd lav"><i className="pulse" /> judge looking</span>;
  if (call.status === "denied") return <span className="vd bad"><i /> denied</span>;
  if (call.status === "cancelled") return <span className="vd bad"><i /> stopped</span>;
  const v = VERDICT[call.decided_by ?? ""] ?? { label: "allowed", tone: "quiet" };
  return (
    <span className={`vd ${v.tone}`} title={call.reason ?? undefined}>
      <i /> {v.label}
    </span>
  );
}

function ms(n: number | null) {
  if (n == null) return "";
  return n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`;
}

const FILE_TOOLS = new Set(["read_file", "write_file", "edit_file"]);

export function ToolCapsule({ block, call, wsId }: { block: { id?: string; name?: string; input?: any }; call?: ToolCall; wsId?: string }) {
  const live = useStore((s) => (block.id ? s.shellOut[block.id] : undefined));
  const running = call?.status === "running";
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICON[block.name ?? ""] ?? (block.name?.startsWith("mcp__") ? Boxes : Wrench);
  const input = block.input ?? (call ? safeJson(call.input) : {});
  const failed = call?.is_error && call.status === "error";
  const output = running ? live : call?.output;
  const showOpen = open || (running && !!live);
  return (
    <div className={`cap ${call?.status ?? "pending"} ${failed ? "failed" : ""}`}>
      <button className="cap-row" onClick={() => setOpen(!open)} aria-expanded={showOpen}>
        <span className="cap-icon">
          {running ? <Loader2 size={15} className="spin" /> : <Icon size={15} />}
        </span>
        <span className="cap-label">{toolLabel(block.name ?? "", input)}</span>
        <Verdict call={call} />
        <span className="cap-meta">
          {running ? null : failed ? (
            <span className="bad-text">failed</span>
          ) : call?.duration_ms != null ? (
            ms(call.duration_ms)
          ) : null}
        </span>
        <ChevronDown size={14} className={`chev ${showOpen ? "up" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {showOpen && (
          <motion.div
            className="cap-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 30 }}
          >
            <div className="cap-inner">
              {call?.reason && (
                <p className="cap-reason">
                  {call.reason}
                  {call.judge_ms ? <span className="muted"> ({ms(call.judge_ms)})</span> : null}
                </p>
              )}
              <ToolInput name={block.name ?? ""} input={input} />
              {FILE_TOOLS.has(block.name ?? "") && input?.path && wsId ? (
                <button className="btn b-outline sz-s cap-open" onClick={() => openInEditor(wsId, input.path, undefined, input.new_string ?? undefined)}>
                  <SquareArrowOutUpRight size={14} /> Open in editor
                </button>
              ) : null}
              {output ? <pre className="cap-out mono">{output}</pre> : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function ToolInput({ name, input }: { name: string; input: any }) {
  if (name === "bash") return input?.command?.includes("\n") ? <pre className="cap-cmd mono">{input.command}</pre> : null;
  if (name === "edit_file")
    return (
      <div className="diff mono">
        <div className="diff-path">{input?.path}</div>
        {String(input?.old_string ?? "")
          .split("\n")
          .slice(0, 40)
          .map((l, i) => (
            <div key={`o${i}`} className="diff-del">
              - {l}
            </div>
          ))}
        {String(input?.new_string ?? "")
          .split("\n")
          .slice(0, 40)
          .map((l, i) => (
            <div key={`n${i}`} className="diff-add">
              + {l}
            </div>
          ))}
      </div>
    );
  if (name === "write_file")
    return (
      <pre className="cap-cmd mono">
        {input?.path}
        {"\n\n"}
        {String(input?.content ?? "").slice(0, 3000)}
      </pre>
    );
  if (name.startsWith("ui_") || name === "bash") return null;
  return <pre className="cap-cmd mono">{JSON.stringify(input, null, 2)}</pre>;
}

// ---------- panels the AI draws ----------
export function UiPanel({ input }: { input: any }) {
  return (
    <motion.figure className="ui-panel" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 240, damping: 24 }}>
      <figcaption>
        {input?.title}
      </figcaption>
      {input?.kind === "chart" ? <Chart spec={input.content} /> : <Markdown text={String(input?.content ?? "")} />}
    </motion.figure>
  );
}

const SERIES = ["#B8A6FF", "#FFB199", "#8FE3C0", "#9FD8FF", "#FFD98F"];
function Chart({ spec }: { spec: string }) {
  let s: { type: "bar" | "line"; labels: string[]; series: { name: string; values: number[] }[] };
  try {
    s = typeof spec === "string" ? JSON.parse(spec) : spec;
  } catch {
    return <p className="muted">The chart data couldn't be read.</p>;
  }
  const W = 640,
    H = 260,
    L = 44,
    B = 34,
    T = 14;
  const all = s.series.flatMap((x) => x.values);
  // round the axis to 1, 2 or 5 times a power of ten, so ticks read 0, 50, 100, not 50.25
  const nice = (v: number) => {
    if (v <= 0) return 0;
    const p = 10 ** Math.floor(Math.log10(v));
    return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v)!;
  };
  const step = nice((Math.max(...all, 0) - Math.min(0, ...all)) / 4 || 1);
  const max = Math.ceil(Math.max(...all, 0) / step) * step || step;
  const min = Math.floor(Math.min(0, ...all) / step) * step;
  const n = s.labels.length;
  const y = (v: number) => T + (H - T - B) * (1 - (v - min) / (max - min));
  const bw = (W - L - 10) / Math.max(n, 1);
  const ticks = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => min + i * step);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Chart">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - 6} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,.07)" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="rgba(236,235,244,.5)">
              {Math.abs(t) >= 1000 ? `${(t / 1000).toFixed(1)}k` : +t.toFixed(2)}
            </text>
          </g>
        ))}
        {s.labels.map((l, i) => (
          <text key={l + i} x={L + bw * i + bw / 2} y={H - 12} textAnchor="middle" fontSize="11" fill="rgba(236,235,244,.55)">
            {l.length > 10 ? l.slice(0, 9) + "…" : l}
          </text>
        ))}
        {s.type === "line"
          ? s.series.map((ser, si) => (
              <g key={si}>
                <polyline
                  fill="none"
                  stroke={SERIES[si % SERIES.length]}
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  points={ser.values.map((v, i) => `${L + bw * i + bw / 2},${y(v)}`).join(" ")}
                  className="chart-line"
                />
                {ser.values.map((v, i) => (
                  <circle key={i} cx={L + bw * i + bw / 2} cy={y(v)} r="3.5" fill={SERIES[si % SERIES.length]}>
                    <title>{`${ser.name}: ${v}`}</title>
                  </circle>
                ))}
              </g>
            ))
          : s.series.map((ser, si) =>
              ser.values.map((v, i) => {
                const gw = (bw * 0.7) / s.series.length;
                const x = L + bw * i + bw * 0.15 + gw * si;
                return (
                  <rect key={`${si}-${i}`} className="chart-bar" x={x} y={Math.min(y(v), y(0))} width={gw - 2} height={Math.abs(y(v) - y(0))} rx="3" fill={SERIES[si % SERIES.length]}>
                    <title>{`${ser.name}: ${v}`}</title>
                  </rect>
                );
              }),
            )}
      </svg>
      {s.series.length > 1 && (
        <div className="legend">
          {s.series.map((x, i) => (
            <span key={x.name}>
              <i style={{ background: SERIES[i % SERIES.length] }} /> {x.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// no network for AI-built widgets: scripts and styles run inline only
const WIDGET_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:">`;

export function Widget({ input }: { input: any }) {
  return (
    <motion.figure className="ui-panel" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <figcaption>
        {input?.title}
      </figcaption>
      <iframe className="widget-frame" sandbox="allow-scripts" srcDoc={WIDGET_CSP + String(input?.html ?? "")} title={input?.title ?? "Widget"} />
    </motion.figure>
  );
}
