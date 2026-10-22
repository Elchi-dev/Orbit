import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Camera, CheckSquare, FileCode2, Frame, ImagePlus, LayoutDashboard, Link2, Loader2, Maximize, Minus, Plus, Spline, StickyNote, Trash2, Type } from "lucide-react";
import { api } from "../../lib/api";
import { useStore } from "../../lib/store";
import { openInEditor } from "../../lib/open";
import type { Board, BoardItem, BoardKind, Workspace } from "../../lib/types";
import { Markdown } from "./Blocks";

export const NOTE_COLORS: Record<string, string> = {
  yellow: "#F3E3A3",
  peach: "#FFC9B8",
  lavender: "#D9D0FF",
  mint: "#BDEBD6",
  sky: "#BFDDF2",
  rose: "#F6C4D3",
  gray: "#D8D7E0",
};

type Op = Record<string, unknown> & { op: string };
const EMPTY: Board = { items: [], edges: [], version: 0 };

export function imageUrl(wsId: string, src?: string) {
  if (!src) return "";
  if (src.startsWith("shot:")) return `/api/shots/${encodeURIComponent(src.slice(5))}`;
  if (src.startsWith("asset:")) return `/api/assets/${encodeURIComponent(src.slice(6))}`;
  if (src.startsWith("file:")) return `/api/workspaces/${wsId}/image?path=${encodeURIComponent(src.slice(5))}`;
  return "";
}

/** Apply the user's own change at once; the server's copy replaces it when it comes back. */
function local(b: Board, ops: Op[]): Board {
  let items = b.items.map((i) => ({ ...i }));
  let edges = [...b.edges];
  for (const o of ops) {
    const it = items.find((i) => i.id === o.id);
    if (o.op === "move" && it) {
      const dx = (o.x as number) - it.x;
      const dy = (o.y as number) - it.y;
      if (it.kind === "frame")
        for (const c of items) if (c !== it && c.x >= it.x && c.y >= it.y && c.x + c.w <= it.x + it.w && c.y + c.h <= it.y + it.h) (c.x += dx), (c.y += dy);
      it.x += dx;
      it.y += dy;
    } else if (o.op === "update" && it) Object.assign(it, Object.fromEntries(Object.entries(o).filter(([k]) => k !== "op" && k !== "id")));
    else if (o.op === "remove") {
      items = items.filter((i) => i.id !== o.id);
      edges = edges.filter((e) => e.from !== o.id && e.to !== o.id);
    }
  }
  return { ...b, items, edges };
}

/** Where a line from the centre of a box towards a point leaves the box. */
function edgePoint(a: BoardItem, toward: { x: number; y: number }) {
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const s = Math.min(Math.abs(a.w / 2 / (dx || 1e-9)), Math.abs(a.h / 2 / (dy || 1e-9)));
  return { x: cx + dx * s, y: cy + dy * s };
}

