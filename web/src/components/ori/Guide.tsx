import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { create } from "zustand";
import { ArrowLeft, ArrowRight, Compass, X } from "lucide-react";
import { Ori, type OriPose } from "./Ori";
import { useStore } from "../../lib/store";

/* ---------- what Ori can explain ---------- */

interface Topic {
  id: string;
  title: string;
  pose: OriPose;
  body: ReactNode;
  tour?: "here";
}

const Kbd = ({ children }: { children: ReactNode }) => <kbd className="kbd">{children}</kbd>;

export const TOPICS: Topic[] = [
  {
    id: "sky",
    title: "Reading the sky",
    pose: "hi",
    body: (
      <>
        <p>Every planet is a workspace: a folder, a conversation and everything Claude did there.</p>
        <dl className="kv guide-kv">
          <dt>Closer to the sun</dt>
          <dd>used more recently</dd>
          <dt>Bigger</dt>
          <dd>more work went into it</dd>
          <dt>Sparks</dt>
          <dd>Claude is working there</dd>
          <dt>Peach pulse</dt>
          <dd>it's waiting for you</dd>
          <dt>Little moons</dt>
          <dd>helpers working for it</dd>
        </dl>
        <p>Drag to turn the sky, scroll to zoom, click a planet to fly in.</p>
      </>
    ),
  },
  {
    id: "gate",
    title: "How Claude asks first",
    pose: "needs",
    body: (
      <>
        <p>Every action Claude takes passes one gate, in this order:</p>
        <ol>
          <li>Things that only look (reading files, <code>ls</code>, <code>git status</code>) run straight away.</li>
          <li>Your rules decide next: "always allow this", "never that".</li>
          <li>Then the workspace's mode: <b>Manual</b> asks you, <b>Auto</b> lets a judge model allow the safe ones and ask about the rest, <b>Rules</b> runs only what a rule allows, <b>Full</b> decides on its own except for anything outside the folder.</li>
        </ol>
        <p>
          When I wave the flag, answer with <Kbd>Y</Kbd> allow, <Kbd>A</Kbd> always, <Kbd>N</Kbd> deny. Every file is saved before it changes, so you can undo. <Kbd>Esc</Kbd> stops a run, twice ends the shell too.
        </p>
      </>
    ),
  },
  {
    id: "profiles",
    title: "Ways of working",
    pose: "idle",
    body: (
      <>
        <p>A profile sets how a workspace works: who approves, which tools Claude has, how the conversation looks.</p>
        <ul>
          <li><b>Pair</b>: side by side, you approve changes.</li>
          <li><b>Terminal</b>: dense and keyboard first.</li>
          <li><b>Autopilot</b>: say what to build and walk away.</li>
          <li><b>Frontend</b>: a live preview next to the conversation.</li>
          <li><b>Research</b>: web search, nothing on your machine changes.</li>
        </ul>
        <p>Pick one when you launch, switch in a workspace's header, or make your own in Settings, Profiles.</p>
      </>
    ),
  },
  {
    id: "helpers",
    title: "Helpers",
    pose: "helpers",
    body: (
      <>
        <p>Claude can hand parts of a task to helpers that work at the same time. Each one shows up as a lane in the conversation, saying what it's doing and then what it found.</p>
        <p>Open a helper to see its whole run or send it a message. A builder can get its own git branch; when it's done you Merge or Discard. Helpers never get more permission than their workspace.</p>
      </>
    ),
  },
  {
    id: "panel",
    title: "Preview, docs and the board",
    pose: "drawing",
    body: (
      <>
        <p>The panel beside the conversation has three tabs, each a button in the dock:</p>
        <ul>
          <li><b>Preview</b>: the page Claude builds, live. Click Comment, point at anything and say what to change.</li>
          <li><b>Docs</b>: plans and notes you both edit. Select a passage to comment on it.</li>
          <li><b>Board</b>: notes, screenshots and arrows Claude lays out for you, and you rearrange.</li>
        </ul>
      </>
    ),
  },
  {
    id: "missions",
    title: "Missions",
    pose: "planning",
    body: (
      <p>
        A mission is a request that runs on a schedule or when a webhook is called, while you're away. It never waits for an answer: anything a rule or the judge doesn't allow is refused, and you get a report. Find them in a workspace's dock.
      </p>
    ),
  },
  {
    id: "keys",
    title: "Shortcuts",
    pose: "working",
    body: (
      <dl className="kv guide-kv">
        <dt><Kbd>Ctrl K</Kbd></dt>
        <dd>search everything</dd>
        <dt><Kbd>Ctrl ,</Kbd></dt>
        <dd>settings</dd>
        <dt><Kbd>?</Kbd></dt>
        <dd>ask me</dd>
        <dt><Kbd>/</Kbd></dt>
        <dd>commands, in the composer</dd>
        <dt><Kbd>Enter</Kbd></dt>
        <dd>send; Shift Enter for a new line</dd>
        <dt><Kbd>Esc</Kbd></dt>
        <dd>stop the run; twice ends the shell</dd>
        <dt><Kbd>Y</Kbd> <Kbd>A</Kbd> <Kbd>N</Kbd></dt>
        <dd>answer an approval</dd>
      </dl>
    ),
  },
];

