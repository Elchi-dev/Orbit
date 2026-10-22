import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Copy, Play, Plus, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { useStore } from "../../lib/store";
import { ago } from "../../lib/format";
import type { Workspace } from "../../lib/types";
import { Markdown } from "./Blocks";

type Schedule = { kind: "hourly"; every: number } | { kind: "daily" | "weekdays"; time: string } | { kind: "weekly"; day: number; time: string } | { kind: "hook" };
export interface Mission {
  id: string;
  title: string;
  prompt: string;
  schedule: Schedule;
  mode: "rules" | "auto";
  hook: string;
  enabled: number;
  next_run: number | null;
  last_run: number | null;
  last_status: string | null;
  last_text: string | null;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function describeSchedule(s: Schedule) {
  switch (s.kind) {
    case "hourly":
      return s.every === 1 ? "Every hour" : `Every ${s.every} hours`;
    case "daily":
      return `Every day at ${s.time}`;
    case "weekdays":
      return `Weekdays at ${s.time}`;
    case "weekly":
      return `${DAYS[s.day]}s at ${s.time}`;
    default:
      return "Only by its webhook";
  }
}

const when = (t: number) => {
  const d = new Date(t);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
};

function ScheduleFields({ value, onChange }: { value: Schedule; onChange: (s: Schedule) => void }) {
  const time = "time" in value ? value.time : "09:00";
  return (
    <div className="mis-sched">
      <div className="field">
        <select
          value={value.kind}
          aria-label="How often"
          onChange={(e) => {
            const k = e.target.value as Schedule["kind"];
            onChange(k === "hourly" ? { kind: "hourly", every: 1 } : k === "weekly" ? { kind: "weekly", day: 1, time } : k === "hook" ? { kind: "hook" } : { kind: k, time });
          }}
        >
          <option value="daily">Every day</option>
          <option value="weekdays">Weekdays</option>
          <option value="weekly">Once a week</option>
          <option value="hourly">Every few hours</option>
          <option value="hook">Only by webhook</option>
        </select>
      </div>
      {value.kind === "weekly" && (
        <div className="field">
          <select value={value.day} aria-label="Day" onChange={(e) => onChange({ ...value, day: Number(e.target.value) })}>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </div>
      )}
      {value.kind === "hourly" && (
        <div className="field mis-num">
          <input type="number" min={1} max={24} value={value.every} aria-label="Hours" onChange={(e) => onChange({ kind: "hourly", every: Number(e.target.value) || 1 })} />
          <span className="muted small">hours</span>
        </div>
      )}
      {"time" in value && (
        <div className="field mis-num">
          <input type="time" value={time} aria-label="Time" onChange={(e) => onChange({ ...value, time: e.target.value } as Schedule)} />
        </div>
      )}
    </div>
  );
}

function MissionRow({ m }: { m: Mission }) {
  const toast = useStore((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const running = m.last_status === "running";
  const hookUrl = `${location.origin}/hook/${m.hook}`;
  const patch = (b: object) => api.patch(`/api/missions/${m.id}`, b).catch((e) => toast({ title: "Not saved", body: (e as Error).message, tone: "warn" }));
  return (
    <li className={`mis ${open ? "open" : ""}`}>
      <div className="mis-row">
        <button className="mis-main" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="mis-title">{m.title || m.prompt.slice(0, 48)}</span>
          <span className="mis-sub">
            {describeSchedule(m.schedule)}
            {m.enabled && m.next_run ? `, next ${when(m.next_run)}` : m.enabled ? "" : ", paused"}
          </span>
          {running ? (
            <span className="vd lav">
              <i className="pulse" /> running
            </span>
          ) : m.last_run ? (
            <span className={`vd ${m.last_status === "done" ? "quiet" : "bad"}`}>
              <i /> {m.last_status === "done" ? `ran ${ago(m.last_run)}` : m.last_status}
            </span>
          ) : null}
          <ChevronDown size={14} className={`chev ${open ? "up" : ""}`} />
        </button>
        <button className="switch" role="switch" aria-checked={!!m.enabled} aria-label={`Run ${m.title || "this mission"} on its schedule`} onClick={() => patch({ enabled: !m.enabled })} />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="mis-body" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <p className="mis-prompt">{m.prompt}</p>
            <p className="muted small">
              {m.mode === "rules" ? "Rules only: anything your rules don't allow is refused." : "The judge decides; when it isn't sure, the answer is no."}
            </p>
            {m.last_text && (
              <div className="mis-report">
                <span className="form-label">Last report</span>
                <Markdown text={m.last_text} />
              </div>
            )}
            <div className="mis-hook">
              <span className="form-label">Webhook</span>
              <code className="mono">{`curl -X POST ${hookUrl} -d '{"text":"..."}'`}</code>
              <button
                className="btn b-ghost icon-btn sm"
                aria-label="Copy the webhook command"
                data-tip={copied ? "Copied" : "Copy"}
                onClick={() => {
                  navigator.clipboard.writeText(`curl -X POST ${hookUrl} -d '{"text":""}'`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
            <div className="mcp-acts">
              <button className="btn b-outline sz-s" disabled={running} onClick={() => api.post(`/api/missions/${m.id}/run`)}>
                <Play size={14} /> Run now
              </button>
              <button
                className="btn b-ghost sz-s"
                onClick={() => {
                  if (confirm(`Delete the mission "${m.title || m.prompt.slice(0, 40)}"?`)) api.del(`/api/missions/${m.id}`);
                }}
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

export function MissionsPanel({ ws }: { ws: Workspace }) {
  const toast = useStore((s) => s.toast);
  const missions = useStore((s) => s.missions[ws.id]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ title: string; prompt: string; schedule: Schedule; mode: "rules" | "auto" }>({
    title: "",
    prompt: "",
    schedule: { kind: "weekdays", time: "09:00" },
    mode: "rules",
  });
  useEffect(() => {
    api.get<Mission[]>(`/api/workspaces/${ws.id}/missions`).then((list) => useStore.setState((s) => ({ missions: { ...s.missions, [ws.id]: list } })));
  }, [ws.id]);
  const list = missions ?? [];

  return (
    <div className="missions">
      <p className="muted small">
        A mission is a request that runs here on its own, on a schedule or when its webhook is called. Nobody is there to approve, so it never
        waits: it does what your rules (or the judge) allow and reports back.
      </p>
      {list.length > 0 && (
        <ul className="mis-list">
          {list.map((m) => (
            <MissionRow key={m.id} m={m} />
          ))}
        </ul>
      )}
      {!adding ? (
        <button className="btn b-outline sz-m" onClick={() => setAdding(true)}>
          <Plus size={16} /> New mission
        </button>
      ) : (
        <form
          className="mcp-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.post(`/api/workspaces/${ws.id}/missions`, form);
              setAdding(false);
              setForm({ ...form, title: "", prompt: "" });
            } catch (err) {
              toast({ title: "Not saved", body: (err as Error).message, tone: "warn" });
            }
          }}
        >
          <label className="set-field">
            <span className="form-label">Name</span>
            <div className="field">
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Morning dependency check" autoFocus />
            </div>
          </label>
          <label className="set-field">
            <span className="form-label">What to do</span>
            <div className="field">
              <textarea rows={3} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} placeholder="Check for outdated dependencies and failing tests, and tell me what needs attention." />
            </div>
          </label>
          <div className="set-field">
            <span className="form-label">When</span>
            <ScheduleFields value={form.schedule} onChange={(schedule) => setForm({ ...form, schedule })} />
          </div>
          <div className="set-field">
            <span className="form-label">Who approves</span>
            <div className="seg" role="radiogroup" aria-label="Who approves">
              {(["rules", "auto"] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={form.mode === k} className={`btn seg-opt ${form.mode === k ? "on" : ""}`} onClick={() => setForm({ ...form, mode: k })}>
                  {k === "rules" ? "Only my rules" : "The judge"}
                </button>
              ))}
            </div>
          </div>
          <div className="mcp-acts">
            <button type="submit" className="btn b-lav sz-s">
              <Plus size={14} /> Add mission
            </button>
            <button type="button" className="btn b-ghost sz-s" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
