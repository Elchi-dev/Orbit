import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { CornerDownLeft, EyeOff, MessageSquare, Orbit, Plus, Search, Settings2 } from "lucide-react";
import { useStore } from "../lib/store";
import { api } from "../lib/api";
import { ago } from "../lib/format";

interface Item {
  key: string;
  label: string;
  sub?: string;
  Icon: typeof Search;
  run: () => void;
}

export function Palette() {
  const workspaces = useStore((s) => s.workspaces);
  const setOverlay = useStore((s) => s.setOverlay);
  const setView = useStore((s) => s.setView);
  const createWorkspace = useStore((s) => s.createWorkspace);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ workspace_id: string; snippet: string; title: string }[]>([]);
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const t = setTimeout(() => api.get<any[]>(`/api/search?q=${encodeURIComponent(q)}`).then(setHits).catch(() => {}), 160);
    return () => clearTimeout(t);
  }, [q]);

  const close = () => setOverlay(null);
  const items = useMemo<Item[]>(() => {
    const ql = q.toLowerCase();
    const actions: Item[] = [
      { key: "new", label: "New workspace", Icon: Plus, run: async () => setView({ kind: "ws", id: (await createWorkspace()).id }) },
      { key: "incog", label: "New incognito workspace", sub: "kept out of search and memory", Icon: EyeOff, run: async () => setView({ kind: "ws", id: (await createWorkspace({ incognito: true })).id }) },
      { key: "home", label: "Go to the Orrery", Icon: Orbit, run: () => setView({ kind: "orrery" }) },
      { key: "settings", label: "Open settings", Icon: Settings2, run: () => setOverlay("settings") },
    ].filter((a) => !ql || a.label.toLowerCase().includes(ql));
    const ws = Object.values(workspaces)
      .filter((w) => !w.parent_id && (!ql || w.title.toLowerCase().includes(ql)))
      .sort((a, b) => b.updated_at - a.updated_at)
      .slice(0, 8)
      .map((w) => ({ key: w.id, label: w.title, sub: ago(w.updated_at), Icon: Orbit, run: () => setView({ kind: "ws", id: w.id }) }));
    const found = hits.slice(0, 8).map((h, i) => ({
      key: `h${i}`,
      label: h.snippet.replace(/\[\[|\]\]/g, ""),
      sub: h.title,
      Icon: MessageSquare,
      run: () => setView({ kind: "ws", id: h.workspace_id }),
    }));
    return [...ws, ...found, ...actions];
  }, [q, workspaces, hits]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const run = (i: number) => {
    const it = items[i];
    if (!it) return;
    close();
    it.run();
  };

  return (
    <motion.div className="overlay top" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <motion.div
        className="palette glass panel"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        initial={{ opacity: 0, y: -20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.97 }}
        transition={{ type: "spring", stiffness: 340, damping: 28 }}
      >
        <div className="pal-input">
          <Search size={19} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search workspaces and messages, or type a command"
            aria-label="Search"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(items.length - 1, s + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              } else if (e.key === "Enter") run(sel);
              else if (e.key === "Escape") close();
            }}
          />
        </div>
        <div className="pal-list" ref={listRef} role="listbox">
          {items.length === 0 && <p className="muted pal-empty">Nothing matches “{q}”.</p>}
          {items.map((it, i) => (
            <button key={it.key} data-i={i} role="option" aria-selected={i === sel} className={`pal-item ${i === sel ? "on" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => run(i)}>
              <it.Icon size={17} />
              <span className="pal-text">
                <span className="pal-label">{it.label}</span>
                {it.sub && <span className="pal-sub">{it.sub}</span>}
              </span>
              {i === sel && <CornerDownLeft size={15} className="pal-enter" />}
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