/* ---------- the guided tours ---------- */

interface Step {
  target: string;
  title: string;
  text: string;
  pose: OriPose;
}

const SKY_TOUR: Step[] = [
  { target: "[data-tour=sky]", title: "This is your sky", text: "Every planet is a workspace. Closer to the sun means used recently, bigger means more work. A peach pulse means one needs you.", pose: "hi" },
  { target: "[data-tour=launch]", title: "Start here", text: "Say what you want done and press Launch. The button on the left picks how Claude works, the folder button where.", pose: "thinking" },
  { target: "[data-tour=search]", title: "Find anything", text: "Search every workspace and conversation. Ctrl K works from anywhere.", pose: "searching" },
  { target: "[data-tour=list]", title: "All of them as a list", text: "Workspaces by name, with the ones that need you on top.", pose: "reading" },
  { target: "[data-tour=budget]", title: "What it costs", text: "Today's spending. Set a daily budget in Settings and Orbit stops before it.", pose: "planning" },
  { target: "[data-tour=settings]", title: "Settings", text: "Your key, models, approvals and rules, profiles, the programs Orbit knows, and how much things move.", pose: "working" },
  { target: "[data-tour=ori]", title: "And me", text: "Ask me anything about Orbit here, or press ? any time.", pose: "hi" },
];

const WORKSPACE_TOUR: Step[] = [
  { target: ".crumbs", title: "This workspace", text: "Its name (click to rename) and the folder Claude works in. The star takes you back to the sky.", pose: "idle" },
  { target: ".cockpit-actions .profile-picker", title: "How it works", text: "The profile: pair, terminal, autopilot, frontend or research. Switch any time.", pose: "thinking" },
  { target: ".cockpit-actions .mode-switch", title: "Who approves", text: "Manual asks you, Auto lets a judge decide the safe ones, Rules runs only what your rules allow, Full decides on its own inside the folder.", pose: "needs" },
  { target: ".hud", title: "That's me up there", text: "I show what Claude is doing right now. Click the pill for context, speed and cost.", pose: "working" },
  { target: ".stream", title: "The conversation", text: "Every action is a row that says who let it through. Open one for the output, the diff and the reason.", pose: "reading" },
  { target: ".composer-wrap", title: "Talk to Claude", text: "Type and press Enter. While Claude works, what you send joins its next step. Type / for commands, drop files to attach.", pose: "writing" },
  { target: ".dock", title: "The dock", text: "The shell, changes to review, git, missions, memory and settings. Below them: Preview, Docs and Board.", pose: "drawing" },
];

/* ---------- state ---------- */

interface GuideState {
  open: boolean;
  topic: string | null;
  tour: { steps: Step[]; i: number } | null;
  setOpen: (open: boolean, topic?: string | null) => void;
  startTour: (which: "sky" | "workspace") => void;
  setStep: (i: number) => void;
  endTour: () => void;
}

