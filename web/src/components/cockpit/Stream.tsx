import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, Check, Copy, FileText, Image as ImageIcon, RotateCcw } from "lucide-react";
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
  const text = turn.blocks
    .filter((b) => b.type === "text" && !b.text?.startsWith("<attachment"))
    .map((b) => b.text)
    .join("\n");
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
      </div>
    </div>
  );
}

function AssistantBlocks({ blocks, detail, streaming }: { blocks: (Block | StreamBlock)[]; detail: Detail; streaming?: boolean }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (!b) return null;
        const last = streaming && i === blocks.length - 1;
        if (b.type === "thinking") {
          const t = (b as any).thinking ?? (b as any).text ?? "";
          return <ThoughtTrail key={i} text={t} live={last} />;
        }
        if (b.type === "redacted_thinking") return null;
        if (b.type === "text") {
          const t = (b as any).text ?? "";
          if (!t && !last) return null;
          return (
            <div key={i} className="assistant-text">
              <Markdown text={t} />
              {last && <span className="caret" aria-hidden="true" />}
            </div>
          );
        }
        if (b.type === "tool_use") {
          const call = b.id ? detail.calls[b.id] : undefined;
          const input = (b as Block).input;
          if (b.name === "ui_show" && input && call?.status !== "denied") return <UiPanel key={i} input={input} />;
          if (b.name === "ui_widget" && input && call?.status !== "denied") return <Widget key={i} input={input} />;
          return <ToolCapsule key={b.id ?? i} block={b as any} call={call} />;
        }
        return null;
      })}
    </>
  );
}

function AssistantTurn({ turn, detail }: { turn: Turn; detail: Detail }) {
  const text = turn.blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");
  return (
    <div className="turn claude">
      <span className="acts">{text && <CopyBtn text={text} />}</span>
      <div className="turn-body">
        <AssistantBlocks blocks={turn.blocks} detail={detail} />
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
                <AssistantTurn turn={t} detail={detail} />
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        {showStream ? (
          <div className="turn claude live" aria-live="polite">
            <div className="turn-body">
              {stream?.blocks.length ? (
                <AssistantBlocks blocks={stream.blocks.filter(Boolean)} detail={detail} streaming />
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


