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
    return { ws, r, phase: i * 2.39996, size: Math.min(88, Math.max(30, 22 + Math.log10((ws.stats?.tokens ?? 0) + 10) * 10)) };
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
        const y = (Math.sin(a) * l.r) / maxR;
        el.style.left = `${50 + x * 44}%`;
        el.style.top = `${44 + y * 44 * 0.5 * (innerWidth / innerHeight)}%`;
        el.style.zIndex = String(Math.round(100 + y * 100));
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [workspaces, speed]);

  return (
    <div className="flat-orrery">
      <span className="flat-nebula" aria-hidden="true" />
      <span className="flat-stars" aria-hidden="true" />
      <span className="flat-belt-wrap" aria-hidden="true">
        <span className="flat-belt">
          {BELT.map(([a, d, s, o], i) => (
            <i key={i} style={{ left: `${50 + Math.cos(a) * d * 50}%`, top: `${50 + Math.sin(a) * d * 50}%`, width: s, height: s, opacity: o }} />
          ))}
        </span>
      </span>
      {layout.map((l) => (
        <span
          key={`ring-${l.ws.id}`}
          className="flat-ring"
          style={{ width: `${(l.r / maxR) * 88}%`, height: `${(l.r / maxR) * 88 * 0.5 * (innerWidth / innerHeight)}%` }}
          aria-hidden="true"
        />
      ))}
      <span className="flat-sun" aria-hidden="true">
        <span className="flat-corona" />
      </span>
      {layout.map((l, i) => (
        <button key={l.ws.id} ref={(el) => {
            refs.current[i] = el;
          }} className="flat-planet" onClick={() => onSelect(l.ws.id)} aria-label={`Open ${l.ws.title}`}>
          <span className="flat-world" style={{ width: l.size, height: l.size, ["--c" as any]: l.ws.style?.color ?? "#B8A6FF" }}>
            {l.ws.style?.rings && <span className="flat-rings back" />}
            <span className={`flat-body s-${l.ws.style?.surface ?? "gas"} ${needsYou(l.ws) ? "need" : l.ws.running || helpersBusy(l.ws) ? "busy" : ""}`} />
            {l.ws.style?.rings && <span className="flat-rings front" />}
            {(l.ws.helpers ?? [])
              .filter((h) => h.state !== "merged" && h.state !== "discarded")
              .slice(-4)
              .map((h, k) => (
                <span key={h.id} className={`flat-moon ${h.running ? "busy" : ""}`} style={{ ["--d" as any]: `${-k * 1.7}s`, ["--r" as any]: `${l.size * (0.78 + k * 0.16)}px` }}>
                  <i />
                </span>
              ))}
          </span>
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

// the dust belt between the inner and outer planets: fixed, so it doesn't shimmer on every render
const BELT: [number, number, number, number][] = Array.from({ length: 360 }, (_, i) => {
  const r = (n: number) => {
    const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  return [r(1) * Math.PI * 2, 0.8 + r(2) * 0.18, 1.6 + r(3) * 2, 0.35 + r(4) * 0.6];
});

let webgl: boolean | null = null;
/** Asked once: can this browser create a WebGL 2 context? Three.js needs version 2. */
export function hasWebGL() {
  if (webgl != null) return webgl;
  // ?flat shows the CSS sky anywhere, for checking it
  if (typeof location !== "undefined" && new URLSearchParams(location.search).has("flat")) return (webgl = false);
  try {
    const c = document.createElement("canvas");
    webgl = !!c.getContext("webgl2");
  } catch {
    webgl = false;
  }
  return webgl;
}
