import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { FileDiff, FastForward, Pause, Play, SkipBack, SkipForward, Terminal, X } from "lucide-react";
import { api } from "../../lib/api";
import { Ori, type OriPose } from "../ori/Ori";
import { poseForTool } from "../../lib/ori";
import { Markdown } from "../cockpit/Blocks";
import { DiffView } from "../cockpit/GitPanel";

type Ev =
  | { t: number; lane: string; kind: "message"; id: string; role: "user" | "assistant"; text: string; thinking: boolean }
  | { t: number; lane: string; kind: "tool"; id: string; name: string; subject: string; decided_by: string | null; reason: string | null; status: string; ms: number; output: string }
  | { t: number; lane: string; kind: "file"; id: number; path: string; status: "created" | "edited" | "deleted"; diff: string; added: number; removed: number };
interface Data {
  workspace: { id: string; title: string; cwd: string };
  lanes: { id: string; title: string; agent: string | null }[];
  start: number;
  end: number;
  events: Ev[];
}

const SPEEDS = [1, 2, 4, 8];
/** waits longer than this play as this long when idle time is skipped */
const CAP = 1500;
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const keyOf = (e: Ev) => `${e.kind}:${e.id}`;

/** Real time to play time and back, with long waits squeezed when asked. */
function timeline(d: Data, skip: boolean) {
  const keys = [...new Set([d.start, ...d.events.flatMap((e) => (e.kind === "tool" ? [e.t, e.t + e.ms] : [e.t])), d.end])].sort((a, b) => a - b);
  const play = [0];
  for (let i = 1; i < keys.length; i++) play.push(play[i - 1] + (skip ? Math.min(keys[i] - keys[i - 1], CAP) : keys[i] - keys[i - 1]));
  const toPlay = (real: number) => {
    if (real <= keys[0]) return 0;
    for (let i = 1; i < keys.length; i++)
      if (real <= keys[i]) {
        const span = keys[i] - keys[i - 1] || 1;
        return play[i - 1] + ((real - keys[i - 1]) / span) * (play[i] - play[i - 1]);
      }
    return play[play.length - 1];
  };
  const toReal = (p: number) => {
    if (p <= 0) return keys[0];
    for (let i = 1; i < play.length; i++)
      if (p <= play[i]) {
        const span = play[i] - play[i - 1] || 1;
        return keys[i - 1] + ((p - play[i - 1]) / span) * (keys[i] - keys[i - 1]);
      }
    return keys[keys.length - 1];
  };
  return { length: play[play.length - 1], toPlay, toReal };
}

function poseAt(e: Ev | undefined, running: boolean): OriPose {
  if (!e) return "idle";
  if (e.kind === "tool") return running ? poseForTool(e.name).pose : e.status === "denied" || e.status === "error" ? "oops" : poseForTool(e.name).pose;
  if (e.kind === "file") return "writing";
  return e.role === "user" ? "hi" : e.thinking && !e.text ? "thinking" : "working";
}

