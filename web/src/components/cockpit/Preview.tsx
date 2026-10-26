import { CheckReportView, type Report } from "./CheckReport";
import { OriEmpty } from "../ori/OriEmpty";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { create } from "zustand";
import { Camera, ClipboardCheck, ExternalLink, Laptop, Loader2, MessageSquarePlus, Monitor, RotateCw, Send, Smartphone, Tablet, Trash2, X } from "lucide-react";
import { api } from "../../lib/api";
import { useStore } from "../../lib/store";
import { partialField } from "../../lib/partial";
import type { Workspace } from "../../lib/types";

export const VIEWPORTS = [
  { id: "phone", label: "Phone", width: 390, Icon: Smartphone },
  { id: "tablet", label: "Tablet", width: 820, Icon: Tablet },
  { id: "laptop", label: "Laptop", width: 1280, Icon: Laptop },
  { id: "fill", label: "Fill", width: 0, Icon: Monitor },
] as const;
type Viewport = (typeof VIEWPORTS)[number]["id"];

/** A comment on the preview: on an element the user picked, or on the page as a whole. */
interface Note {
  id: number;
  body: string;
  url: string;
  width: number;
  sel?: string;
  label?: string;
  text?: string;
  html?: string;
  px?: number;
  py?: number;
  bottom?: number;
}
interface Pick extends Omit<Note, "id" | "body" | "width"> {
  rect: { x: number; y: number; w: number; h: number };
  vw: number;
}

// comments stay while you switch tabs or workspaces, until sent or cleared
const useNotes = create<{ notes: Record<string, Note[]>; set: (ws: string, n: Note[]) => void }>((set, get) => ({
  notes: {},
  set: (ws, n) => set({ notes: { ...get().notes, [ws]: n } }),
}));
let noteId = 1;
const NO_NOTES: Note[] = [];

/**
 * An HTML file Claude is writing right now, as far as it has arrived. The preview
 * shows it growing, then switches to the real file when the write lands.
 */
function useLiveWrite(wsId: string) {
  const stream = useStore((s) => s.streams[wsId]);
  return useMemo(() => {
    const blocks = stream?.blocks ?? [];
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b: any = blocks[i];
      if (b?.type !== "tool_use" || b.name !== "write_file") continue;
      const path = partialField(b.text ?? "", "path");
      if (!path || !/\.html?$/i.test(path)) return null;
      const content = partialField(b.text ?? "", "content");
      return content === null ? null : { path, content };
    }
    return null;
  }, [stream]);
}

const samePage = (a: string, b: string) => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname;
  } catch {
    return a === b;
  }
};

function toBase64(s: string) {
  return btoa(unescape(encodeURIComponent(s)));
}