const mark = (k: string) => {
  try {
    localStorage.setItem(k, "1");
  } catch {}
};
export const seen = (k: string) => {
  try {
    return localStorage.getItem(k) === "1";
  } catch {
    return true;
  }
};

export const useGuide = create<GuideState>((set) => ({
  open: false,
  topic: null,
  tour: null,
  setOpen: (open, topic = null) => set({ open, topic }),
  startTour: (which) => {
    mark(`orbit.tour.${which}`);
    const steps = (which === "sky" ? SKY_TOUR : WORKSPACE_TOUR).filter((s) => document.querySelector(s.target));
    if (steps.length) set({ tour: { steps, i: 0 }, open: false });
  },
  setStep: (i) => set((s) => (s.tour ? { tour: { ...s.tour, i } } : s)),
  endTour: () => set({ tour: null }),
}));

/** The ? key opens Ori unless you're typing. */
export function useGuideShortcut() {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "?" || e.metaKey || e.ctrlKey || t.closest("input,textarea,select,[contenteditable=true]")) return;
      e.preventDefault();
      const g = useGuide.getState();
      g.setOpen(!g.open);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useGuide.getState().open) useGuide.getState().setOpen(false);
    };
    window.addEventListener("keydown", esc);
    window.addEventListener("keydown", on);
    return () => {
      window.removeEventListener("keydown", on);
      window.removeEventListener("keydown", esc);
    };
  }, []);
}

/* ---------- the button and the panel ---------- */

