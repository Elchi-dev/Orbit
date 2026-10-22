import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Camera, ExternalLink, Laptop, Loader2, Monitor, RotateCw, Smartphone, Tablet, X } from "lucide-react";
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

export function PreviewPane({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const preview = useStore((s) => s.previews[ws.id]);
  const toast = useStore((s) => s.toast);
  const live = useLiveWrite(ws.id);
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
  const [shownLive, setShownLive] = useState("");
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
  useEffect(() => {
    const el = frameWrap.current;
    if (!el) return;
    const fit = () => setScale(vp.width && el.clientWidth < vp.width + 24 ? Math.max(0.3, (el.clientWidth - 24) / vp.width) : 1);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [vp.width]);

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
      const r = await api.post<{ image: string; console: string[]; width: number }>(`/api/workspaces/${ws.id}/screenshot`, { url: preview.url, width: vp.width || 1280 });
      window.dispatchEvent(new CustomEvent("orbit:attach", { detail: { workspaceId: ws.id, name: `${preview.target.replace(/[^\w.-]+/g, "-") || "page"}-${vp.width || 1280}.png`, mediaType: "image/png", data: r.image, note: r.console.length ? `Console:\n${r.console.join("\n")}` : "" } }));
      toast({ title: "Screenshot attached", body: r.console.length ? `${r.console.length} console ${r.console.length === 1 ? "message" : "messages"} added too.` : "Say what to change and send.", tone: "good" });
    } catch (e) {
      toast({ title: "No screenshot", body: (e as Error).message, tone: "warn" });
    } finally {
      setCapturing(false);
    }
  }

  const showLive = !!live && ws.running;
  return (
    <section className="preview" aria-label="Preview">
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
        <a className={`btn b-ghost icon-btn sm ${preview?.url ? "" : "disabled"}`} href={preview?.url || undefined} target="_blank" rel="noreferrer" aria-label="Open in a tab" data-tip="Open in a tab" data-tip-side="bottom">
          <ExternalLink size={15} />
        </a>
        <button className="btn b-ghost icon-btn sm" onClick={onClose} aria-label="Hide the preview" data-tip="Hide" data-tip-side="bottom">
          <X size={15} />
        </button>
      </div>
      <div className={`pv-stage ${vp.width ? "framed" : ""}`} ref={frameWrap}>
        <AnimatePresence>
          {showLive && (
            <motion.span className="pv-live" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <i /> Writing {live!.path}
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
              <iframe key={`${preview!.url}${preview!.nonce}${nonce}`} className="pv-frame" title={`Preview of ${preview!.target}`} src={preview!.url} />
            )}
          </div>
        ) : (
          <div className="pv-empty">
            <Monitor size={22} />
            <p>Nothing to show yet.</p>
            <p className="muted small">Claude opens the preview when it builds a page. Or type a file, a folder or a local address above.</p>
          </div>
        )}
      </div>
    </section>
  );
}