/** Watch a finished run happen again. */
export function Replay({ wsId, onClose }: { wsId: string; onClose: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [skip, setSkip] = useState(true);
  const [speed, setSpeed] = useState(2);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pinned, setPinned] = useState<string | null>(null);
  useEffect(() => {
    api.get<Data>(`/api/workspaces/${wsId}/replay`).then(setData).catch((e) => setErr((e as Error).message));
  }, [wsId]);
  const tl = useMemo(() => (data ? timeline(data, skip) : null), [data, skip]);
  const realNow = tl && data ? tl.toReal(pos) : 0;

  // keep the place when switching between real and squeezed time
  const lastReal = useRef(0);
  useEffect(() => {
    lastReal.current = realNow;
  }, [realNow]);
  useEffect(() => {
    if (tl) setPos(tl.toPlay(lastReal.current));
  }, [skip]);

  // play
  useEffect(() => {
    if (!playing || !tl) return;
    let last = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const dt = (now - last) * speed;
      last = now;
      setPos((p) => {
        const n = Math.min(tl.length, p + dt);
        if (n >= tl.length) setPlaying(false);
        return n;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, tl]);

  const shown = useMemo(() => (data ? data.events.filter((e) => e.t <= realNow) : []), [data, realNow]);
  const current = pinned ? data?.events.find((e) => keyOf(e) === pinned) : shown[shown.length - 1];
  const running = !!(current && current.kind === "tool" && realNow < current.t + current.ms);

  // keys: space, arrows, escape
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!data || !tl) return;
      if (e.key === "Escape") return onClose();
      if (e.key === " ") {
        e.preventDefault();
        if (pos >= tl.length) setPos(0);
        setPlaying((p) => !p);
      }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        setPlaying(false);
        setPinned(null);
        const times = data.events.map((x) => tl.toPlay(x.t));
        const next = e.key === "ArrowRight" ? times.find((t) => t > pos + 1) : [...times].reverse().find((t) => t < pos - 1);
        setPos(next ?? (e.key === "ArrowRight" ? tl.length : 0));
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [data, tl, pos]);

  const lanes = data ? data.lanes.filter((l) => data.events.some((e) => e.lane === l.id)) : [];
  const toolState = (e: Ev & { kind: "tool" }) => (realNow < e.t + e.ms ? "running" : e.status);

  return (
    <motion.div className="replay" role="dialog" aria-modal="true" aria-label="Replay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <header className="rp-head">
        <Ori pose={poseAt(current, running)} size={44} />
        <div className="rp-title">
          <b>Replay: {data?.workspace.title ?? "..."}</b>
          <span className="muted small">
            {data ? `${data.events.length} steps, ${lanes.length > 1 ? `${lanes.length - 1} ${lanes.length === 2 ? "helper" : "helpers"}, ` : ""}${clock(data.end - data.start)} in all` : err || "Loading"}
          </span>
        </div>
        <button className="btn b-ghost icon-btn" onClick={onClose} aria-label="Close replay">
          <X size={18} />
        </button>
      </header>

      {data && tl && (
        <>
          <div className="rp-main">
            <div className="rp-lanes" style={{ gridTemplateColumns: `repeat(${Math.max(1, lanes.length)}, minmax(260px, 1fr))` }}>
              {lanes.map((l) => (
                <Lane
                  key={l.id}
                  title={l.id === data.workspace.id ? "This workspace" : `${l.agent ?? "helper"}: ${l.title}`}
                  cwd={data.workspace.cwd}
                  events={shown.filter((e) => e.lane === l.id)}
                  current={current ? keyOf(current) : null}
                  toolState={toolState}
                  pick={(e) => {
                    setPinned(keyOf(e));
                    setPlaying(false);
                  }}
                />
              ))}
            </div>
            <aside className="rp-detail" aria-live="polite">
              {current ? <Detail e={current} state={current.kind === "tool" ? toolState(current) : ""} /> : <p className="muted small">Press play, or drag the timeline.</p>}
            </aside>
          </div>

          <footer className="rp-bar">
            <div className="rp-transport">
              <button className="btn b-ghost icon-btn" aria-label="Back to the start" onClick={() => (setPos(0), setPinned(null))}>
                <SkipBack size={16} />
              </button>
              <button
                className="btn b-peach icon-btn rp-play"
                aria-label={playing ? "Pause" : "Play"}
                onClick={() => {
                  if (pos >= tl.length) setPos(0);
                  setPinned(null);
                  setPlaying((p) => !p);
                }}
              >
                {playing ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <button
                className="btn b-ghost icon-btn"
                aria-label="Next step"
                onClick={() => {
                  setPinned(null);
                  const next = data.events.map((x) => tl.toPlay(x.t)).find((t) => t > pos + 1);
                  setPos(next ?? tl.length);
                }}
              >
                <SkipForward size={16} />
              </button>
              <span className="num small rp-clock">
                {clock(realNow - data.start)} / {clock(data.end - data.start)}
              </span>
            </div>
            <div className="rp-scrub">
              <div className="rp-ticks" aria-hidden="true">
                {lanes.map((l, li) => (
                  <div key={l.id} className="rp-tickrow">
                    {data.events
                      .filter((e) => e.lane === l.id)
                      .map((e) => (
                        <i
                          key={keyOf(e)}
                          className={`rp-tick k-${e.kind} ${e.kind === "message" ? `r-${e.role}` : ""} ${e.kind === "tool" && (e.status === "denied" || e.status === "error") ? "bad" : ""}`}
                          style={{ left: `${(tl.toPlay(e.t) / tl.length) * 100}%`, width: e.kind === "tool" ? `max(3px, ${((tl.toPlay(e.t + e.ms) - tl.toPlay(e.t)) / tl.length) * 100}%)` : undefined, top: li * 0 }}
                        />
                      ))}
                  </div>
                ))}
                <span className="rp-head-line" style={{ left: `${(pos / (tl.length || 1)) * 100}%` }} />
              </div>
              <input
                type="range"
                className="rp-range"
                min={0}
                max={Math.max(1, Math.round(tl.length))}
                value={Math.round(pos)}
                onChange={(e) => {
                  setPos(Number(e.target.value));
                  setPinned(null);
                }}
                onPointerDown={() => setPlaying(false)}
                aria-label="Timeline"
              />
            </div>
            <div className="rp-opts">
              <div className="seg" role="radiogroup" aria-label="Speed">
                {SPEEDS.map((s) => (
                  <button key={s} role="radio" aria-checked={speed === s} className={`btn seg-opt ${speed === s ? "on" : ""}`} onClick={() => setSpeed(s)}>
                    {s}×
                  </button>
                ))}
              </div>
              <button className={`btn sz-s ${skip ? "b-lav" : "b-ghost"}`} aria-pressed={skip} onClick={() => setSkip((v) => !v)} data-tip="Long waits play as a second and a half">
                <FastForward size={14} /> Skip waiting
              </button>
            </div>
          </footer>
        </>
      )}
    </motion.div>
  );
}

function Lane({ title, cwd, events, current, toolState, pick }: { title: string; cwd: string; events: Ev[]; current: string | null; toolState: (e: Ev & { kind: "tool" }) => string; pick: (e: Ev) => void }) {
  const short = (s: string) => s.split(cwd.endsWith("/") ? cwd : `${cwd}/`).join("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });
  }, [events.length]);
  return (
    <section className="rp-lane">
      <h3 className="rp-lane-title">{title}</h3>
      <div className="rp-feed" ref={box}>
        {events.map((e) => {
          const k = keyOf(e);
          const on = k === current;
          if (e.kind === "message")
            return (
              <button key={k} className={`btn rp-ev rp-msg ${e.role} ${on ? "on" : ""}`} onClick={() => pick(e)}>
                {e.text ? <span className="rp-msg-text">{e.text.slice(0, 280)}</span> : <span className="muted small">Thinking</span>}
              </button>
            );
          if (e.kind === "tool") {
            const st = toolState(e);
            return (
              <button key={k} className={`btn rp-ev rp-tool s-${st} ${on ? "on" : ""}`} onClick={() => pick(e)}>
                <Terminal size={13} />
                <span className="mono rp-sub">{short(e.subject) || e.name}</span>
                <span className="small rp-who">{st === "running" ? "running" : e.decided_by === "user" ? "you" : e.decided_by === "readonly" ? "read-only" : (e.decided_by ?? e.status)}</span>
              </button>
            );
          }
          return (
            <button key={k} className={`btn rp-ev rp-file ${on ? "on" : ""}`} onClick={() => pick(e)}>
              <FileDiff size={13} />
              <span className="mono rp-sub">{short(e.path)}</span>
              <span className="small num">
                <span className="rev-add">+{e.added}</span> <span className="rev-del">−{e.removed}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Detail({ e, state }: { e: Ev; state: string }) {
  if (e.kind === "message")
    return (
      <>
        <span className="eyebrow">{e.role === "user" ? "You" : "Claude"}</span>
        <div className="rp-detail-text">{e.text ? <Markdown text={e.text} /> : <p className="muted">Thinking</p>}</div>
      </>
    );
  if (e.kind === "tool")
    return (
      <>
        <span className="eyebrow">
          {e.name} · {state === "running" ? "running" : state} · {e.ms < 1000 ? `${e.ms} ms` : `${(e.ms / 1000).toFixed(1)} s`}
        </span>
        <code className="rp-subject">{e.subject}</code>
        {e.reason && <p className="small muted">{e.reason}</p>}
        <pre className="rp-out">{state === "running" ? "…" : e.output || "(no output)"}</pre>
      </>
    );
  return (
    <>
      <span className="eyebrow">
        {e.status} · {e.path}
      </span>
      <DiffView text={e.diff} />
    </>
  );
}
