import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, Check, ChevronDown, Copy, FileText, Globe, Image as ImageIcon, Loader2, RotateCcw } from "lucide-react";
import { useStore } from "../../lib/store";
import type { Block, Detail, Message, StreamBlock, Workspace } from "../../lib/types";
import { Markdown, ThoughtTrail, ToolCapsule, UiPanel, Widget } from "./Blocks";

interface Turn {
  role: "user" | "assistant";
  id: string;
  blocks: Block[];
  created_at: number;
}

/** Group raw messages into turns: one per user prompt, one per assistant run (tool results fold into capsules). */
function toTurns(messages: Message[]): Turn[] {
  const turns: Turn[] = [];
  for (const m of messages) {
    const isResults = m.role === "user" && m.content.every((b) => b.type === "tool_result");
    if (isResults) continue;
    const last = turns[turns.length - 1];
    if (m.role === "assistant" && last?.role === "assistant") last.blocks.push(...m.content);
    else turns.push({ role: m.role, id: m.id, blocks: [...m.content], created_at: m.created_at });
  }
  return turns;
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      className="btn b-ghost icon-btn sm"
      data-tip={ok ? "Copied" : "Copy"}
      aria-label="Copy"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1300);
      }}
    >
      {ok ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}

function UserTurn({ turn, onRetry }: { turn: Turn; onRetry: (text: string) => void }) {
  const raw = turn.blocks
    .filter((b) => b.type === "text" && !b.text?.startsWith("<attachment"))
    .map((b) => b.text)
    .join("\n");
  // a mission's request ends with a note to Claude; show it as a quiet label instead
  const mission = raw.match(/\n\n\[Orbit: this is the mission "([^"]*)"(?: \((?:started by its webhook|on its schedule)\))?[^\]]*\]$/);
  const text = mission ? raw.slice(0, mission.index) : raw;
  const how = raw.includes("(started by its webhook)") ? ", started by its webhook" : raw.includes("(on its schedule)") ? ", on its schedule" : "";
  const attachments = turn.blocks.filter((b) => b.type === "image" || b.type === "document" || b.text?.startsWith("<attachment"));
  return (
    <div className="turn you">
      <span className="acts">
        <CopyBtn text={text} />
        <button className="btn b-ghost icon-btn sm" data-tip="Send again" aria-label="Send again" onClick={() => onRetry(text)}>
          <RotateCcw size={15} />
        </button>
      </span>
      <div className="turn-body">
        {attachments.length > 0 && (
          <div className="attach-row">
            {attachments.map((a, i) =>
              a.type === "image" ? (
                <img key={i} className="attach-img" src={`data:${a.source.media_type};base64,${a.source.data}`} alt="Attached image" />
              ) : (
                <span key={i} className="chip chip-ro">
                  {a.type === "document" ? <FileText /> : <ImageIcon />} {a.type === "document" ? "PDF" : a.text?.match(/name="([^"]+)"/)?.[1] ?? "attachment"}
                </span>
              ),
            )}
          </div>
        )}
        {text && <p className="user-text">{text}</p>}
        {mission && (
          <span className="muted small mission-tag">
            Mission “{mission[1] || "untitled"}”{how}
          </span>
        )}
      </div>
    </div>
  );
}

interface Source {
  n: number;
  url: string;
  title: string;
}

/**
 * Turn raw blocks into what is drawn: neighbouring text joined into one piece
 * (the API splits it wherever a citation starts), citation numbers inline, and
 * each web search paired with its results.
 */
function prepare(blocks: (Block | StreamBlock)[], streaming?: boolean) {
  const sources = new Map<string, Source>();
  const items: ({ kind: "text"; text: string; live: boolean } | { kind: "search"; block: any; result?: any; live: boolean } | { kind: "block"; b: any; i: number; live: boolean })[] = [];
  blocks.forEach((b: any, i) => {
    if (!b) return;
    const live = !!streaming && i === blocks.length - 1;
    if (b.type === "text") {
      let t = b.text ?? "";
      for (const c of b.citations ?? []) {
        if (!c.url) continue;
        if (!sources.has(c.url)) sources.set(c.url, { n: sources.size + 1, url: c.url, title: c.title || c.url });
      }
      const marks = [...new Set((b.citations ?? []).map((c: any) => c.url).filter(Boolean))].map((u) => ` [${sources.get(u as string)!.n}](${u} "cite")`);
      t += marks.join("");
      const prev = items[items.length - 1];
      if (prev?.kind === "text") {
        prev.text += t;
        prev.live = live;
      } else if (t || live) items.push({ kind: "text", text: t, live });
      return;
    }
    if (b.type === "web_search_tool_result") {
      const s = [...items].reverse().find((x) => x.kind === "search" && x.block.id === b.tool_use_id) as any;
      if (s) s.result = b;
      return;
    }
    if (b.type === "server_tool_use") return items.push({ kind: "search", block: b, live });
    items.push({ kind: "block", b, i, live });
  });
  return { items, sources: [...sources.values()] };
}

