import { useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, ExternalLink, KeyRound, Loader2, Lock } from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { Logo } from "./Logo";

export function Onboarding() {
  const loadServer = useStore((s) => s.loadServer);
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api.post("/api/key", { key });
      await loadServer();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="onboard">
      <motion.div className="onboard-planet" initial={{ scale: 0.2, opacity: 0, rotate: -40 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 60, damping: 14 }} aria-hidden="true">
        <span className="ob-core" />
        <span className="ob-ring" />
      </motion.div>
      <motion.form className="onboard-card glass panel" onSubmit={submit} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, type: "spring", stiffness: 200, damping: 22 }}>
        <div className="ob-brand">
          <Logo size={26} /> <span className="display">orbit</span>
        </div>
        <h1 className="display">Connect Claude</h1>
        <p className="muted">Paste your Anthropic API key. It's checked once, encrypted and kept on this computer.</p>
        <div className="field">
          <KeyRound size={18} className="field-icon" />
          <label htmlFor="key" className="sr">
            API key
          </label>
          <input id="key" type="password" autoFocus value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" autoComplete="off" />
        </div>
        {err && (
          <motion.p className="bad-text small" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: [0, -6, 6, -3, 0] }}>
            {err}
          </motion.p>
        )}
        <button className="btn b-peach sz-l" disabled={!key.trim() || busy}>
          {busy ? <Loader2 size={18} className="spin" /> : <ArrowRight size={18} />} {busy ? "Checking the key" : "Continue"}
        </button>
        <p className="ob-foot small muted">
          <Lock size={13} /> Nothing leaves your machine except calls to the Anthropic API.{" "}
          <a className="lnk" href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">
            Get a key <ExternalLink size={12} />
          </a>
        </p>
      </motion.form>
    </div>
  );
}
