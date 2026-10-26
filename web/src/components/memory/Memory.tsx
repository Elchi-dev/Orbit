import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Brain, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { api } from "../../lib/api";
import { useStore } from "../../lib/store";
import { Ori } from "../ori/Ori";

export interface Memory {
  id: string;
  text: string;
  status: "suggested" | "kept" | "dismissed";
  source_ws: string | null;
  used: number;
  last_used: number | null;
  created_at: number;
  updated_at: number;
}

const MARK = /\n?\[memor(?:y|ies):\s*([\w\s,]+)\]\s*$/i;

/** An answer's text without its "[memory: ...]" line, and the ids it named. */
export function splitMemories(text: string): { text: string; ids: string[] } {
  const m = text.match(MARK);
  if (!m) return { text, ids: [] };
  return { text: text.slice(0, m.index).trimEnd(), ids: m[1].split(/[\s,]+/).filter((x) => /^m_\w+$/.test(x)) };
}

let cache: Memory[] | null = null;
let loading: Promise<Memory[]> | null = null;
const listeners = new Set<(m: Memory[]) => void>();
export function reloadMemories() {
  loading = api.get<Memory[]>("/api/memories").then((m) => {
    cache = m;
    loading = null;
    for (const l of listeners) l(m);
    return m;
  });
  return loading;
}
export function useMemories() {
  const [list, setList] = useState<Memory[]>(cache ?? []);
  useEffect(() => {
    listeners.add(setList);
    if (!cache && !loading) reloadMemories();
    const on = () => reloadMemories();
    window.addEventListener("orbit:memories", on);
    return () => {
      listeners.delete(setList);
      window.removeEventListener("orbit:memories", on);
    };
  }, []);
  return list;
}

/** Under an answer: the memories it says it used. */
export function UsedMemories({ ids }: { ids: string[] }) {
  const all = useMemories();
  const used = ids.map((id) => all.find((m) => m.id === id)).filter(Boolean) as Memory[];
  if (!used.length) return null;
  return (
    <div className="mem-used" aria-label="Memories this answer used">
      <Brain size={13} />
      <span className="muted small">Remembered:</span>
      {used.map((m) => (
        <span key={m.id} className="chip mem-chip" title={m.text}>
          {m.text.length > 48 ? `${m.text.slice(0, 46)}…` : m.text}
        </span>
      ))}
    </div>
  );
}

function Row({ m, i }: { m: Memory; i: number }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(m.text);
  const save = async (patch: Partial<Memory>) => {
    await api.put(`/api/memories/${m.id}`, patch);
    reloadMemories();
  };
  return (
    <motion.li layout className={`mem-row rise ${m.status}`} style={{ "--i": Math.min(i, 10) } as any} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: 16 }}>
      {edit ? (
        <form
          className="mem-edit"
          onSubmit={async (e) => {
            e.preventDefault();
            await save({ text, ...(m.status === "suggested" ? { status: "kept" } : {}) });
            setEdit(false);
          }}
        >
          <div className="field">
            <input value={text} onChange={(e) => setText(e.target.value)} autoFocus aria-label="Memory" />
          </div>
          <button className="btn b-lav sz-s">
            <Check size={13} /> {m.status === "suggested" ? "Keep" : "Save"}
          </button>
          <button type="button" className="btn b-ghost sz-s" onClick={() => (setEdit(false), setText(m.text))}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          <span className="mem-text">
            {m.text}
            {m.status === "kept" && m.used > 0 && <span className="muted small"> · used {m.used}×</span>}
          </span>
          <span className="mem-acts">
            {m.status === "suggested" ? (
              <>
                <button className="btn b-ghost sz-s" onClick={() => save({ status: "dismissed" })} aria-label="Don't remember">
                  <X size={13} /> No
                </button>
                <button className="btn b-ghost icon-btn sm" onClick={() => setEdit(true)} aria-label="Change, then keep" data-tip="Change it first">
                  <Pencil size={13} />
                </button>
                <button className="btn b-lav sz-s" onClick={() => save({ status: "kept" })}>
                  <Check size={13} /> Keep
                </button>
              </>
            ) : (
              <>
                <button className="btn b-ghost icon-btn sm" onClick={() => setEdit(true)} aria-label="Edit" data-tip="Edit">
                  <Pencil size={13} />
                </button>
                <button
                  className="btn b-ghost icon-btn sm danger-hover"
                  onClick={async () => {
                    await api.del(`/api/memories/${m.id}`);
                    reloadMemories();
                  }}
                  aria-label="Forget"
                  data-tip="Forget"
                >
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </span>
        </>
      )}
    </motion.li>
  );
}

/** Suggestions waiting for a yes or no, for the memory drawer. */
export function MemorySuggestions() {
  const list = useMemories().filter((m) => m.status === "suggested");
  if (!list.length) return null;
  return (
    <div className="mem-suggest">
      <div className="mem-suggest-head">
        <Ori pose="thinking" size={34} still />
        <span className="small">
          <b>Remember these everywhere?</b> From your recent work. Nothing is remembered until you keep it.
        </span>
      </div>
      <ul className="mem-list">
        <AnimatePresence initial={false}>
          {list.map((m, i) => (
            <Row key={m.id} m={m} i={i} />
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

/** Settings, Memory. */
export function MemoryPage() {
  const server = useStore((s) => s.server);
  const loadServer = useStore((s) => s.loadServer);
  const list = useMemories();
  const [text, setText] = useState("");
  const kept = list.filter((m) => m.status === "kept");
  const suggested = list.filter((m) => m.status === "suggested");
  const cfg = server?.config.memory ?? { enabled: true, suggest: true };
  const patch = async (v: Partial<typeof cfg>) => {
    await api.put("/api/config", { memory: { ...cfg, ...v } });
    loadServer();
  };
  return (
    <div className="rm">
      <header className="lib-head">
        <div>
          <h2>Memory</h2>
          <p className="muted">Things Claude remembers in every workspace. After some work, Ori suggests what might be worth keeping; nothing is remembered until you say so. Answers show which memories they used.</p>
        </div>
        <Ori pose="reading" size={64} />
      </header>
      <div className="toggle-row">
        <span>
          <b>Use memory</b>
          <span className="muted small">Kept memories go with every message, except in private workspaces.</span>
        </span>
        <button className="switch" role="switch" aria-checked={cfg.enabled} aria-label="Use memory" onClick={() => patch({ enabled: !cfg.enabled })} />
      </div>
      <div className="toggle-row">
        <span>
          <b>Suggest memories</b>
          <span className="muted small">Now and then, after a run, a small model reads the conversation and suggests up to three. About a cent each time.</span>
        </span>
        <button className="switch" role="switch" aria-checked={cfg.suggest} aria-label="Suggest memories" onClick={() => patch({ suggest: !cfg.suggest })} />
      </div>
      <form
        className="field"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          await api.post("/api/memories", { text });
          setText("");
          reloadMemories();
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Something Claude should always know, like: I use pnpm, never npm" aria-label="New memory" />
        <button className="btn b-ghost icon-btn sm" aria-label="Remember" data-tip="Remember">
          <Plus size={16} />
        </button>
      </form>
      {suggested.length > 0 && <MemorySuggestions />}
      <ul className="mem-list">
        <AnimatePresence initial={false}>
          {kept.map((m, i) => (
            <Row key={m.id} m={m} i={i} />
          ))}
        </AnimatePresence>
      </ul>
      {kept.length === 0 && <p className="muted small">Nothing remembered yet.</p>}
    </div>
  );
}