function AssistantBlocks({ blocks, detail, streaming, wsId }: { blocks: (Block | StreamBlock)[]; detail: Detail; streaming?: boolean; wsId: string }) {
  const { items, sources } = prepare(blocks, streaming);
  return (
    <>
      {items.map((it, k) => {
        if (it.kind === "text")
          return (
            <div key={k} className="assistant-text">
              <Markdown text={it.text} />
              {it.live && <span className="caret" aria-hidden="true" />}
            </div>
          );
        if (it.kind === "search") return <WebSearchRow key={k} block={it.block} result={it.result} live={it.live} />;
        const b = it.b;
        if (b.type === "thinking") {
          const t = b.thinking ?? b.text ?? "";
          return <ThoughtTrail key={k} text={t} live={it.live} />;
        }
        if (b.type === "redacted_thinking") return null;
        if (b.type === "tool_use") {
          const call = b.id ? detail.calls[b.id] : undefined;
          const input = (b as Block).input;
          if (b.name === "ui_show" && input && call?.status !== "denied") return <UiPanel key={k} input={input} />;
          if (b.name === "ui_widget" && input && call?.status !== "denied") return <Widget key={k} input={input} />;
          return <ToolCapsule key={b.id ?? k} block={b as any} call={call} wsId={wsId} />;
        }
        return null;
      })}
      {sources.length > 0 && !streaming && <Sources sources={sources} />}
    </>
  );
}

function host(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Sources({ sources }: { sources: Source[] }) {
  return (
    <ol className="sources">
      {sources.map((s) => (
        <li key={s.url}>
          <a href={s.url} target="_blank" rel="noreferrer">
            <span className="src-n num">{s.n}</span>
            <span className="src-title">{s.title}</span>
            <span className="src-host">{host(s.url)}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

function WebSearchRow({ block, result, live }: { block: any; result?: any; live: boolean }) {
  const [open, setOpen] = useState(false);
  const query = block.input?.query ?? String(block.text ?? "").match(/"query"\s*:\s*"([^"]*)/)?.[1] ?? "";
  const list: any[] = Array.isArray(result?.content) ? result.content : [];
  const error = result && !Array.isArray(result.content) ? result.content?.error_code : null;
  return (
    <div className={`cap ${live || !result ? "running" : ""}`}>
      <button className="cap-row" onClick={() => setOpen(!open)} aria-expanded={open} disabled={!list.length}>
        <span className="cap-icon">{!result ? <Loader2 size={15} className="spin" /> : <Globe size={15} />}</span>
        <span className="cap-label">
          {result ? "Searched the web for" : "Searching the web for"} <q>{query}</q>
        </span>
        <span className="cap-meta">{error ? <span className="bad-text">{error.replace(/_/g, " ")}</span> : list.length ? `${list.length} results` : ""}</span>
        {list.length > 0 && <ChevronDown size={14} className={`chev ${open ? "up" : ""}`} />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul className="search-results" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            {list.map((r) => (
              <li key={r.url}>
                <a href={r.url} target="_blank" rel="noreferrer">
                  <span className="src-title">{r.title}</span>
                  <span className="src-host">
                    {host(r.url)}
                    {r.page_age ? `, ${r.page_age}` : ""}
                  </span>
                </a>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function AssistantTurn({ turn, detail, wsId }: { turn: Turn; detail: Detail; wsId: string }) {
  const text = turn.blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");
  return (
    <div className="turn claude">
      <span className="acts">{text && <CopyBtn text={text} />}</span>
      <div className="turn-body">
        <AssistantBlocks blocks={turn.blocks} detail={detail} wsId={wsId} />
      </div>
    </div>
  );
}

export function Stream({ ws, detail }: { ws: Workspace; detail: Detail }) {
  const stream = useStore((s) => s.streams[ws.id]);
  const send = useStore((s) => s.send);
  const scroller = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);
  const turns = useMemo(() => toTurns(detail.messages), [detail.messages]);

  // keep pinned to the bottom unless the reader scrolled up
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stuck) el.scrollTop = el.scrollHeight;
  });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const lastIsUser = turns[turns.length - 1]?.role === "user";
  const showStream = ws.running && (stream?.blocks.length || lastIsUser);

  return (
    <div className="stream" ref={scroller}>
      <div className="stream-inner">
        {ws.summary && (
          <details className="summary-card">
            <summary>Earlier work in this workspace was summarised</summary>
            <Markdown text={ws.summary} />
          </details>
        )}
        {turns.length === 0 && !ws.running && (
          <div className="empty-stream">
            <p className="display">What should happen here?</p>
            <p className="muted">
              Claude works in <span className="mono">{ws.cwd}</span> with a real shell. Anything that changes your machine passes the approval
              gate first.
            </p>
          </div>
        )}
        <AnimatePresence initial={false}>
          {turns.map((t) => (
            <motion.div key={t.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 260, damping: 26 }}>
              {t.role === "user" ? (
                <UserTurn turn={t} onRetry={(text) => send({ type: "send", workspaceId: ws.id, text })} />
              ) : (
                <AssistantTurn turn={t} detail={detail} wsId={ws.id} />
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        {showStream ? (
          <div className="turn claude live" aria-live="polite">
            <div className="turn-body">
              {stream?.blocks.length ? (
                <AssistantBlocks blocks={stream.blocks.filter(Boolean)} detail={detail} streaming wsId={ws.id} />
              ) : (
                <ThoughtTrail text="" live />
              )}
            </div>
          </div>
        ) : null}
      </div>
      <AnimatePresence>
        {!stuck && (
          <motion.button
            className="btn b-outline sz-s jump"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" })}
          >
            <ArrowDown size={15} /> Latest
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}


