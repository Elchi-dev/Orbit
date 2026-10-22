import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookOpen, Bot, Boxes, Info, Layers, Plug, KeyRound, LayoutTemplate, ListChecks, Plus, Save, ShieldCheck, Trash2, UserRound, Wallet, X } from "lucide-react";
import { useStore } from "../lib/store";
import { api } from "../lib/api";
import type { Config, Rule } from "../lib/types";
import { ModeSwitch } from "./cockpit/ModeSwitch";
import { IntegrationsPage } from "./Integrations";
import { McpPage } from "./McpPage";
import { ProfilesPage } from "./profiles/ProfilesPage";
import { LibraryPage } from "./library/LibraryPage";

const TABS = [
  { id: "key", label: "API key", Icon: KeyRound },
  { id: "models", label: "Models", Icon: Bot },
  { id: "approvals", label: "Approvals", Icon: ShieldCheck },
  { id: "rules", label: "Rules", Icon: ListChecks },
  { id: "profiles", label: "Profiles", Icon: Layers },
  { id: "library", label: "Library", Icon: BookOpen },
  { id: "integrations", label: "Integrations", Icon: Plug },
  { id: "mcp", label: "MCP servers", Icon: Boxes },
  { id: "you", label: "About you", Icon: UserRound },
  { id: "interface", label: "Interface", Icon: LayoutTemplate },
  { id: "budget", label: "Budget", Icon: Wallet },
  { id: "about", label: "About Orbit", Icon: Info },
] as const;
type Tab = (typeof TABS)[number]["id"];

function Toggle({ label, help, value, onChange }: { label: string; help?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="toggle-row row-react">
      <span>
        <b>{label}</b>
        {help && <span className="muted small">{help}</span>}
      </span>
      <button className="switch" role="switch" aria-checked={value} aria-label={label} onClick={() => onChange(!value)} />
    </div>
  );
}

function Field({ label, children, help }: { label: string; children: React.ReactNode; help?: string }) {
  return (
    <label className="set-field">
      <span className="form-label">{label}</span>
      {children}
      {help && <span className="muted small">{help}</span>}
    </label>
  );
}

