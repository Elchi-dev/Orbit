import { helpersBusy, helpersLine, needsYou } from "../../lib/helpers";
import { useEffect, useRef } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import type { Workspace } from "../../lib/types";
import { ago, money, tokens } from "../../lib/format";

/**
 * The Orrery without WebGL: same layout, same order, drawn with plain elements.
 * Used when the browser cannot create a WebGL context (disabled, blocklisted GPU driver, some VMs),
 * so the home screen still works instead of going blank.
 */
export function FlatOrrery({ workspaces, onSelect, motion }: { workspaces: Workspace[]; onSelect: (id: string) => void; motion: "full" | "calm" | "off" }) {
  const sorted = [...workspaces].sort((a, b) => b.updated_at - a.updated_at);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const speed = motion === "full" ? 1 : motion === "calm" ? 0.25 : 0;

  const layout = sorted.map((ws, i) => {
    const r = 2.9 + i * 1.3 + (i > 2 ? 0.8 : 0);
    return { ws, r, phase: i * 2.39996, size: Math.min(64, Math.max(22, 18 + Math.log10((ws.stats?.tokens ?? 0) + 10) * 7)) };
  });
  const maxR = Math.max(6, ...layout.map((l) => l.r));

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const secs = (t - start) / 1000;
      layout.forEach((l, i) => {
        const el = refs.current[i];
        if (!el) return;
        const a = l.phase + secs * speed * (0.55 / Math.pow(l.r, 1.15)) * (l.ws.running ? 2.6 : 1);
        const x = (Math.cos(a) * l.r) / maxR;
        const y = (Math.sin(a) * l.r * 0.42) / maxR;
        el.style.left = `${50 + x * 46}%`;
        el.style.top = `${46 + y * 46}%`;
        el.style.zIndex = String(Math.round(100 + y * 100));
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [workspaces, speed]);

  return (
    <div className="flat-orrery">
      {layout.map((l) => (
        <span
          key={`ring-${l.ws.id}`}
          className="flat-ring"
          style={{ width: `${(l.r / maxR) * 92}%`, height: `${(l.r / maxR) * 92 * 0.42}%` }}
          aria-hidden="true"
        />
      ))}
      <span className="flat-sun" aria-hidden="true" />
      {layout.map((l, i) => (
        <button key={l.ws.id} ref={(el) => {
            refs.current[i] = el;
          }} className="flat-planet" onClick={() => onSelect(l.ws.id)} aria-label={`Open ${l.ws.title}`}>
          <span
            className={`flat-body ${l.ws.pending ? "need" : l.ws.running ? "busy" : ""}`}
            style={{ width: l.size, height: l.size, background: `radial-gradient(circle at 32% 30%, #ffffff55, ${l.ws.style?.color ?? "#B8A6FF"} 45%, #0a0a1a 120%)` }}
          />
          <span className="planet-label">
            <span className="pl-title">{l.ws.title}</span>
            <span className={`pl-state ${needsYou(l.ws) ? "need" : l.ws.running || helpersBusy(l.ws) ? "busy" : ""}`}>
              {needsYou(l.ws) ? (
                <>
                  <AlertCircle size={12} /> needs you
                </>
              ) : l.ws.running || helpersBusy(l.ws) ? (
                <>
                  <Loader2 size={12} className="spin" /> {helpersLine(l.ws)}
                </>
              ) : (
                ago(l.ws.updated_at)
              )}
            </span>
            <span className="pl-more">
              {tokens(l.ws.stats?.tokens)} tokens, {money(l.ws.stats?.cost)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

let webgl: boolean | null = null;
/** Asked once: can this browser create a WebGL 2 context? Three.js needs version 2. */
export function hasWebGL() {
  if (webgl != null) return webgl;
  try {
    const c = document.createElement("canvas");
    webgl = !!c.getContext("webgl2");
  } catch {
    webgl = false;
  }
  return webgl;
}