export function AskOri({ nudge }: { nudge?: "sky" | "workspace" }) {
  const { open, topic, tour, setOpen, startTour } = useGuide();
  const [hover, setHover] = useState(false);
  const [showNudge, setShowNudge] = useState(false);
  const where = useStore((s) => (s.view.kind === "ws" ? "workspace" : "sky")) as "sky" | "workspace";
  useEffect(() => {
    if (!nudge || seen(`orbit.tour.${nudge}`) || seen(`orbit.nudged.${nudge}`)) return;
    const t = setTimeout(() => setShowNudge(true), 1400);
    return () => clearTimeout(t);
  }, [nudge]);
  const dismissNudge = () => {
    setShowNudge(false);
    mark(`orbit.nudged.${nudge}`);
  };
  const current = TOPICS.find((t) => t.id === topic);
  if (tour) return null;
  return (
    <div className="ask-ori" data-tour="ori">
      <AnimatePresence>
        {open && (
          <motion.section
            className="guide glass panel"
            role="dialog"
            aria-label="Ask Ori"
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97, transition: { duration: 0.16 } }}
            transition={{ type: "spring", stiffness: 340, damping: 28 }}
            style={{ transformOrigin: "bottom left" }}
          >
            <header className="guide-head">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={current?.pose ?? "hi"} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                  <Ori pose={current?.pose ?? "hi"} size={76} />
                </motion.span>
              </AnimatePresence>
              <div className="bubble">
                {current ? (
                  <strong>{current.title}</strong>
                ) : (
                  <>
                    <strong>Hi, I'm Ori.</strong> What would you like to know?
                  </>
                )}
              </div>
              <button className="btn b-ghost icon-btn sm guide-x" onClick={() => setOpen(false)} aria-label="Close">
                <X size={15} />
              </button>
            </header>
            <AnimatePresence mode="wait" initial={false}>
              {current ? (
                <motion.div key={current.id} className="guide-body" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }}>
                  <div className="guide-text">{current.body}</div>
                  <button className="btn b-ghost sz-s" onClick={() => setOpen(true, null)}>
                    <ArrowLeft size={14} /> Something else
                  </button>
                </motion.div>
              ) : (
                <motion.div key="menu" className="guide-body" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.2 }}>
                  <button className="btn guide-tour" onClick={() => startTour(where)}>
                    <Compass size={17} /> Show me around {where === "sky" ? "the sky" : "this workspace"}
                    <ArrowRight size={15} className="nudge-right" />
                  </button>
                  <ul className="guide-topics">
                    {TOPICS.map((t, i) => (
                      <li key={t.id} className="rise" style={{ "--i": i } as any}>
                        <button className="btn guide-topic" onClick={() => setOpen(true, t.id)}>
                          <Ori pose={t.pose} size={30} still />
                          <span>{t.title}</span>
                          <ArrowRight size={14} className="nudge-right" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <a className="btn b-ghost sz-s guide-setup" href="#/welcome" onClick={() => setOpen(false)}>
                    Run the setup again
                  </a>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showNudge && !open && (
          <motion.div className="ori-nudge glass panel" initial={{ opacity: 0, y: 8, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6 }} style={{ transformOrigin: "bottom left" }}>
            <p>{nudge === "sky" ? "New here? I can show you around the sky." : "First time in a workspace? I can show you what's where."}</p>
            <div>
              <button
                className="btn b-lav sz-s"
                onClick={() => {
                  dismissNudge();
                  startTour(nudge!);
                }}
              >
                Show me
              </button>
              <button className="btn b-ghost sz-s" onClick={dismissNudge}>
                Not now
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <button
        className={`btn ask-ori-btn ${open ? "on" : ""}`}
        onClick={() => {
          setShowNudge(false);
          setOpen(!open);
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        aria-expanded={open}
        aria-label="Ask Ori, the guide"
      >
        <Ori pose={hover || showNudge ? "hi" : "idle"} size={40} title="Ori" />
        <span>Ask Ori</span>
      </button>
    </div>
  );
}

/* ---------- the spotlight ---------- */

export function Tour() {
  const { tour, setStep, endTour } = useGuide();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const step = tour?.steps[tour.i];

  useLayoutEffect(() => {
    if (!step) return;
    const measure = () => {
      const el = document.querySelector(step.target);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    window.addEventListener("resize", measure);
    const t = setInterval(measure, 500);
    return () => {
      window.removeEventListener("resize", measure);
      clearInterval(t);
    };
  }, [step?.target]);

  useEffect(() => {
    if (!tour) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") endTour();
      if (e.key === "ArrowRight" || e.key === "Enter") tour.i < tour.steps.length - 1 ? setStep(tour.i + 1) : endTour();
      if (e.key === "ArrowLeft" && tour.i > 0) setStep(tour.i - 1);
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [tour]);

  if (!tour || !step) return null;
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r = rect ?? new DOMRect(vw / 2 - 40, vh / 2 - 40, 80, 80);
  // a target as big as the screen gets a spotlight inset from the edges
  const big = r.width > vw * 0.8 && r.height > vh * 0.6;
  const spot = big ? { left: 24, top: 70, width: vw - 48, height: vh - 140 } : { left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
  const cardW = Math.min(360, vw - 32);
  const below = spot.top + spot.height + 220 < vh;
  const cardTop = big ? vh / 2 - 90 : below ? spot.top + spot.height + 14 : Math.max(16, spot.top - 14 - 200);
  const cardLeft = Math.min(Math.max(16, (big ? vw / 2 : spot.left + spot.width / 2) - cardW / 2), vw - cardW - 16);
  const last = tour.i === tour.steps.length - 1;
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="A tour of Orbit">
      <button className="tour-dim" onClick={endTour} aria-label="End the tour" tabIndex={-1} />
      <div className="tour-spot" style={spot} />
      <motion.div
        ref={card}
        key={tour.i}
        className="tour-card glass panel"
        style={{ left: cardLeft, top: cardTop, width: cardW }}
        initial={{ opacity: 0, y: below ? -8 : 8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 360, damping: 28 }}
      >
        <Ori pose={step.pose} size={72} />
        <div className="tour-text">
          <strong>{step.title}</strong>
          <p>{step.text}</p>
          <div className="tour-foot">
            <span className="tour-dots" aria-label={`Step ${tour.i + 1} of ${tour.steps.length}`}>
              {tour.steps.map((_, i) => (
                <i key={i} className={i === tour.i ? "on" : ""} />
              ))}
            </span>
            {tour.i > 0 && (
              <button className="btn b-ghost sz-s" onClick={() => setStep(tour.i - 1)}>
                Back
              </button>
            )}
            <button className="btn b-lav sz-s" autoFocus onClick={() => (last ? endTour() : setStep(tour.i + 1))}>
              {last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