export function PreviewPane({ ws }: { ws: Workspace }) {
  const preview = useStore((s) => s.previews[ws.id]);
  const toast = useStore((s) => s.toast);
  const send = useStore((s) => s.send);
  const live = useLiveWrite(ws.id);
  const notes = useNotes((s) => s.notes[ws.id] ?? NO_NOTES);
  const setNotes = (n: Note[]) => useNotes.getState().set(ws.id, n);
  const [viewport, setViewport] = useState<Viewport>(() => {
    try {
      return (localStorage.getItem("orbit.viewport") as Viewport) || "fill";
    } catch {
      return "fill";
    }
  });
  const [address, setAddress] = useState(preview?.target ?? "");
  const [nonce, setNonce] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [sending, setSending] = useState(false);
  const [shownLive, setShownLive] = useState("");
  const [annotating, setAnnotating] = useState(false);
  const [pick, setPick] = useState<Pick | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [checking, setChecking] = useState(false);
  // a check Claude ran shows here too
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.workspaceId === ws.id) setReport(d.report);
    };
    window.addEventListener("orbit:page_check", on);
    return () => window.removeEventListener("orbit:page_check", on);
  }, [ws.id]);
  async function runCheck() {
    setChecking(true);
    try {
      const w = VIEWPORTS.find((v) => v.id === viewport)!.width || frameWrap.current?.clientWidth || 1280;
      setReport(await api.post<Report>(`/api/workspaces/${ws.id}/check`, { target: preview?.target, width: w }));
    } catch (e) {
      toast({ title: "The check didn't run", body: (e as Error).message, tone: "warn" });
    } finally {
      setChecking(false);
    }
  }
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setAddress(preview?.target ?? ""), [preview?.target]);
  // redraw the growing page a few times a second, not on every token
  const latest = useRef("");
  latest.current = live?.content ?? "";
  const writing = !!live;
  useEffect(() => {
    if (!writing) return;
    setShownLive(latest.current);
    const t = setInterval(() => setShownLive((cur) => (cur === latest.current ? cur : latest.current)), 180);
    return () => clearInterval(t);
  }, [writing]);
  const frameWrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const vp = VIEWPORTS.find((v) => v.id === viewport)!;
  const width = vp.width || frameWrap.current?.clientWidth || 1280;
  useEffect(() => {
    const el = frameWrap.current;
    if (!el) return;
    const fit = () => setScale(vp.width && el.clientWidth < vp.width + 24 ? Math.max(0.3, (el.clientWidth - 24) / vp.width) : 1);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [vp.width]);

  // talk to the comment script inside the page
  const post = (m: object) => frame.current?.contentWindow?.postMessage(m, "*");
  const pinsFor = (url: string) =>
    notes
      .map((n, i) => ({ n, i }))
      .filter(({ n }) => n.sel && samePage(n.url, url))
      .map(({ n, i }) => ({ n: i + 1, sel: n.sel, px: n.px, py: n.py }));
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = e.data ?? {};
      if (m.orbit === "ready") {
        setPage(String(m.url ?? ""));
        post({ orbit: "annotate", on: annotating });
        post({ orbit: "pins", pins: pinsFor(String(m.url ?? "")) });
      } else if (m.orbit === "pick") {
        setPick(m as Pick);
        requestAnimationFrame(() => draftRef.current?.focus());
      } else if (m.orbit === "cancel") {
        setAnnotating(false);
        setPick(null);
      }
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  });
  useEffect(() => post({ orbit: "annotate", on: annotating }), [annotating]);
  useEffect(() => post({ orbit: "pins", pins: pinsFor(page) }), [notes, page]);
  useEffect(() => {
    if (!annotating) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pick) setAnnotating(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [annotating, pick]);

  function addNote() {
    const body = draft.trim();
    if (!body) return;
    const at: Partial<Note> = pick ? { sel: pick.sel, label: pick.label, text: pick.text, html: pick.html, px: pick.px, py: pick.py, url: pick.url, bottom: pick.rect.y + pick.rect.h } : { url: page || preview?.url || "" };
    setNotes([...notes, { id: noteId++, body, width, url: page || preview?.url || "", ...at }]);
    setDraft("");
    setPick(null);
  }

  async function go(target: string) {
    try {
      await api.post(`/api/workspaces/${ws.id}/preview`, { target: target || "." });
    } catch (e) {
      toast({ title: "Nothing to show there", body: (e as Error).message, tone: "warn" });
    }
  }

  async function capture() {
    if (!preview?.url) return;
    setCapturing(true);
    try {
      const r = await api.post<{ image: string; console: string[]; width: number }>(`/api/workspaces/${ws.id}/screenshot`, { url: page || preview.url, width: vp.width || 1280 });
      window.dispatchEvent(new CustomEvent("orbit:attach", { detail: { workspaceId: ws.id, name: `${preview.target.replace(/[^\w.-]+/g, "-") || "page"}-${vp.width || 1280}.png`, mediaType: "image/png", data: r.image, note: r.console.length ? `Console:\n${r.console.join("\n")}` : "" } }));
      toast({ title: "Screenshot attached", body: r.console.length ? `${r.console.length} console ${r.console.length === 1 ? "message" : "messages"} added too.` : "Say what to change and send.", tone: "good" });
    } catch (e) {
      toast({ title: "No screenshot", body: (e as Error).message, tone: "warn" });
    } finally {
      setCapturing(false);
    }
  }

  /** Every comment goes to Claude at once, with a screenshot per page showing the numbered pins. */
  async function sendNotes() {
    if (!notes.length) return;
    setSending(true);
    const pages = [...new Set(notes.map((n) => n.url))].slice(0, 3);
    const shots: { kind: "image"; name: string; mediaType: string; data: string }[] = [];
    for (const u of pages) {
      const pins = pinsFor(u).map((p) => ({ ...p, outline: true }));
      try {
        const url = new URL(u);
        if (pins.length) url.searchParams.set("__orbit_pins", toBase64(JSON.stringify(pins)));
        const lowest = Math.max(0, ...notes.filter((n) => samePage(n.url, u)).map((n) => n.bottom ?? 0));
        const w = notes.find((n) => samePage(n.url, u))?.width ?? 1280;
        const r = await api.post<{ image: string }>(`/api/workspaces/${ws.id}/screenshot`, { url: url.href, width: w, height: lowest > 700 ? Math.min(4000, lowest + 160) : undefined });
        shots.push({ kind: "image", name: "preview-comments.png", mediaType: "image/png", data: r.image });
      } catch {}
    }
    const shown = (u: string) => {
      const t = preview?.kind === "server" && preview.target ? preview.target.replace(/\/$/, "") : "";
      try {
        const x = new URL(u);
        return t ? `${t}${x.pathname}${x.search}` : (preview?.target ?? x.pathname);
      } catch {
        return u;
      }
    };
    const lines = notes.map((n, i) => {
      const where = n.sel ? `\`${n.label}\`${n.text ? ` "${n.text.slice(0, 80)}"` : ""} (selector \`${n.sel}\`)` : "the page as a whole";
      return `${i + 1}. On ${where}: ${n.body}${n.html ? `\n   \`${n.html.replace(/\s+/g, " ").slice(0, 240)}\`` : ""}`;
    });
    const text = `Comments on the preview of ${pages.map(shown).join(", ")} at ${notes[0].width} px${shots.length ? ", numbered like the pins in the screenshot" : ""}:\n\n${lines.join("\n")}\n\nPlease make these changes, then check the result.`;
    send({ type: "send", workspaceId: ws.id, text, attachments: shots });
    setNotes([]);
    setAnnotating(false);
    setSending(false);
    if (!shots.length) toast({ title: "Sent without a screenshot", body: "No Chrome-family browser was found to capture the page.", tone: "info" });
  }

  const showLive = !!live && ws.running;
  const canAnnotate = !!preview?.url && !showLive;
  return (
    <div className="preview" aria-label="Preview">
      <div className="pv-bar">
        <form
          className="pv-address field"
          onSubmit={(e) => {
            e.preventDefault();
            go(address);
          }}
        >
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="index.html, a folder, or http://localhost:5173" aria-label="What to preview" spellCheck={false} />
        </form>
        <div className="seg pv-vp" role="radiogroup" aria-label="Width">
          {VIEWPORTS.map(({ id, label, width, Icon }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={viewport === id}
              className={`btn seg-opt ${viewport === id ? "on" : ""}`}
              onClick={() => {
                setViewport(id);
                try {
                  localStorage.setItem("orbit.viewport", id);
                } catch {}
              }}
              data-tip={width ? `${label}, ${width} px` : label}
              data-tip-side="bottom"
              aria-label={label}
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
        <button className="btn b-ghost icon-btn sm" onClick={() => setNonce(Date.now())} aria-label="Reload" data-tip="Reload" data-tip-side="bottom" disabled={!preview?.url}>
          <RotateCw size={15} />
        </button>
        <button className="btn b-ghost icon-btn sm" onClick={capture} aria-label="Screenshot into the message" data-tip="Screenshot into the message" data-tip-side="bottom" disabled={!preview?.url || capturing}>
          {capturing ? <Loader2 size={15} className="spin" /> : <Camera size={15} />}
        </button>
        <button className="btn b-ghost icon-btn sm" onClick={runCheck} aria-label="Check speed and accessibility" data-tip="Check speed and accessibility" data-tip-side="bottom" disabled={!preview?.url || checking}>
          {checking ? <Loader2 size={15} className="spin" /> : <ClipboardCheck size={15} />}
        </button>
        <a className={`btn b-ghost icon-btn sm ${preview?.url ? "" : "disabled"}`} href={preview?.url || undefined} target="_blank" rel="noreferrer" aria-label="Open in a tab" data-tip="Open in a tab" data-tip-side="bottom">
          <ExternalLink size={15} />
        </a>
        <button
          className={`btn ${annotating ? "b-lav" : "b-outline"} sz-s pv-comment`}
          onClick={() => {
            setAnnotating(!annotating);
            setPick(null);
          }}
          disabled={!canAnnotate}
          aria-pressed={annotating}
          data-tip={annotating ? "Stop pointing (Esc)" : "Point at anything and say what to change"}
          data-tip-side="bottom"
        >
          <MessageSquarePlus size={14} /> {annotating ? "Commenting" : "Comment"}
          {notes.length > 0 && <span className="pv-count">{notes.length}</span>}
        </button>
      </div>
      <div className={`pv-stage ${vp.width ? "framed" : ""} ${annotating ? "annotating" : ""}`} ref={frameWrap}>
        <AnimatePresence>
          {report && (
            <CheckReportView
              key="ck"
              r={report}
              onClose={() => setReport(null)}
              onFix={() => {
                send({
                  type: "send",
                  workspaceId: ws.id,
                  text: `A check of ${report.target} at ${report.width} px found these. Fix them, then run page_check again to confirm:\n${report.a11y
                    .map((i) => `- ${i.title} (WCAG ${i.wcag}), ${i.count}: ${i.examples.map((e) => e.selector + (e.detail ? ` ${e.detail}` : "")).join("; ")}`)
                    .join("\n")}${report.perf.verdict.lcp !== "good" || report.perf.verdict.tbt !== "good" || report.perf.verdict.cls !== "good" ? `\n- Speed: largest paint ${report.perf.lcp} ms, layout shift ${report.perf.cls}, blocking ${report.perf.tbt} ms` : ""}`,
                });
                setReport(null);
              }}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {showLive && (
            <motion.span className="pv-live" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <i /> Writing {live!.path}
            </motion.span>
          )}
          {annotating && !pick && (
            <motion.span className="pv-live pv-hint" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              Click anything on the page to comment on it
            </motion.span>
          )}
        </AnimatePresence>
        {showLive || preview?.url ? (
          <div className="pv-device" style={vp.width ? { width: vp.width, transform: `scale(${scale})`, height: `${100 / scale}%` } : undefined}>
            {showLive ? (
              // the half-written page has no address yet; it is drawn without its scripts (half a script
              // only throws) in a frame that may run nothing, and the real page takes over once written
              <iframe className="pv-frame" title="The page being written" sandbox="" srcDoc={shownLive.replace(/<script[\s\S]*?(<\/script>|$)/gi, "")} />
            ) : (
              <iframe ref={frame} key={`${preview!.url}${preview!.nonce}${nonce}`} className="pv-frame" title={`Preview of ${preview!.target}`} src={preview!.url} />
            )}
          </div>
        ) : (
          <OriEmpty pose="camera" title="Nothing to show yet">
            <p>Claude opens the preview when it builds a page. Or type a file, a folder or a local address above.</p>
          </OriEmpty>
        )}
      </div>

      <AnimatePresence initial={false}>
        {(annotating || notes.length > 0) && (
          <motion.div className="pv-notes" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            {notes.length > 0 && (
              <ol className="pv-list">
                {notes.map((n, i) => (
                  <li key={n.id} className="pv-note">
                    <span className="pv-pin">{i + 1}</span>
                    <span className="pv-note-main">
                      <span className="pv-where mono">{n.sel ? `${n.label}${n.text ? ` "${n.text.slice(0, 40)}"` : ""}` : "Whole page"}</span>
                      {editing === n.id ? (
                        <input
                          autoFocus
                          className="pv-edit"
                          defaultValue={n.body}
                          aria-label="Edit the comment"
                          onBlur={(e) => {
                            setNotes(notes.map((x) => (x.id === n.id ? { ...x, body: e.target.value.trim() || x.body } : x)));
                            setEditing(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") setEditing(null);
                          }}
                        />
                      ) : (
                        <button className="btn pv-body" onClick={() => setEditing(n.id)}>
                          {n.body}
                        </button>
                      )}
                    </span>
                    <button className="btn b-ghost icon-btn sm" onClick={() => setNotes(notes.filter((x) => x.id !== n.id))} aria-label={`Remove comment ${i + 1}`} data-tip="Remove">
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ol>
            )}
            <form
              className="pv-draft"
              onSubmit={(e) => {
                e.preventDefault();
                addNote();
              }}
            >
              <span className="pv-target">
                {pick ? (
                  <>
                    <span className="pv-pin ghost">{notes.length + 1}</span> <span className="mono">{pick.label}</span>
                    {pick.text && <span className="muted"> "{pick.text.slice(0, 50)}"</span>}
                    <button type="button" className="btn b-link" onClick={() => setPick(null)}>
                      whole page instead
                    </button>
                  </>
                ) : (
                  <span className="muted">{annotating ? "Click an element, or comment on the whole page:" : "Comment on the whole page:"}</span>
                )}
              </span>
              <span className="pv-draft-row">
                <textarea
                  ref={draftRef}
                  rows={1}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      addNote();
                    }
                    if (e.key === "Escape") setPick(null);
                  }}
                  placeholder={pick ? "What should change here?" : "What should change?"}
                  aria-label="Comment"
                />
                <button className="btn b-outline sz-s" type="submit" disabled={!draft.trim()}>
                  Add
                </button>
              </span>
            </form>
            {notes.length > 0 && (
              <div className="pv-send">
                <button className="btn b-ghost sz-s" onClick={() => setNotes([])}>
                  <Trash2 size={13} /> Clear
                </button>
                <button className="btn b-peach sz-s" onClick={sendNotes} disabled={sending}>
                  {sending ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Send {notes.length} {notes.length === 1 ? "comment" : "comments"} to Claude
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
