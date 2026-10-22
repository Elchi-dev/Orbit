import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import type { Config, McpServer, McpStatus } from "../lib/types";

const PRESETS: { name: string; label: string; help: string; spec: McpServer }[] = [
  {
    name: "browser",
    label: "Browser (Playwright)",
    help: "Claude opens pages, clicks, types and reads them in a headless browser.",
    spec: { command: "npx", args: ["-y", "@playwright/mcp@latest", "--headless"] },
  },
  {
    name: "github",
    label: "GitHub",
    help: "Issues, pull requests, code search and Actions through GitHub's own server. Needs Docker and a token.",
    spec: { command: "docker", args: ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"], env: { GITHUB_PERSONAL_ACCESS_TOKEN: "" } },
  },
  {
    name: "memory",
    label: "Knowledge graph memory",
    help: "A small store of facts Claude can write to and search across workspaces.",
    spec: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] },
  },
];

/** Split a command line on spaces, keeping "quoted parts" together. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}
const pairs = (text: string) =>
  Object.fromEntries(
    text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes("=") || l.includes(":"))
      .map((l) => {
        const i = l.search(/[=:]/);
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
const describe = (s: McpServer) => (s.url ? s.url : [s.command, ...(s.args ?? [])].join(" "));

function StatusText({ st, spec }: { st?: McpStatus; spec: McpServer }) {
  if (spec.enabled === false) return <span className="vd quiet">off</span>;
  if (!st) return <span className="vd quiet">not started; save to start it</span>;
  if (st.state === "connecting") return <span className="vd lav"><i className="pulse" /> connecting</span>;
  if (st.state === "error") return <span className="vd bad" title={st.error}><i /> {st.error?.slice(0, 80)}</span>;
  if (st.state === "ready") return <span className="vd good"><i /> {st.tools.length} {st.tools.length === 1 ? "tool" : "tools"}</span>;
  return <span className="vd quiet">off</span>;
}

export function McpPage({ draft, setServers }: { draft: Config; setServers: (s: Record<string, McpServer>) => void }) {
  const toast = useStore((s) => s.toast);
  const [status, setStatus] = useState<McpStatus[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", kind: "command" as "command" | "url", line: "", extra: "" });
  const servers = draft.mcp?.servers ?? {};

  const load = () => api.get<McpStatus[]>("/api/mcp").then(setStatus).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, []);
  const byName = Object.fromEntries(status.map((s) => [s.name, s]));

  function add(name: string, spec: McpServer) {
    const key = name.trim().replace(/[^\w.-]/g, "-");
    if (!key) return toast({ title: "Give the server a name", tone: "warn" });
    if (servers[key]) return toast({ title: `There's already a server called ${key}`, tone: "warn" });
    setServers({ ...servers, [key]: spec });
    setAdding(false);
    setForm({ name: "", kind: "command", line: "", extra: "" });
    setOpen(key);
  }

  return (
    <>
      <h2>MCP servers</h2>
      <p className="muted">
        Connect other apps through the Model Context Protocol. A server's tools show up for Claude next to the shell and the file tools, and every
        call passes the approval gate. Tools a server marks as read-only skip it, like <code>ls</code> does.
      </p>

      {Object.keys(servers).length === 0 && !adding && <p>No servers yet. Start with one of these, or add your own.</p>}

      <ul className="mcp-list">
        {Object.entries(servers).map(([name, spec]) => {
          const st = byName[name];
          const isOpen = open === name;
          return (
            <li key={name} className={`mcp-item ${isOpen ? "open" : ""}`}>
              <div className="mcp-row">
                <button className="mcp-main" onClick={() => setOpen(isOpen ? null : name)} aria-expanded={isOpen}>
                  <span className="mcp-name">{name}</span>
                  <StatusText st={st} spec={spec} />
                  <ChevronDown size={14} className={`chev ${isOpen ? "up" : ""}`} />
                </button>
                <button
                  className="switch"
                  role="switch"
                  aria-checked={spec.enabled !== false}
                  aria-label={`Use ${name}`}
                  onClick={() => setServers({ ...servers, [name]: { ...spec, enabled: spec.enabled === false } })}
                />
              </div>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div className="mcp-body" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                    <code className="mcp-cmd">{describe(spec)}</code>
                    {spec.env && Object.keys(spec.env).length > 0 && (
                      <div className="mcp-env">
                        {Object.keys(spec.env).map((k) => (
                          <label key={k} className="field">
                            <span className="mcp-key mono">{k}</span>
                            <input
                              type="password"
                              value={spec.env![k]}
                              placeholder="value"
                              onChange={(e) => setServers({ ...servers, [name]: { ...spec, env: { ...spec.env, [k]: e.target.value } } })}
                            />
                          </label>
                        ))}
                        <span className="muted small">Saved in orbit.toml on this machine, readable by your user account.</span>
                      </div>
                    )}
                    {st?.state === "error" && <p className="bad-text small mcp-err">{st.error}</p>}
                    {st?.tools.length ? (
                      <ul className="mcp-tools">
                        {st.tools.map((t) => (
                          <li key={t.name} title={t.description}>
                            <span className="mono">{t.name}</span>
                            <span className="muted small">{t.readOnly ? "read-only" : ""}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="mcp-acts">
                      <button
                        className="btn b-ghost sz-s"
                        onClick={() =>
                          api
                            .post<McpStatus[]>(`/api/mcp/${encodeURIComponent(name)}/reconnect`)
                            .then(setStatus)
                            .catch((e) => toast({ title: "Couldn't restart it", body: (e as Error).message, tone: "warn" }))
                        }
                      >
                        <RefreshCw size={14} /> Restart
                      </button>
                      <button
                        className="btn b-ghost sz-s"
                        onClick={() => {
                          const { [name]: _, ...rest } = servers;
                          setServers(rest);
                        }}
                      >
                        <Trash2 size={14} /> Remove
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>

      {!adding && (
        <div className="mcp-presets">
          {PRESETS.filter((p) => !servers[p.name]).map((p) => (
            <button key={p.name} className="mcp-preset" onClick={() => add(p.name, structuredClone(p.spec))}>
              <span className="mcp-preset-head">
                <Plus size={14} /> {p.label}
              </span>
              <span className="muted small">{p.help}</span>
            </button>
          ))}
          <button className="mcp-preset" onClick={() => setAdding(true)}>
            <span className="mcp-preset-head">
              <Plus size={14} /> Your own server
            </span>
            <span className="muted small">A command that speaks MCP over stdio, or a URL.</span>
          </button>
        </div>
      )}

      <AnimatePresence>
        {adding && (
          <motion.form
            className="mcp-form"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              const extra = pairs(form.extra);
              if (form.kind === "url") add(form.name, { url: form.line.trim(), ...(Object.keys(extra).length ? { headers: extra } : {}) });
              else {
                const [command, ...args] = splitCommand(form.line);
                if (!command) return toast({ title: "Type the command that starts the server", tone: "warn" });
                add(form.name, { command, args, ...(Object.keys(extra).length ? { env: extra } : {}) });
              }
            }}
          >
            <div className="two">
              <label className="set-field">
                <span className="form-label">Name</span>
                <div className="field">
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="linear" autoFocus />
                </div>
              </label>
              <div className="set-field">
                <span className="form-label">Runs as</span>
                <div className="seg" role="radiogroup" aria-label="Transport">
                  {(["command", "url"] as const).map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={form.kind === k} className={`btn seg-opt ${form.kind === k ? "on" : ""}`} onClick={() => setForm({ ...form, kind: k })}>
                      {k === "command" ? "A command" : "A URL"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <label className="set-field">
              <span className="form-label">{form.kind === "command" ? "Command" : "URL"}</span>
              <div className="field">
                <input className="mono" value={form.line} onChange={(e) => setForm({ ...form, line: e.target.value })} placeholder={form.kind === "command" ? "npx -y some-mcp-server --flag" : "https://example.com/mcp"} />
              </div>
            </label>
            <label className="set-field">
              <span className="form-label">{form.kind === "command" ? "Variables, one per line" : "Headers, one per line"}</span>
              <div className="field">
                <textarea className="mono" rows={2} value={form.extra} onChange={(e) => setForm({ ...form, extra: e.target.value })} placeholder={form.kind === "command" ? "API_TOKEN=..." : "Authorization: Bearer ..."} />
              </div>
            </label>
            <div className="mcp-acts">
              <button type="submit" className="btn b-lav sz-s">
                <Plus size={14} /> Add
              </button>
              <button type="button" className="btn b-ghost sz-s" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </>
  );
}