export function Settings() {
  const server = useStore((s) => s.server);
  const setOverlay = useStore((s) => s.setOverlay);
  const loadServer = useStore((s) => s.loadServer);
  const toast = useStore((s) => s.toast);
  const [tab, setTab] = useState<Tab>(() => (TABS.some((t) => t.id === useStore.getState().settingsTab) ? (useStore.getState().settingsTab as Tab) : "models"));
  const [draft, setDraft] = useState<Config | null>(server?.config ?? null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [newRule, setNewRule] = useState({ pattern: "", verdict: "allow" as Rule["verdict"] });
  const [key, setKey] = useState("");
  const [keyErr, setKeyErr] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(server?.config);

  useEffect(() => setDraft(server?.config ?? null), [server?.config]);
  const loadRules = () => api.get<Rule[]>("/api/rules").then(setRules);
  useEffect(() => {
    loadRules();
    window.addEventListener("orbit:rules", loadRules);
    return () => window.removeEventListener("orbit:rules", loadRules);
  }, []);

  if (!draft || !server) return null;
  const set = <K extends keyof Config>(k: K, v: Partial<Config[K]>) => setDraft({ ...draft, [k]: { ...draft[k], ...v } });
  const models = Object.keys(draft.pricing);

  async function save() {
    await api.put("/api/config", draft);
    await loadServer();
    toast({ title: "Settings saved", body: "Written to orbit.toml", tone: "good" });
  }

  return (
    <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && setOverlay(null)}>
      <motion.div
        className="settings glass panel"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        initial={{ opacity: 0, y: 30, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 30, scale: 0.97 }}
        transition={{ type: "spring", stiffness: 240, damping: 26 }}
      >
        <nav className="set-tabs" aria-label="Settings sections">
          <h1 className="display">Settings</h1>
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} className={`btn set-tab ${tab === id ? "on" : ""}`} onClick={() => setTab(id)} aria-current={tab === id}>
              {tab === id && <motion.span layoutId="set-hl" className="set-hl" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <Icon size={17} /> {label}
              {tab === id && <motion.span layoutId="tab-glow" className="tab-glow" transition={{ type: "spring", stiffness: 380, damping: 32 }} />}
            </button>
          ))}
        </nav>
        <div className="set-body">
          <button className="btn b-ghost icon-btn set-close" onClick={() => setOverlay(null)} aria-label="Close settings">
            <X size={18} />
          </button>
          <AnimatePresence mode="wait">
            <motion.div key={tab} className="set-page" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.22 }}>
              {tab === "profiles" && <ProfilesPage draft={draft} setDraft={setDraft} />}
              {tab === "library" && <LibraryPage draft={draft} setDraft={setDraft} />}
              {tab === "mcp" && <McpPage draft={draft} setServers={(servers) => setDraft({ ...draft, mcp: { servers } })} />}
              {tab === "integrations" && <IntegrationsPage draft={draft} set={(v) => set("integrations", v)} setCtx={(v) => set("context", v)} setSkills={(v) => set("skills", v)} />}
              {tab === "key" && (
                <>
                  <h2>Anthropic API key</h2>
                  <p className="muted">{server.hasKey ? "A key is saved, encrypted on this machine. It never reaches the browser." : "No key yet."}</p>
                  <form
                    className="key-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setKeyErr("");
                      try {
                        await api.post("/api/key", { key });
                        setKey("");
                        await loadServer();
                        toast({ title: "Key saved", tone: "good" });
                      } catch (err) {
                        setKeyErr((err as Error).message);
                      }
                    }}
                  >
                    <div className="field">
                      <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" aria-label="New API key" autoComplete="off" />
                    </div>
                    <button className="btn b-lav sz-m" disabled={!key}>
                      <KeyRound size={16} /> {server.hasKey ? "Replace key" : "Save key"}
                    </button>
                  </form>
                  {keyErr && <p className="bad-text small">{keyErr}</p>}
                  {server.hasKey && (
                    <button
                      className="btn b-danger sz-m"
                      onClick={async () => {
                        await api.del("/api/key");
                        loadServer();
                      }}
                    >
                      <Trash2 size={16} /> Remove key
                    </button>
                  )}
                </>
              )}
              {tab === "models" && (
                <>
                  <h2>Models</h2>
                  <Field label="Main model" help="Does the work in every workspace unless a workspace picks another.">
                    <div className="field">
                      <select value={draft.models.pilot} onChange={(e) => set("models", { pilot: e.target.value })}>
                        {models.map((m) => (
                          <option key={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                  </Field>
                  <Field label="Judge model" help="Checks actions in Auto mode. A cheaper model keeps this fast.">
                    <div className="field">
                      <select value={draft.models.judge} onChange={(e) => set("models", { judge: e.target.value })}>
                        {models.map((m) => (
                          <option key={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                  </Field>
                  <Field label="Title and summary model" help="Names workspaces and writes summaries when you clear history.">
                    <div className="field">
                      <select value={draft.models.scribe} onChange={(e) => set("models", { scribe: e.target.value })}>
                        {models.map((m) => (
                          <option key={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                  </Field>
                  <div className="two">
                    <Field label="Default effort">
                      <div className="field">
                        <select value={draft.models.effort} onChange={(e) => set("models", { effort: e.target.value })}>
                          {["low", "medium", "high", "xhigh", "max"].map((m) => (
                            <option key={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                    </Field>
                    <Field label="Max tokens per reply">
                      <div className="field">
                        <input type="number" min={1024} step={1024} value={draft.models.max_tokens} onChange={(e) => set("models", { max_tokens: Number(e.target.value) })} />
                      </div>
                    </Field>
                  </div>
                  <Field label="Show thinking" help="Summarized shows a readable thought trail; omitted hides it.">
                    <div className="field">
                      <select value={draft.models.thinking_display} onChange={(e) => set("models", { thinking_display: e.target.value })}>
                        <option value="summarized">summarized</option>
                        <option value="omitted">omitted</option>
                      </select>
                    </div>
                  </Field>
                </>
              )}
              {tab === "approvals" && (
                <>
                  <h2>Approvals</h2>
                  <Field label="Default mode for new workspaces">
                    <ModeSwitch value={draft.permissions.default_mode} onChange={(m) => set("permissions", { default_mode: m })} />
                  </Field>
                  <Toggle
                    label="Skip read-only actions"
                    help="Reading files and commands like ls, cat, rg or git status run without asking. This keeps Auto mode fast."
                    value={draft.permissions.skip_readonly}
                    onChange={(v) => set("permissions", { skip_readonly: v })}
                  />
                  <Field label="Notes for the judge" help="Plain language the judge must follow, for every workspace.">
                    <div className="field">
                      <textarea
                        rows={6}
                        value={draft.permissions.judge_notes}
                        onChange={(e) => set("permissions", { judge_notes: e.target.value })}
                        placeholder={"rm -rf is allowed, don't block it.\nNever touch ~/.ssh or ~/.aws.\nnpm installs are fine."}
                      />
                    </div>
                  </Field>
                  <div className="two">
                    <Field label="Messages the judge sees">
                      <div className="field">
                        <input type="number" min={0} max={30} value={draft.permissions.judge_context_messages} onChange={(e) => set("permissions", { judge_context_messages: Number(e.target.value) })} />
                      </div>
                    </Field>
                    <Field label="Judge timeout (seconds)" help="On timeout Orbit asks you.">
                      <div className="field">
                        <input type="number" min={2} max={60} value={draft.permissions.judge_timeout_ms / 1000} onChange={(e) => set("permissions", { judge_timeout_ms: Number(e.target.value) * 1000 })} />
                      </div>
                    </Field>
                  </div>
                  <Toggle label="Undo journal" help="Save every file before Claude changes it." value={draft.safety.undo_journal} onChange={(v) => set("safety", { undo_journal: v })} />
                  <Field label="Command timeout (seconds)">
                    <div className="field">
                      <input type="number" min={5} value={draft.safety.command_timeout_s} onChange={(e) => set("safety", { command_timeout_s: Number(e.target.value) })} />
                    </div>
                  </Field>
                </>
              )}
              {tab === "rules" && (
                <>
                  <h2>Rules</h2>
                  <p className="muted">
                    Rules decide instantly, before the judge or you. Patterns use <code>*</code> as a wildcard and match the command, <code>write /path</code> for file
                    changes, or <code>fetch https://…</code> for web requests.
                  </p>
                  <form
                    className="rule-add"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!newRule.pattern.trim()) return;
                      await api.post("/api/rules", newRule);
                      setNewRule({ ...newRule, pattern: "" });
                      loadRules();
                    }}
                  >
                    <div className="seg">
                      {(["allow", "ask", "deny"] as const).map((v) => (
                        <button type="button" key={v} className={`btn seg-opt ${newRule.verdict === v ? `on ${v}` : ""}`} onClick={() => setNewRule({ ...newRule, verdict: v })}>
                          {v === "allow" ? "Allow" : v === "ask" ? "Ask me" : "Block"}
                        </button>
                      ))}
                    </div>
                    <div className="field grow">
                      <input className="mono" value={newRule.pattern} onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })} placeholder="rm -rf ./build/*" aria-label="Rule pattern" />
                    </div>
                    <button className="btn b-lav sz-m">
                      <Plus size={16} /> Add
                    </button>
                  </form>
                  <ul className="rule-list">
                    <AnimatePresence initial={false}>
                      {rules.map((r, i) => (
                        <motion.li key={`${r.id}-${r.pattern}-${i}`} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 30 }} className="row-react">
                          <span className={`verdict v-${r.verdict}`}>{r.verdict === "allow" ? "Allow" : r.verdict === "ask" ? "Ask" : "Block"}</span>
                          <code className="mono rule-pat">{r.pattern}</code>
                          <span className="muted small">{r.source === "config" ? "orbit.toml" : r.scope === "global" ? "everywhere" : "one workspace"}</span>
                          {r.id != null ? (
                            <button
                              className="btn b-ghost icon-btn sm"
                              aria-label="Delete rule"
                              onClick={async () => {
                                await api.del(`/api/rules/${r.id}`);
                                loadRules();
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          ) : (
                            <span className="icon-btn sm" />
                          )}
                        </motion.li>
                      ))}
                    </AnimatePresence>
                    {rules.length === 0 && <li className="muted">No rules yet. "Always allow" in an approval adds one here.</li>}
                  </ul>
                </>
              )}
              {tab === "you" && (
                <>
                  <h2>About you</h2>
                  <p className="muted">Sent with every message in every workspace, unless the workspace says otherwise.</p>
                  <Field label="About you">
                    <div className="field">
                      <textarea rows={4} value={draft.profile.about} onChange={(e) => set("profile", { about: e.target.value })} placeholder="I'm a backend developer in Zurich. I mostly use TypeScript and Go." />
                    </div>
                  </Field>
                  <Field label="How Claude should work and answer">
                    <div className="field">
                      <textarea rows={6} value={draft.profile.instructions} onChange={(e) => set("profile", { instructions: e.target.value })} placeholder="Be brief. Use pnpm, not npm. Write commit messages in English." />
                    </div>
                  </Field>
                  <Toggle label="Plain writing style" help="Bans filler words like delve or seamless and emoji in replies." value={draft.ui.house_style} onChange={(v) => set("ui", { house_style: v })} />
                </>
              )}
              {tab === "interface" && (
                <>
                  <h2>Interface</h2>
                  <Field label="Motion">
                    <div className="seg">
                      {(["full", "calm", "off"] as const).map((m) => (
                        <button key={m} className={`btn seg-opt ${draft.ui.motion === m ? "on allow" : ""}`} onClick={() => set("ui", { motion: m })}>
                          {m === "full" ? "Full" : m === "calm" ? "Calm" : "Off"}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <h3>What Claude may change in the interface</h3>
                  <p className="muted small">Each one adds a little to every request while it's on.</p>
                  <Toggle label="Name workspaces automatically" help="A cheap model titles each new workspace." value={draft.ui_tools.auto_title} onChange={(v) => set("ui_tools", { auto_title: v })} />
                  <Toggle label="Rename workspaces" value={draft.ui_tools.set_title} onChange={(v) => set("ui_tools", { set_title: v })} />
                  <Toggle label="Restyle planets" value={draft.ui_tools.set_planet} onChange={(v) => set("ui_tools", { set_planet: v })} />
                  <Toggle label="Show charts and notes" value={draft.ui_tools.show} onChange={(v) => set("ui_tools", { show: v })} />
                  <Toggle label="Pin to memory" value={draft.ui_tools.pin} onChange={(v) => set("ui_tools", { pin: v })} />
                  <Toggle label="Send notifications" value={draft.ui_tools.notify} onChange={(v) => set("ui_tools", { notify: v })} />
                  <Toggle label="Write docs with you" help="Markdown documents in the side panel that you both edit and comment on." value={draft.ui_tools.docs} onChange={(v) => set("ui_tools", { docs: v })} />
                  <Toggle label="Use the whiteboard" help="A canvas in the side panel for notes, screenshots, options and flows." value={draft.ui_tools.whiteboard} onChange={(v) => set("ui_tools", { whiteboard: v })} />
                  <Toggle label="Build interactive widgets" help="Runs in a sandbox without network access." value={draft.ui_tools.widget} onChange={(v) => set("ui_tools", { widget: v })} />
                </>
              )}
              {tab === "budget" && (
                <>
                  <h2>Budget</h2>
                  <p className="muted">When a limit is reached, Orbit pauses and tells you. 0 means no limit.</p>
                  <div className="two">
                    <Field label="Per day (USD)">
                      <div className="field">
                        <input type="number" min={0} step={1} value={draft.budget.daily_usd} onChange={(e) => set("budget", { daily_usd: Number(e.target.value) })} />
                      </div>
                    </Field>
                    <Field label="Per workspace (USD)">
                      <div className="field">
                        <input type="number" min={0} step={1} value={draft.budget.workspace_usd} onChange={(e) => set("budget", { workspace_usd: Number(e.target.value) })} />
                      </div>
                    </Field>
                  </div>
                  <h3>Prices per million tokens</h3>
                  <table className="price-table">
                    <thead>
                      <tr>
                        <th>Model</th>
                        <th>Input</th>
                        <th>Output</th>
                        <th>Cache read</th>
                      </tr>
                    </thead>
                    <tbody>
                      {models.map((m) => (
                        <tr key={m}>
                          <td className="mono">{m}</td>
                          <td>${draft.pricing[m].input}</td>
                          <td>${draft.pricing[m].output}</td>
                          <td>${draft.pricing[m].cache_read}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="muted small">Edit prices in orbit.toml if they change.</p>
                </>
              )}
              {tab === "about" && (
                <>
                  <h2>Orbit {server.version}</h2>
                  <dl className="kv">
                    <dt>Config file</dt>
                    <dd className="mono">{server.configPath}</dd>
                    <dt>Data folder</dt>
                    <dd className="mono">{server.dataDir}</dd>
                    <dt>New workspaces go to</dt>
                    <dd className="mono">{draft.workspaces.home}</dd>
                    <dt>Mode</dt>
                    <dd>{server.mock ? "Mock model (no API calls)" : "Live"}</dd>
                  </dl>
                  <p className="muted small">Everything lives in one SQLite file in the data folder. Back it up by copying it.</p>
                </>
              )}
            </motion.div>
          </AnimatePresence>
          <AnimatePresence>
            {dirty && (
              <motion.div className="save-bar glass pill" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ type: "spring", stiffness: 300, damping: 24 }}>
                <span>Unsaved changes</span>
                <button className="btn b-ghost sz-s pill" onClick={() => setDraft(server.config)}>
                  Discard
                </button>
                <button className="btn b-peach sz-s pill" onClick={save}>
                  <Save size={15} /> Save
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
