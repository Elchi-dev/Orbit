import { useState } from "react";
import { Copy, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { Config, Mode, Profile } from "../../lib/types";
import { useStore } from "../../lib/store";
import { PROFILE_ICONS, ProfileIcon } from "./ProfileIcon";

const MODES: { id: Mode; label: string }[] = [
  { id: "manual", label: "Manual: you approve" },
  { id: "auto", label: "Auto: the judge approves, unsure asks you" },
  { id: "rules", label: "Rules: only your rules allow" },
  { id: "full", label: "Full: Claude decides, risky actions go to the judge" },
];
const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"];

function Switch({ label, help, value, onChange }: { label: string; help: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="toggle-row row-react">
      <span>
        <b>{label}</b>
        <span className="muted small">{help}</span>
      </span>
      <button className="switch" role="switch" aria-checked={value} aria-label={label} onClick={() => onChange(!value)} />
    </div>
  );
}

/** Settings page: pick a profile, change any of its settings, or make a new one. */
export function ProfilesPage({ draft, setDraft }: { draft: Config; setDraft: (c: Config) => void }) {
  const saved = useStore((s) => s.server?.profiles ?? []);
  const overrides = draft.profiles ?? {};
  // what the list looks like with unsaved changes applied
  const all: Profile[] = [
    // a saved custom profile lives in the overrides; once removed there it is gone
    ...saved.filter((p) => p.builtin || overrides[p.id]).map((p) => ({ ...p, ...(overrides[p.id] ?? {}) }) as Profile),
    ...Object.entries(overrides)
      .filter(([id]) => !saved.some((p) => p.id === id))
      .map(([id, o]) => ({ ...saved[0], ...o, id, builtin: false }) as Profile),
  ];
  const [sel, setSel] = useState(all[0]?.id ?? "pair");
  const p = all.find((x) => x.id === sel) ?? all[0];
  if (!p) return null;

  const setProfiles = (profiles: Config["profiles"]) => setDraft({ ...draft, profiles });
  const change = (patch: Partial<Profile>) => setProfiles({ ...overrides, [p.id]: { ...(overrides[p.id] ?? {}), ...patch } });
  const duplicate = () => {
    let id = `${p.id}-copy`;
    for (let i = 2; all.some((x) => x.id === id); i++) id = `${p.id}-copy-${i}`;
    const { id: _id, builtin: _b, ...fields } = p;
    setProfiles({ ...overrides, [id]: { ...fields, name: `${p.name} copy` } });
    setSel(id);
  };
  const remove = () => {
    const { [p.id]: _, ...rest } = overrides;
    setProfiles(rest);
    setSel("pair");
  };

  return (
    <>
      <h2>Profiles</h2>
      <p className="muted">
        A profile is the shape Orbit takes for a kind of work: who approves, which tools Claude gets, how the conversation looks and what Claude is
        told. Pick one when you launch a workspace, or switch in its header.
      </p>

      <label className="set-field">
        <span className="form-label">New workspaces start as</span>
        <div className="field">
          <select value={draft.workspaces.default_profile} onChange={(e) => setDraft({ ...draft, workspaces: { ...draft.workspaces, default_profile: e.target.value } })}>
            {all.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
      </label>

      <div className="prof-tabs" role="tablist" aria-label="Profiles">
        {all.map((x) => (
          <button key={x.id} role="tab" aria-selected={x.id === p.id} className={`btn prof-tab ${x.id === p.id ? "on" : ""}`} onClick={() => setSel(x.id)}>
            <ProfileIcon icon={x.icon} size={15} /> {x.name}
          </button>
        ))}
        <button className="btn b-ghost sz-s" onClick={duplicate} data-tip="A new profile, starting from this one">
          <Plus size={14} /> New
        </button>
      </div>

      <div className="prof-edit">
        <div className="two">
          <label className="set-field">
            <span className="form-label">Name</span>
            <div className="field">
              <input value={p.name} onChange={(e) => change({ name: e.target.value })} />
            </div>
          </label>
          <div className="set-field">
            <span className="form-label">Icon</span>
            <div className="prof-icons" role="radiogroup" aria-label="Icon">
              {Object.keys(PROFILE_ICONS).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={p.icon === k} aria-label={k} className={`btn icon-btn sm ${p.icon === k ? "on" : ""}`} onClick={() => change({ icon: k })}>
                  <ProfileIcon icon={k} size={15} />
                </button>
              ))}
            </div>
          </div>
        </div>
        <label className="set-field">
          <span className="form-label">Description</span>
          <div className="field">
            <input value={p.description} onChange={(e) => change({ description: e.target.value })} />
          </div>
        </label>

        <div className="two">
          <label className="set-field">
            <span className="form-label">Approvals</span>
            <div className="field">
              <select value={p.mode} onChange={(e) => change({ mode: e.target.value as Mode })}>
                {MODES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <div className="set-field">
            <span className="form-label">Looks like</span>
            <div className="seg" role="radiogroup" aria-label="Layout">
              {(["log", "terminal"] as const).map((l) => (
                <button key={l} type="button" role="radio" aria-checked={p.layout === l} className={`btn seg-opt ${p.layout === l ? "on" : ""}`} onClick={() => change({ layout: l })}>
                  {l === "log" ? "A conversation" : "A terminal"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <Switch label="Hands off" help="Nobody is asked anything: an approval that would wait means no, and Claude decides instead of asking questions." value={p.hands_off} onChange={(v) => change({ hands_off: v })} />
        <Switch label="Plan" help="Claude keeps a checklist of the work, shown above the composer." value={p.plan} onChange={(v) => change({ plan: v })} />
        <Switch label="Live preview and screenshots" help="A preview next to the conversation, and a tool for Claude to look at pages at phone and desktop width." value={p.preview} onChange={(v) => change({ preview: v })} />
        <Switch label="Web search on by default" help="Each workspace can still switch it in the composer." value={p.web} onChange={(v) => change({ web: v })} />

        <div className="two">
          <label className="set-field">
            <span className="form-label">Thinking effort</span>
            <div className="field">
              <select value={p.effort} onChange={(e) => change({ effort: e.target.value })}>
                {EFFORTS.map((e) => (
                  <option key={e} value={e}>
                    {e || "The global default"}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <label className="set-field">
            <span className="form-label">Steps per request</span>
            <div className="field">
              <input type="number" min={0} max={2000} value={p.max_steps} onChange={(e) => change({ max_steps: Number(e.target.value) || 0 })} />
            </div>
            <span className="muted small">Model calls one request may take; 0 means 200.</span>
          </label>
        </div>

        <label className="set-field">
          <span className="form-label">Tools</span>
          <div className="field">
            <input
              className="mono"
              value={p.tools.join(", ")}
              placeholder="All tools"
              onChange={(e) =>
                change({
                  tools: e.target.value
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
            />
          </div>
          <span className="muted small">
            Empty gives every tool. Otherwise a list like <code>read_file, grep, fetch_url, ui_*, mcp__github__*</code>.
          </span>
        </label>

        <label className="set-field">
          <span className="form-label">Instructions for Claude</span>
          <div className="field">
            <textarea rows={6} value={p.prompt} onChange={(e) => change({ prompt: e.target.value })} placeholder="How Claude should work under this profile." />
          </div>
        </label>

        <div className="mcp-acts">
          <button className="btn b-ghost sz-s" onClick={duplicate}>
            <Copy size={14} /> Duplicate
          </button>
          {p.builtin ? (
            overrides[p.id] && (
              <button className="btn b-ghost sz-s" onClick={remove} data-tip="Back to how it ships">
                <RotateCcw size={14} /> Reset
              </button>
            )
          ) : (
            <button className="btn b-ghost sz-s" onClick={remove}>
              <Trash2 size={14} /> Delete
            </button>
          )}
        </div>
      </div>
    </>
  );
}
