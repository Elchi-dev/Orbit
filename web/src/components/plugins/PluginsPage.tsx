import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Download, ExternalLink, FolderOpen, Loader2, Plus, RefreshCw, RotateCw, Save, Sparkles, Terminal, Trash2, Wand2 } from "lucide-react";
import { api } from "../../lib/api";
import { useStore } from "../../lib/store";
import type { PluginInfo } from "../../lib/types";
import { Ori } from "../ori/Ori";
import { Galaxy } from "../ui/Galaxy";

const DOCS = "https://github.com/Elchi-dev/Orbit/blob/main/docs/PLUGINS.md";
const PERM: Record<string, string> = {
  workspaces: "reads your workspaces",
  agent: "starts Claude runs",
  model: "calls a model",
  events: "sees every event",
  approvals: "sees and answers approvals",
  api: "uses Orbit's whole API",
};
const STATE: Record<PluginInfo["state"], { label: string; tone: string }> = {
  off: { label: "Off", tone: "quiet" },
  starting: { label: "Starting", tone: "lav" },
  running: { label: "On", tone: "good" },
  crashed: { label: "Crashed", tone: "bad" },
  stopped: { label: "Off", tone: "quiet" },
  broken: { label: "Can't read it", tone: "bad" },
};

/** Settings, Plugins: what extends this Orbit, and making your own. */
export function PluginsPage() {
  const plugins = useStore((s) => s.plugins);
  const loadPlugins = useStore((s) => s.loadPlugins);
  const [dir, setDir] = useState("");
  const [mode, setMode] = useState<null | "install" | "new">(null);
  useEffect(() => {
    api.get<{ plugins: PluginInfo[]; dir: string }>("/api/plugins").then((r) => {
      useStore.setState({ plugins: r.plugins });
      setDir(r.dir);
    });
  }, []);

  return (
    <div className="rm">
      <header className="lib-head">
        <div>
          <h2>Plugins</h2>
          <p className="muted">
            Plugins add tools for Claude, slash commands, panels beside the conversation and checks before anything runs. Write one in any language, or let Claude write it.{" "}
            <a className="lnk" href={DOCS} target="_blank" rel="noreferrer">
              How plugins work <ExternalLink size={12} />
            </a>
          </p>
        </div>
        <Ori pose="helpers" size={68} />
      </header>

      <div className="lib-actions">
        <button className={`btn sz-m ${mode === "new" ? "b-peach" : "b-outline"}`} onClick={() => setMode(mode === "new" ? null : "new")} aria-expanded={mode === "new"}>
          <Plus size={16} /> New plugin
        </button>
        <button className={`btn sz-m ${mode === "install" ? "b-peach" : "b-outline"}`} onClick={() => setMode(mode === "install" ? null : "install")} aria-expanded={mode === "install"}>
          <Download size={16} /> Install
        </button>
        <button className="btn b-ghost sz-m" onClick={() => api.post("/api/plugins/reload", {}).then(() => loadPlugins())} data-tip="Look for new or changed plugins">
          <RefreshCw size={15} /> Reload
        </button>
      </div>

      <AnimatePresence initial={false} mode="wait">
        {mode === "install" && <Install key="i" done={() => setMode(null)} />}
        {mode === "new" && <NewPlugin key="n" done={() => setMode(null)} />}
      </AnimatePresence>

      <div className="pl-list">
        {plugins.length === 0 && (
          <div className="pl-empty">
            <Ori pose="idle" size={84} />
            <span className="muted small">
              No plugins yet. They live in <code>{dir || "~/.orbit/plugins"}</code>.
            </span>
          </div>
        )}
        {plugins.map((p, i) => (
          <Card key={p.id} p={p} i={i} />
        ))}
      </div>
    </div>
  );
}

function Install({ done }: { done: () => void }) {
  const toast = useStore((s) => s.toast);
  const [src, setSrc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    setBusy(true);
    setErr("");
    try {
      const r = await api.post<{ id: string; plugins: PluginInfo[] }>("/api/plugins/install", { source: src });
      useStore.setState({ plugins: r.plugins });
      toast({ title: "Plugin installed", body: "It's off until you switch it on. Check what it may do first.", tone: "good" });
      done();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <motion.form className="rm-sec" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} onSubmit={(e) => (e.preventDefault(), src.trim() && go())}>
      <label className="set-field">
        <span className="form-label">Git address or folder</span>
        <div className={`field ${err ? "shake" : ""}`}>
          <input value={src} onChange={(e) => setSrc(e.target.value)} placeholder="https://github.com/someone/orbit-plugin-thing or ~/code/my-plugin" spellCheck={false} autoFocus />
        </div>
        <span className="muted small">A plugin runs with your user's rights, like any program you install. Install only what you trust.</span>
      </label>
      {err && <p className="bad-text small">{err}</p>}
      <div className="lib-actions">
        <button className="btn b-peach sz-m" disabled={!src.trim() || busy}>
          {busy ? <Loader2 size={15} className="spin" /> : <Download size={15} />} Install
        </button>
      </div>
    </motion.form>
  );
}