function ItemBody({ ws, it, editing, onDone, onChange }: { ws: Workspace; it: BoardItem; editing: boolean; onDone: () => void; onChange: (patch: Partial<BoardItem>) => void }) {
  const [text, setText] = useState(it.text ?? "");
  useEffect(() => setText(it.text ?? ""), [it.text, editing]);
  if (editing && (it.kind === "note" || it.kind === "text"))
    return (
      <textarea
        className="bi-edit"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== (it.text ?? "")) onChange({ text });
          onDone();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key === "Enter")) (e.target as HTMLTextAreaElement).blur();
          e.stopPropagation();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Edit the text"
      />
    );
  switch (it.kind) {
    case "note":
      return <div className="bi-note-text">{it.text || <span className="bi-placeholder">Double-click to write</span>}</div>;
    case "text":
      return <div className="bi-text">{it.text ? <Markdown text={it.text} /> : <span className="bi-placeholder">Double-click to write</span>}</div>;
    case "checklist":
      return (
        <div className="bi-check">
          {it.title && <strong>{it.title}</strong>}
          <ul>
            {(it.items ?? []).map((c, i) => (
              <li key={i}>
                <label onPointerDown={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={c.done} onChange={() => onChange({ items: it.items!.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) })} />
                  <span className={c.done ? "done" : ""}>{c.text}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      );
    case "image":
      return (
        <figure className="bi-image">
          <img src={imageUrl(ws.id, it.src)} alt={it.title ?? ""} draggable={false} />
          {it.title && <figcaption>{it.title}</figcaption>}
        </figure>
      );
    case "link": {
      let host = "";
      try {
        host = new URL(it.url ?? "").hostname;
      } catch {}
      return (
        <a className="bi-link" href={it.url} target="_blank" rel="noreferrer" onPointerDown={(e) => e.stopPropagation()}>
          <Link2 size={16} />
          <span>
            <strong>{it.title || host}</strong>
            <small>{host}</small>
            {it.text && <em>{it.text}</em>}
          </span>
        </a>
      );
    }
    case "file":
      return (
        <button className="btn bi-file" onPointerDown={(e) => e.stopPropagation()} onClick={() => it.path && openInEditor(ws.id, it.path)}>
          <FileCode2 size={16} />
          <span>
            <strong>{it.title || it.path?.split("/").pop()}</strong>
            <small className="mono">{it.path}</small>
          </span>
        </button>
      );
    case "frame":
      return null;
  }
}

export function BoardPane({ ws }: { ws: Workspace }) {
  const server = useStore((s) => s.boards[ws.id]);
  const loadBoard = useStore((s) => s.loadBoard);
  const preview = useStore((s) => s.previews[ws.id]);
  const toast = useStore((s) => s.toast);
  const [board, setBoard] = useState<Board>(server ?? EMPTY);
  const [view, setView] = useState({ x: 40, y: 40, z: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<null | { from?: string }>(null);
  const [drag, setDrag] = useState<null | { id: string; dx: number; dy: number; mode: "move" | "resize"; x: number; y: number; w: number; h: number }>(null);
  const [busy, setBusy] = useState("");
  const vp = useRef<HTMLDivElement>(null);
  const fitted = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadBoard(ws.id).catch(() => {});
  }, [ws.id]);
  useEffect(() => {
    if (server && !drag) setBoard(server);
  }, [server]);

  async function apply(ops: Op[]) {
    setBoard((b) => local(b, ops));
    try {
      await api.post(`/api/workspaces/${ws.id}/board`, { ops });
    } catch (e) {
      toast({ title: "The board didn't take that", body: (e as Error).message, tone: "warn" });
      loadBoard(ws.id);
    }
  }

  // world coordinates of a point on screen
  const toWorld = (cx: number, cy: number) => {
    const r = vp.current!.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z };
  };
  const center = () => {
    const r = vp.current?.getBoundingClientRect();
    return r ? toWorld(r.left + r.width / 2, r.top + r.height / 2) : { x: 0, y: 0 };
  };

  function fit() {
    const el = vp.current;
    if (!el) return;
    const items = board.items;
    if (!items.length) return setView({ x: 40, y: 40, z: 1 });
    const minX = Math.min(...items.map((i) => i.x));
    const minY = Math.min(...items.map((i) => i.y));
    const maxX = Math.max(...items.map((i) => i.x + i.w));
    const maxY = Math.max(...items.map((i) => i.y + i.h));
    const z = Math.max(0.15, Math.min(1.25, Math.min((el.clientWidth - 64) / (maxX - minX || 1), (el.clientHeight - 64) / (maxY - minY || 1))));
    setView({ z, x: (el.clientWidth - (maxX - minX) * z) / 2 - minX * z, y: (el.clientHeight - (maxY - minY) * z) / 2 - minY * z });
  }
  useLayoutEffect(() => {
    if (!fitted.current && server && vp.current) {
      fitted.current = true;
      requestAnimationFrame(fit);
    }
  }, [server]);

  function zoomAt(factor: number, cx?: number, cy?: number) {
    const r = vp.current!.getBoundingClientRect();
    const px = (cx ?? r.left + r.width / 2) - r.left;
    const py = (cy ?? r.top + r.height / 2) - r.top;
    setView((v) => {
      const z = Math.max(0.15, Math.min(3, v.z * factor));
      return { z, x: px - ((px - v.x) * z) / v.z, y: py - ((py - v.y) * z) / v.z };
    });
  }

  // wheel: pinch or ctrl zooms, otherwise it pans
  useEffect(() => {
    const el = vp.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected || editing || (e.target as HTMLElement).closest("input,textarea,[contenteditable]")) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        apply([{ op: "remove", id: selected }]);
        setSelected(null);
      }
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, editing]);

  function startPan(e: React.PointerEvent) {
    if (e.button !== 0) return;
    setSelected(null);
    if (connecting) setConnecting({});
    const sx = e.clientX;
    const sy = e.clientY;
    const v0 = view;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setView({ ...v0, x: v0.x + ev.clientX - sx, y: v0.y + ev.clientY - sy });
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  function startDrag(e: React.PointerEvent, it: BoardItem, mode: "move" | "resize") {
    if (e.button !== 0 || editing === it.id) return;
    e.stopPropagation();
    if (connecting) {
      if (!connecting.from) setConnecting({ from: it.id });
      else if (connecting.from !== it.id) {
        apply([{ op: "connect", from: connecting.from, to: it.id }]);
        setConnecting({});
      }
      return;
    }
    setSelected(it.id);
    const p = toWorld(e.clientX, e.clientY);
    const d = { id: it.id, mode, dx: p.x - it.x, dy: p.y - it.y, x: it.x, y: it.y, w: it.w, h: it.h };
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    let last = d;
    const move = (ev: PointerEvent) => {
      const q = toWorld(ev.clientX, ev.clientY);
      last = mode === "move" ? { ...d, x: Math.round(q.x - d.dx), y: Math.round(q.y - d.dy) } : { ...d, w: Math.max(80, Math.round(q.x - it.x)), h: Math.max(40, Math.round(q.y - it.y)) };
      setDrag(last);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      setDrag(null);
      if (mode === "move" && (last.x !== it.x || last.y !== it.y)) apply([{ op: "move", id: it.id, x: last.x, y: last.y }]);
      if (mode === "resize" && (last.w !== it.w || last.h !== it.h)) apply([{ op: "update", id: it.id, w: last.w, h: last.h }]);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  async function add(kind: BoardKind, extra: Record<string, unknown> = {}) {
    const c = center();
    const size: Record<string, [number, number]> = { note: [220, 160], text: [320, 120], checklist: [260, 200], frame: [760, 520], image: [360, 240], link: [280, 96] };
    const [w, h] = size[kind] ?? [240, 160];
    const ops: Op[] = [{ op: "add", kind, x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), ...extra }];
    try {
      const b = await api.post<Board>(`/api/workspaces/${ws.id}/board`, { ops });
      setBoard(b);
      const fresh = b.items.filter((i) => !board.items.some((o) => o.id === i.id)).pop();
      if (fresh) {
        setSelected(fresh.id);
        if (kind === "note" || kind === "text") setEditing(fresh.id);
      }
    } catch (e) {
      toast({ title: "Couldn't add that", body: (e as Error).message, tone: "warn" });
    }
  }

  async function upload(files: FileList | File[]) {
    for (const f of [...files].filter((f) => f.type.startsWith("image/")).slice(0, 8)) {
      setBusy("image");
      try {
        const r = await fetch(`/api/workspaces/${ws.id}/assets`, { method: "POST", body: f, headers: { "content-type": f.type }, credentials: "same-origin" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Upload failed");
        await add("image", { src: j.src, title: f.name.replace(/\.[^.]+$/, "") });
      } catch (e) {
        toast({ title: "Image not added", body: (e as Error).message, tone: "warn" });
      } finally {
        setBusy("");
      }
    }
  }

  async function shotOfPreview() {
    if (!preview?.url) return toast({ title: "Nothing in the preview", body: "Open a page in the Preview tab first.", tone: "info" });
    setBusy("shot");
    try {
      const r = await api.post<{ file: string }>(`/api/workspaces/${ws.id}/screenshot`, { url: preview.url, width: 1280 });
      await add("image", { src: `shot:${r.file}`, title: preview.target });
    } catch (e) {
      toast({ title: "No screenshot", body: (e as Error).message, tone: "warn" });
    } finally {
      setBusy("");
    }
  }

  const shown = useMemo(() => (drag ? board.items.map((i) => (i.id === drag.id ? { ...i, x: drag.x, y: drag.y, w: drag.w, h: drag.h } : i)) : board.items), [board, drag]);
  const byId = useMemo(() => new Map(shown.map((i) => [i.id, i])), [shown]);
  const frames = shown.filter((i) => i.kind === "frame");
  const rest = shown.filter((i) => i.kind !== "frame");
  const sel = selected ? byId.get(selected) : undefined;

  return (
    <div
      className="board"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
      }}
      onPaste={(e) => {
        const files = [...e.clipboardData.files];
        if (files.length) upload(files);
      }}
    >
      <div className="bd-bar" role="toolbar" aria-label="Board">
        <button className="btn b-ghost icon-btn sm" onClick={() => add("note", { text: "" })} data-tip="Sticky note" data-tip-side="bottom" aria-label="Add a sticky note">
          <StickyNote size={15} />
        </button>
        <button className="btn b-ghost icon-btn sm" onClick={() => add("text", { text: "" })} data-tip="Text" data-tip-side="bottom" aria-label="Add text">
          <Type size={15} />
        </button>
        <button className="btn b-ghost icon-btn sm" onClick={() => add("checklist", { title: "To do", items: [{ text: "First thing", done: false }] })} data-tip="Checklist" data-tip-side="bottom" aria-label="Add a checklist">
          <CheckSquare size={15} />
        </button>
        <button className="btn b-ghost icon-btn sm" onClick={() => add("frame", { title: "Group" })} data-tip="Frame" data-tip-side="bottom" aria-label="Add a frame">
          <Frame size={15} />
        </button>
        <button className="btn b-ghost icon-btn sm" onClick={() => fileInput.current?.click()} data-tip="Image (or paste, or drop)" data-tip-side="bottom" aria-label="Add an image" disabled={busy === "image"}>
          {busy === "image" ? <Loader2 size={15} className="spin" /> : <ImagePlus size={15} />}
        </button>
        <button
          className="btn b-ghost icon-btn sm"
          onClick={() => {
            const url = prompt("Link address");
            if (url) add("link", { url: /^https?:\/\//.test(url) ? url : `https://${url}` });
          }}
          data-tip="Link"
          data-tip-side="bottom"
          aria-label="Add a link"
        >
          <Link2 size={15} />
        </button>
        <button className="btn b-ghost icon-btn sm" onClick={shotOfPreview} data-tip="Screenshot of the preview" data-tip-side="bottom" aria-label="Add a screenshot of the preview" disabled={busy === "shot"}>
          {busy === "shot" ? <Loader2 size={15} className="spin" /> : <Camera size={15} />}
        </button>
        <span className="bd-sep" />
        <button className={`btn ${connecting ? "b-lav" : "b-ghost"} sz-s`} onClick={() => setConnecting(connecting ? null : {})} aria-pressed={!!connecting} data-tip="Click two items to draw an arrow" data-tip-side="bottom">
          <Spline size={14} /> {connecting ? (connecting.from ? "Now the second" : "Pick the first") : "Arrow"}
        </button>
        {sel && (
          <>
            {(sel.kind === "note" || sel.kind === "frame") && (
              <span className="bd-colors" role="radiogroup" aria-label="Color">
                {Object.entries(NOTE_COLORS).map(([name, hex]) => (
                  <button key={name} role="radio" aria-checked={sel.color === name} aria-label={name} className={`bd-color ${sel.color === name ? "on" : ""}`} style={{ background: hex }} onClick={() => apply([{ op: "update", id: sel.id, color: name }])} />
                ))}
              </span>
            )}
            <button className="btn b-ghost icon-btn sm" onClick={() => (apply([{ op: "remove", id: sel.id }]), setSelected(null))} aria-label="Remove" data-tip="Remove (Delete)" data-tip-side="bottom">
              <Trash2 size={14} />
            </button>
          </>
        )}
        <span className="bd-zoom">
          <button className="btn b-ghost icon-btn sm" onClick={() => zoomAt(1 / 1.2)} aria-label="Zoom out">
            <Minus size={14} />
          </button>
          <span className="bd-z">{Math.round(view.z * 100)}%</span>
          <button className="btn b-ghost icon-btn sm" onClick={() => zoomAt(1.2)} aria-label="Zoom in">
            <Plus size={14} />
          </button>
          <button className="btn b-ghost icon-btn sm" onClick={fit} aria-label="Fit everything" data-tip="Fit everything" data-tip-side="bottom">
            <Maximize size={14} />
          </button>
        </span>
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
      </div>

      <div className={`bd-viewport ${connecting ? "connecting" : ""}`} ref={vp} onPointerDown={startPan} style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.z}px ${24 * view.z}px` }}>
        <div className="bd-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          {[...frames, ...rest].map((it) => (
            <div
              key={it.id}
              className={`bi bi-${it.kind} ${selected === it.id ? "selected" : ""} ${connecting?.from === it.id ? "from" : ""} ${it.by === "agent" ? "by-agent" : ""}`}
              style={{ left: it.x, top: it.y, width: it.w, height: it.h, ...(it.kind === "note" ? { background: NOTE_COLORS[it.color ?? "yellow"] ?? NOTE_COLORS.yellow } : it.kind === "frame" && it.color ? { borderColor: NOTE_COLORS[it.color] } : {}) }}
              onPointerDown={(e) => startDrag(e, it, "move")}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (it.kind === "note" || it.kind === "text") setEditing(it.id);
                if (it.kind === "frame" || it.kind === "checklist" || it.kind === "image") {
                  const t = prompt("Title", it.title ?? "");
                  if (t != null) apply([{ op: "update", id: it.id, title: t }]);
                }
              }}
            >
              {it.kind === "frame" && <span className="bi-frame-title">{it.title || "Group"}</span>}
              <ItemBody ws={ws} it={it} editing={editing === it.id} onDone={() => setEditing(null)} onChange={(patch) => apply([{ op: "update", id: it.id, ...patch }])} />
              {selected === it.id && <span className="bi-resize" onPointerDown={(e) => startDrag(e, it, "resize")} aria-hidden="true" />}
            </div>
          ))}
          <svg className="bd-edges" aria-hidden="true">
            <defs>
              <marker id={`arrow-${ws.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            {board.edges.map((e) => {
              const a = byId.get(e.from);
              const b = byId.get(e.to);
              if (!a || !b) return null;
              const p = edgePoint(a, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
              const q = edgePoint(b, { x: a.x + a.w / 2, y: a.y + a.h / 2 });
              return (
                <g key={e.id}>
                  <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} markerEnd={`url(#arrow-${ws.id})`} />
                  {e.label && (
                    <text x={(p.x + q.x) / 2} y={(p.y + q.y) / 2 - 6} textAnchor="middle">
                      {e.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
        {!board.items.length && (
          <div className="pv-empty bd-empty">
            <LayoutDashboard size={22} />
            <p>The board is empty.</p>
            <p className="muted small">Claude lays out notes, screenshots, options and flows here. Add your own with the buttons above, or drop and paste images.</p>
          </div>
        )}
      </div>
    </div>
  );
}
