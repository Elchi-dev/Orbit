import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Download, Eraser, Gauge, Layers, Scale, Timer, Wallet, Zap } from "lucide-react";
import { useStore } from "../../lib/store";
import { api } from "../../lib/api";
import type { Detail, Workspace } from "../../lib/types";
import { modelName, money, tokens } from "../../lib/format";

function Ring({ pct, size = 28 }: { pct: number; size?: number }) {
  const r = size / 2 - 2.5;
  const c = 2 * Math.PI * r;
  const hot = pct > 0.8;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="ctx-ring">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(242,239,255,.14)" strokeWidth="2.6" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={hot ? "#FFB199" : "#B8A6FF"}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, Math.max(0.015, pct)))}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(.22,1,.36,1), stroke .4s" }}
      />
    </svg>
  );
}

export function Hud({ ws, detail }: { ws: Workspace; detail?: Detail }) {
  const live = useStore((s) => s.live[ws.id]);
  const usage = useStore((s) => s.lastUsage[ws.id]);
  const server = useStore((s) => s.server);
  const [open, setOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const model = ws.model || server?.config.models.pilot || "";
  const ctxMax = usage?.context_max ?? server?.config.pricing[model]?.context ?? 1_000_000;
  const last = detail?.last;
  const ctxUsed = usage ? usage.context_used : detail?.messages.length ? (last ? last.input + last.cache_read + last.cache_write + last.output : 0) : 0;
  const pct = ctxUsed / ctxMax;
  const tps = ws.running ? live?.tps : usage?.tps ?? last?.tps;
  const u = usage?.usage ?? last;
  const cacheHit = u && u.input + u.cache_read + u.cache_write > 0 ? u.cache_read / (u.input + u.cache_read + u.cache_write) : null;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  async function clear(keepSummary: boolean) {
    setConfirmClear(false);
    setOpen(false);
    await api.post(`/api/workspaces/${ws.id}/clear`, { keepSummary });
  }

  return (
    <div className="hud" ref={ref}>
      <button className="btn hud-pill glass-soft pill" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Usage and context">
        <Ring pct={pct} />
        <span className="hud-model">{modelName(model)}</span>
        <span className={`hud-tps ${ws.running ? "live" : ""}`}>{tps ? `${Math.round(tps)} tok/s` : `${tokens(ctxUsed)} ctx`}</span>
        <ChevronDown size={15} className={`chev ${open ? "up" : ""}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="hud-pop glass panel"
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 340, damping: 26 }}
            style={{ transformOrigin: "top right" }}
          >
            <div className="hud-grid">
              <Stat Icon={Zap} label="Speed" value={tps ? `${Math.round(tps)} tok/s` : "idle"} />
              <Stat Icon={Timer} label="First token" value={usage?.ttft_ms ?? last?.ttft_ms ? `${((usage?.ttft_ms ?? last?.ttft_ms ?? 0) / 1000).toFixed(1)} s` : "not yet"} />
              <Stat Icon={Layers} label="Context" value={`${tokens(ctxUsed)} of ${tokens(ctxMax)}`} bar={pct} />
              <Stat Icon={Gauge} label="Cache hits" value={cacheHit != null ? `${Math.round(cacheHit * 100)}%` : "not yet"} />
              <Stat Icon={Wallet} label="This workspace" value={money(ws.stats?.cost)} />
              <Stat Icon={Wallet} label="Today" value={money(server?.today.cost)} />
              <Stat Icon={Scale} label="Judge here" value={money(detail?.judge?.cost)} accent />
              <Stat Icon={Layers} label="Tokens here" value={tokens(ws.stats?.tokens)} />
            </div>
            {server?.rate?.tokens_limit ? (
              <p className="muted small">Rate limit: {Math.round(((server.rate.tokens_remaining ?? 0) / server.rate.tokens_limit) * 100)}% of tokens left this minute</p>
            ) : null}
            <div className="hud-actions">
              {confirmClear ? (
                <motion.div className="confirm-row" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
                  <span>Clear the history?</span>
                  <button className="btn b-lav sz-s pill" onClick={() => clear(true)}>
                    Keep a summary
                  </button>
                  <button className="btn b-danger sz-s pill" onClick={() => clear(false)}>
                    Clear all
                  </button>
                </motion.div>
              ) : (
                <>
                  <button className="btn b-outline sz-m" onClick={() => setConfirmClear(true)} disabled={ws.running}>
                    <Eraser size={16} /> Clear history
                  </button>
                  <a className="btn b-ghost sz-m" href={`/api/workspaces/${ws.id}/export`} download>
                    <Download size={16} /> Export
                  </a>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Stat({ Icon, label, value, bar, accent }: { Icon: typeof Zap; label: string; value: string; bar?: number; accent?: boolean }) {
  return (
    <div className="stat">
      <span className="stat-label">
        <Icon size={14} /> {label}
      </span>
      <span className={`stat-value ${accent ? "accent" : ""}`}>{value}</span>
      {bar != null && (
        <span className="stat-bar">
          <i style={{ width: `${Math.min(100, Math.max(1, bar * 100))}%` }} className={bar > 0.8 ? "hot" : ""} />
        </span>
      )}
    </div>
  );
}