function NewPlugin({ done }: { done: () => void }) {
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState("");
  const [lang, setLang] = useState<"typescript" | "python">("typescript");
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  async function create(withClaude: boolean) {
    setBusy(true);
    setErr("");
    try {
      const r = await api.post<{ dir: string; plugins: PluginInfo[] }>("/api/plugins/new", { id, name, language: lang, description: idea.split("\n")[0].slice(0, 160) });
      useStore.setState({ plugins: r.plugins });
      if (withClaude) {
        const ws = await api.post<{ id: string }>("/api/workspaces", { title: `Plugin: ${name}`, cwd: r.dir, profile: "pair" });
        useStore.getState().setOverlay(null);
        useStore.getState().setView({ kind: "ws", id: ws.id });
        setTimeout(
          () =>
            useStore.getState().send({
              type: "send",
              workspaceId: ws.id,
              text: `Build this Orbit plugin. This folder is the plugin "${name}" (id ${id}), made from the ${lang === "python" ? "Python" : "TypeScript"} template. Use the orbit-plugins skill.\n\nWhat it should do:\n${idea.trim()}`,
            }),
          500,
        );
      } else toast({ title: `${name} is ready`, body: `In ${r.dir}. Switch it on to try the example tool and panel.`, tone: "good" });
      done();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div className="rm-sec" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
      <label className="set-field">
        <span className="form-label">Name</span>
        <div className="field">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Linear issues" autoFocus />
        </div>
        {id && <span className="muted small">Folder ~/.orbit/plugins/{id}</span>}
      </label>
      <div className="set-field">
        <span className="form-label">Language</span>
        <div className="seg" role="radiogroup" aria-label="Language">
          {(["typescript", "python"] as const).map((l) => (
            <button key={l} role="radio" aria-checked={lang === l} className={`btn seg-btn ${lang === l ? "on" : ""}`} onClick={() => setLang(l)}>
              {lang === l && <motion.span layoutId="pl-lang" className="seg-hl" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <span>{l === "typescript" ? "TypeScript" : "Python"}</span>
            </button>
          ))}
        </div>
        <span className="muted small">TypeScript runs on Orbit itself, nothing to install. Any other language works too: see the docs.</span>
      </div>
      <label className="set-field">
        <span className="form-label">What should it do? (for Claude)</span>
        <textarea className="lib-req" value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="A tool that finds my open Linear issues, a /standup command that writes my standup from today's commits, and a panel listing what's assigned to me." />
      </label>
      {err && <p className="bad-text small">{err}</p>}
      <div className="lib-actions">
        <button className="btn b-peach sz-m gbtn" disabled={!id || id.length < 2 || !idea.trim() || busy} onClick={() => create(true)}>
          <Galaxy />
          <span className="lbl">
            <Wand2 size={16} /> Let Claude build it
          </span>
        </button>
        <button className="btn b-outline sz-m" disabled={!id || id.length < 2 || busy} onClick={() => create(false)}>
          Just the template
        </button>
      </div>
    </motion.div>
  );
}

function Card({ p, i }: { p: PluginInfo; i: number }) {
  const toast = useStore((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const m = p.manifest;
  const st = STATE[p.state] ?? STATE.off;
  const set = async (fn: () => Promise<{ plugins?: PluginInfo[] }>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r?.plugins) useStore.setState({ plugins: r.plugins });
    } catch (e) {
      toast({ title: m?.name ?? p.id, body: (e as Error).message, tone: "bad" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`pl-card rise ${open ? "open" : ""}`} style={{ "--i": Math.min(i, 10) } as any}>
      <div className="pl-top">
        <button className="btn pl-main" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="pl-title">
            <b>{m?.name ?? p.id}</b>
            {m && <span className="muted small">{m.version}</span>}
            <span className={`pl-state t-${st.tone}`}>
              <i />
              {st.label}
            </span>
          </span>
          <span className="muted small lib-desc">{m?.description || p.error}</span>
        </button>
        {m && (
          <button className="switch" role="switch" aria-checked={p.enabled} aria-label={`Use ${m.name}`} disabled={busy} onClick={() => set(() => api.put(`/api/plugins/${p.id}`, { enabled: !p.enabled }))} />
        )}
        <ChevronDown size={16} className={`pl-chev ${open ? "on" : ""}`} aria-hidden="true" />
      </div>
      {p.error && p.state !== "broken" && <p className="bad-text small pl-err">{p.error}</p>}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="pl-body" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: "spring", stiffness: 300, damping: 32 }}>
            <div className="pl-inner">
              {m && (
                <div className="pl-facts small">
                  {m.permissions.length > 0 && (
                    <div>
                      <span className="form-label">May</span>
                      <div className="pl-chips">
                        {m.permissions.map((x) => (
                          <span key={x} className="chip">
                            {PERM[x] ?? x}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {(p.tools.length > 0 || p.commands.length > 0 || m.contributes.panels.length > 0 || m.contributes.hooks.length > 0) && (
                    <div>
                      <span className="form-label">Adds</span>
                      <div className="pl-chips">
                        {p.tools.map((t) => (
                          <span key={t} className="chip chip-ui">
                            tool {t}
                          </span>
                        ))}
                        {p.commands.map((c) => (
                          <span key={c.name} className="chip">
                            /{c.name}
                          </span>
                        ))}
                        {m.contributes.panels.map((x) => (
                          <span key={x.id} className="chip">
                            panel {x.title}
                          </span>
                        ))}
                        {m.contributes.hooks.map((h) => (
                          <span key={h} className="chip chip-rule">
                            {h.replace("_", " ")}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <span className="muted">
                    <FolderOpen size={12} /> <code>{p.dir}</code>
                    {m.author ? `, by ${m.author}` : ""}
                  </span>
                </div>
              )}
              {m && m.contributes.settings.length > 0 && <Settings p={p} />}
              {m?.run && <Logs id={p.id} />}
              <div className="lib-actions">
                {m?.run && p.enabled && (
                  <button className="btn b-outline sz-s" disabled={busy} onClick={() => set(() => api.post(`/api/plugins/${p.id}/restart`, {}))}>
                    <RotateCw size={14} /> Restart
                  </button>
                )}
                <button className="btn b-ghost sz-s" onClick={() => api.post(`/api/plugins/${p.id}/open`, {}).catch((e) => toast({ title: "Couldn't open it", body: (e as Error).message, tone: "warn" }))}>
                  <FolderOpen size={14} /> Open the folder
                </button>
                <button
                  className="btn b-ghost sz-s"
                  onClick={async () => {
                    const ws = await api.post<{ id: string }>("/api/workspaces", { title: `Plugin: ${m?.name ?? p.id}`, cwd: p.dir, profile: "pair" });
                    useStore.getState().setOverlay(null);
                    useStore.getState().setView({ kind: "ws", id: ws.id });
                  }}
                >
                  <Sparkles size={14} /> Work on it with Claude
                </button>
                <button
                  className="btn b-ghost sz-s danger-hover"
                  disabled={busy}
                  onClick={() => window.confirm(`Delete ${m?.name ?? p.id} and its folder?`) && set(() => api.del(`/api/plugins/${p.id}`))}
                >
                  <Trash2 size={14} /> Remove
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Settings({ p }: { p: PluginInfo }) {
  const toast = useStore((s) => s.toast);
  const [vals, setVals] = useState<Record<string, unknown>>(p.settings);
  const fields = p.manifest!.contributes.settings;
  const dirty = JSON.stringify(vals) !== JSON.stringify(p.settings);
  return (
    <form
      className="pl-settings"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await api.put<{ plugins: PluginInfo[] }>(`/api/plugins/${p.id}/settings`, vals);
        useStore.setState({ plugins: r.plugins });
        toast({ title: "Saved", tone: "good" });
      }}
    >
      <span className="form-label">Settings</span>
      {fields.map((f) => (
        <label key={f.key} className="set-field">
          <span className="small">{f.label}</span>
          {f.type === "boolean" ? (
            <button type="button" className="switch" role="switch" aria-checked={!!vals[f.key]} aria-label={f.label} onClick={() => setVals({ ...vals, [f.key]: !vals[f.key] })} />
          ) : f.type === "select" ? (
            <select className="pl-select" value={String(vals[f.key] ?? "")} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}>
              {(f.options ?? []).map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : (
            <div className="field">
              <input
                type={f.type === "secret" ? "password" : f.type === "number" ? "number" : "text"}
                value={f.type === "secret" && vals[f.key] === "set" ? "" : String(vals[f.key] ?? "")}
                placeholder={f.type === "secret" && p.settings[f.key] === "set" ? "Saved; type to replace it" : ""}
                onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
                autoComplete="off"
              />
            </div>
          )}
          {f.help && <span className="muted small">{f.help}</span>}
          {f.type === "secret" && <span className="muted small">Kept encrypted; only this plugin gets it.</span>}
        </label>
      ))}
      <div className="lib-actions">
        <button className="btn b-peach sz-s" disabled={!dirty}>
          <Save size={14} /> Save settings
        </button>
      </div>
    </form>
  );
}

function Logs({ id }: { id: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => {
    api.get<{ logs: string[] }>(`/api/plugins/${id}/logs`).then((r) => setLines(r.logs)).catch(() => {});
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.id === id) setLines((l) => [...l.slice(-300), d.line]);
    };
    window.addEventListener("orbit:plugin_log", on);
    return () => window.removeEventListener("orbit:plugin_log", on);
  }, [id]);
  useEffect(() => {
    box.current?.scrollTo(0, box.current.scrollHeight);
  }, [lines]);
  return (
    <div className="pl-logs">
      <span className="form-label">
        <Terminal size={12} /> Log
      </span>
      <pre ref={box}>{lines.length ? lines.join("\n") : "Nothing yet."}</pre>
    </div>
  );
}
