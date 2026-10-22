import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Compass, ExternalLink, KeyRound, Loader2, Lock } from "lucide-react";
import { api } from "../../lib/api";
import { useStore } from "../../lib/store";
import type { Mode } from "../../lib/types";
import { Ori, type OriPose } from "./Ori";
import { Galaxy } from "../ui/Galaxy";
import { ProfileIcon } from "../profiles/ProfileIcon";
import { MODES } from "../cockpit/ModeSwitch";
import { useGuide } from "./Guide";

type StepId = "hi" | "key" | "profile" | "mode" | "ready";

const POSE: Record<StepId, OriPose> = { hi: "hi", key: "reading", profile: "thinking", mode: "needs", ready: "done" };

const MODE_PLAIN: Record<Mode, string> = {
  manual: "I'll ask you before anything changes your computer. The safest place to start.",
  auto: "A second, cheaper model allows the safe things and asks you about the rest.",
  rules: "Only what your rules allow runs; everything else is refused. Good for unattended runs.",
  full: "Claude decides on its own inside the folder. Anything outside it, or anything that escalates, goes to the judge.",
};

/** First start: Ori walks you through the key, how you like to work and who approves. */
export function Welcome({ onDone }: { onDone: () => void }) {
  const server = useStore((s) => s.server);
  const loadServer = useStore((s) => s.loadServer);
  const needKey = !server?.hasKey && !server?.mock;
  const steps: StepId[] = ["hi", ...(needKey ? (["key"] as StepId[]) : []), "profile", "mode", "ready"];
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const step = steps[Math.min(i, steps.length - 1)];
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState(server?.config.workspaces.default_profile ?? "pair");
  const [mode, setMode] = useState<Mode>((server?.config.permissions.default_mode as Mode) ?? "manual");
  const go = (d: number) => {
    setDir(d);
    setErr("");
    setI((n) => Math.max(0, Math.min(steps.length - 1, n + d)));
  };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape" && server?.hasKey) onDone();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [server?.hasKey]);

  async function saveKey() {
    setBusy(true);
    setErr("");
    try {
      await api.post("/api/key", { key });
      await loadServer();
      go(1);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveChoices() {
    setBusy(true);
    try {
      await api.put("/api/config", { workspaces: { default_profile: profile }, permissions: { default_mode: mode } });
      try {
        localStorage.setItem("orbit.profile", profile);
      } catch {}
      await loadServer();
      go(1);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function finish(tour: boolean) {
    try {
      localStorage.setItem("orbit.welcomed", "1");
    } catch {}
    onDone();
    if (tour) setTimeout(() => useGuide.getState().startTour("sky"), 900);
  }

  const profiles = (server?.profiles ?? []).filter((p) => p.builtin !== false).slice(0, 6);

  return (
    <div className="welcome">
      <div className="welcome-stage">
        <motion.div className="welcome-ori" initial={{ scale: 0.3, opacity: 0, rotate: -30 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 70, damping: 13 }}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={step} initial={{ opacity: 0, scale: 0.85, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.85, y: -10 }} transition={{ type: "spring", stiffness: 260, damping: 22 }}>
              <Ori pose={POSE[step]} size={240} />
            </motion.span>
          </AnimatePresence>
        </motion.div>

        <motion.section className="welcome-card glass panel" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, type: "spring", stiffness: 200, damping: 24 }} aria-live="polite">
          <div className="welcome-progress" aria-label={`Step ${i + 1} of ${steps.length}`}>
            {steps.map((s, n) => (
              <i key={s} className={n === i ? "on" : n < i ? "done" : ""} />
            ))}
          </div>
          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div
              key={step}
              className="welcome-step"
              custom={dir}
              initial={{ opacity: 0, x: 24 * dir }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 * dir, transition: { duration: 0.14 } }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
            >
              {step === "hi" && (
                <>
                  <h1>Hi, I'm Ori.</h1>
                  <p>Orbit gives Claude a real shell and your files, with a gate in front of everything that changes your computer. I'll help you set it up. It takes a minute.</p>
                  <button className="btn b-peach sz-l gbtn welcome-go" onClick={() => go(1)}>
                    <Galaxy />
                    <span className="lbl">
                      Get started <ArrowRight size={18} />
                    </span>
                  </button>
                </>
              )}
              {step === "key" && (
                <form
                  className="welcome-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (key.trim()) saveKey();
                  }}
                >
                  <h1>First, your key</h1>
                  <p>Paste your Anthropic API key. I check it once, encrypt it and keep it on this computer. It only ever goes to the Anthropic API.</p>
                  <div className={`field ${err ? "shake" : ""}`}>
                    <KeyRound size={18} className="field-icon" />
                    <label htmlFor="key" className="sr">
                      API key
                    </label>
                    <input id="key" type="password" autoFocus value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-..." autoComplete="off" />
                  </div>
                  {err && <p className="bad-text small">{err}</p>}
                  <div className="welcome-nav">
                    <button type="button" className="btn b-ghost sz-m" onClick={() => go(-1)}>
                      <ArrowLeft size={16} /> Back
                    </button>
                    <button className="btn b-peach sz-m" disabled={!key.trim() || busy}>
                      {busy ? <Loader2 size={16} className="spin" /> : null} {busy ? "Checking" : "Continue"} {!busy && <ArrowRight size={16} className="nudge-right" />}
                    </button>
                  </div>
                  <p className="welcome-foot">
                    <Lock size={13} /> No account, no telemetry.{" "}
                    <a className="lnk" href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">
                      Get a key <ExternalLink size={12} />
                    </a>
                  </p>
                </form>
              )}
              {step === "profile" && (
                <>
                  <h1>How do you like to work?</h1>
                  <p>This is where new workspaces start. You can pick another for any workspace, any time.</p>
                  <div className="welcome-choices" role="radiogroup" aria-label="Starting profile">
                    {profiles.map((p, n) => (
                      <button key={p.id} role="radio" aria-checked={profile === p.id} className={`btn welcome-choice rise ${profile === p.id ? "on" : ""}`} style={{ "--i": n } as any} onClick={() => setProfile(p.id)}>
                        <ProfileIcon icon={p.icon} size={18} />
                        <span>
                          <b>{p.name}</b>
                          <small>{p.description}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="welcome-nav">
                    <button className="btn b-ghost sz-m" onClick={() => go(-1)}>
                      <ArrowLeft size={16} /> Back
                    </button>
                    <button className="btn b-peach sz-m" onClick={() => go(1)}>
                      Continue <ArrowRight size={16} className="nudge-right" />
                    </button>
                  </div>
                </>
              )}
              {step === "mode" && (
                <>
                  <h1>Who says yes?</h1>
                  <p>Everything Claude does passes one gate. Reading never waits. For the rest, choose who decides by default:</p>
                  <div className="welcome-choices" role="radiogroup" aria-label="Approval mode">
                    {MODES.map(({ id, label, Icon }, n) => (
                      <button key={id} role="radio" aria-checked={mode === id} className={`btn welcome-choice rise ${mode === id ? "on" : ""}`} style={{ "--i": n } as any} onClick={() => setMode(id)}>
                        <Icon size={18} />
                        <span>
                          <b>{label}</b>
                          <small>{MODE_PLAIN[id]}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                  {err && <p className="bad-text small">{err}</p>}
                  <div className="welcome-nav">
                    <button className="btn b-ghost sz-m" onClick={() => go(-1)}>
                      <ArrowLeft size={16} /> Back
                    </button>
                    <button className="btn b-peach sz-m" onClick={saveChoices} disabled={busy}>
                      {busy ? <Loader2 size={16} className="spin" /> : null} Continue <ArrowRight size={16} className="nudge-right" />
                    </button>
                  </div>
                </>
              )}
              {step === "ready" && (
                <>
                  <h1>All set!</h1>
                  <p>Type what you want done at the bottom of the sky and press Launch. Every workspace becomes a planet. If you ever wonder what something is, ask me: the button in the corner, or press <kbd className="kbd">?</kbd>.</p>
                  <div className="welcome-nav">
                    <button className="btn b-outline sz-m" onClick={() => finish(true)}>
                      <Compass size={16} /> Show me around
                    </button>
                    <button className="btn b-peach sz-l gbtn" onClick={() => finish(false)}>
                      <Galaxy />
                      <span className="lbl">
                        Open the sky <ArrowRight size={18} />
                      </span>
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </motion.section>
      </div>
    </div>
  );
}
