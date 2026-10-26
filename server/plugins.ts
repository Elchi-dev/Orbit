// Plugins: folders with an orbit-plugin.json, run as their own process in any
// language and spoken to with JSON-RPC 2.0 over stdin and stdout, one message
// per line (docs/PLUGINS.md). A plugin can add tools, slash commands, panels,
// HTTP routes, settings and hooks, and can use Orbit itself: workspaces, Claude
// runs, model calls billed to Orbit's budget, events, approvals, storage.
// No sandbox: a plugin runs with your user's rights, like any program you
// install. It never gets the API key; model calls go through Orbit.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { ORBIT_DIR, config, saveConfig } from "./config";
import { broadcast, listen } from "./hub";
import { getSecret, setSecret } from "./secrets";

declare const ORBIT_VERSION: string;
const VERSION = typeof ORBIT_VERSION === "string" ? ORBIT_VERSION : "dev";

// ---------- manifest ----------
export const PERMISSIONS = {
  workspaces: "Read your workspaces and conversations, create workspaces",
  agent: "Start Claude runs in workspaces (costs money, under your budget)",
  model: "Ask a model directly (costs money, under your budget)",
  events: "See everything that happens in Orbit as it happens",
  approvals: "See approvals, answer them, and allow or block actions before they run",
  api: "Call any part of Orbit's own API",
} as const;
export type Permission = keyof typeof PERMISSIONS;
export const HOOKS = ["before_tool", "after_tool", "turn_start", "turn_end", "message", "approval"] as const;
export type HookName = (typeof HOOKS)[number];

export interface PluginTool {
  name: string;
  description: string;
  input_schema: Record<string, any>;
  /** only reads: runs without asking, like reading a file */
  read_only?: boolean;
  timeout_s?: number;
}
export interface PluginCommand {
  name: string;
  description: string;
}
export interface PluginPanel {
  id: string;
  title: string;
  icon?: string;
  /** an HTML file in the plugin folder */
  entry: string;
}
export interface PluginSetting {
  key: string;
  label: string;
  type: "string" | "secret" | "number" | "boolean" | "select";
  default?: unknown;
  options?: string[];
  help?: string;
}
export interface Manifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  icon?: string;
  /** the command that starts the plugin; optional for plugins that only bring skills, knowledge or panels */
  run?: string | string[];
  permissions: Permission[];
  contributes: {
    tools: PluginTool[];
    commands: PluginCommand[];
    panels: PluginPanel[];
    settings: PluginSetting[];
    hooks: HookName[];
  };
  /** restart when a file in the folder changes */
  dev?: boolean;
}

export const MANIFEST = "orbit-plugin.json";
const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const TOOL_RE = /^[a-zA-Z0-9_-]{1,40}$/;

export function parseManifest(raw: unknown): Manifest {
  const m = raw as any;
  const fail = (why: string) => {
    throw new Error(`${MANIFEST}: ${why}`);
  };
  if (!m || typeof m !== "object") fail("not a JSON object");
  if (!ID_RE.test(String(m.id ?? ""))) fail("id must be lower case letters, digits and dashes, 2 to 41 long");
  if (!m.name) fail("name is missing");
  const perms = Array.isArray(m.permissions) ? m.permissions : [];
  for (const p of perms) if (!(p in PERMISSIONS)) fail(`unknown permission "${p}" (known: ${Object.keys(PERMISSIONS).join(", ")})`);
  const c = m.contributes ?? {};
  const tools: PluginTool[] = (c.tools ?? []).map((t: any) => {
    if (!TOOL_RE.test(String(t?.name ?? ""))) fail(`tool name "${t?.name}" must be letters, digits, _ or -`);
    return { name: t.name, description: String(t.description ?? ""), input_schema: normaliseSchema(t.input_schema ?? t.input ?? {}), read_only: !!t.read_only, timeout_s: Number(t.timeout_s) || undefined };
  });
  const hooks = (c.hooks ?? []).filter((h: string) => (HOOKS as readonly string[]).includes(h));
  if (hooks.some((h: string) => h === "before_tool" || h === "approval") && !perms.includes("approvals")) fail('hooks on tools and approvals need the "approvals" permission');
  return {
    id: m.id,
    name: String(m.name),
    version: String(m.version ?? "0.0.0"),
    description: String(m.description ?? ""),
    author: m.author ? String(m.author) : undefined,
    homepage: m.homepage ? String(m.homepage) : undefined,
    icon: m.icon ? String(m.icon) : undefined,
    run: m.run,
    permissions: perms,
    contributes: {
      tools,
      commands: (c.commands ?? []).map((x: any) => ({ name: String(x.name).replace(/^\//, ""), description: String(x.description ?? "") })),
      panels: (c.panels ?? []).map((x: any) => ({ id: String(x.id), title: String(x.title ?? x.id), icon: x.icon, entry: String(x.entry ?? "index.html") })),
      settings: (c.settings ?? []).map((x: any) => ({ key: String(x.key), label: String(x.label ?? x.key), type: x.type ?? "string", default: x.default, options: x.options, help: x.help })),
      hooks,
    },
    dev: !!m.dev,
  };
}

/** `{ city: "string", days: "number?" }` is short for the JSON schema it means. */
export function normaliseSchema(s: Record<string, any>): Record<string, any> {
  if (s.type === "object" || s.$schema) return { type: "object", ...s };
  const properties: Record<string, any> = {};
  const required: string[] = [];
  for (const [k, v] of Object.entries(s)) {
    if (typeof v === "string") {
      const optional = v.endsWith("?");
      const t = v.replace(/\?$/, "");
      properties[k] = t.endsWith("[]") ? { type: "array", items: { type: t.slice(0, -2) } } : { type: t };
      if (!optional) required.push(k);
    } else {
      properties[k] = v;
      if (!v?.optional) required.push(k);
      delete properties[k].optional;
    }
  }
  return { type: "object", properties, required };
}

// ---------- where plugins live ----------
export const pluginsDir = () => join(ORBIT_DIR, "plugins");
export const dataDir = (id: string) => join(ORBIT_DIR, "plugin-data", id);

interface Found {
  dir: string;
  manifest: Manifest | null;
  error?: string;
}
export function scan(): Found[] {
  const out: Found[] = [];
  const dirs = [pluginsDir(), ...(config().plugins?.dirs ?? [])];
  const seen = new Set<string>();
  for (const root of dirs) {
    let entries: string[] = [];
    try {
      entries = readdirSync(root).sort();
    } catch {
      continue;
    }
    for (const e of entries) {
      const dir = join(root, e);
      const file = join(dir, MANIFEST);
      try {
        if (!statSync(dir).isDirectory() || !existsSync(file)) continue;
        const m = parseManifest(JSON.parse(readFileSync(file, "utf8")));
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        out.push({ dir, manifest: m });
      } catch (err) {
        out.push({ dir, manifest: null, error: (err as Error).message });
      }
    }
  }
  return out;
}

// ---------- the running plugins ----------
type State = "off" | "starting" | "running" | "crashed" | "stopped";
type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export class Plugin {
  state: State = "off";
  error = "";
  logs: string[] = [];
  proc: ChildProcess | null = null;
  /** what the plugin registered at start, on top of its manifest */
  extra = { tools: [] as PluginTool[], commands: [] as PluginCommand[] };
  subscribed: Set<string> | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buf = "";
  private crashes: number[] = [];
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private watcher: FSWatcher | null = null;
  private stopping = false;

  constructor(
    public dir: string,
    public manifest: Manifest,
  ) {}

  get id() {
    return this.manifest.id;
  }
  get tools() {
    return [...this.manifest.contributes.tools, ...this.extra.tools];
  }
  get commands() {
    return [...this.manifest.contributes.commands, ...this.extra.commands];
  }
  can(p: Permission) {
    return this.manifest.permissions.includes(p);
  }
  log(line: string) {
    const stamp = new Date().toISOString().slice(11, 19);
    for (const l of line.split(/\r?\n/)) if (l.trim()) this.logs.push(`${stamp} ${l}`);
    if (this.logs.length > 400) this.logs.splice(0, this.logs.length - 400);
    broadcast("plugin_log", { id: this.id, line: `${stamp} ${line}` });
  }
  private setState(s: State, error = "") {
    this.state = s;
    this.error = error;
    broadcast("plugins", { plugins: listPlugins() });
  }

  async start() {
    if (!this.manifest.run) return this.setState("running");
    if (this.proc) return;
    this.stopping = false;
    this.setState("starting");
    const [cmd, ...args] = commandLine(this.manifest.run);
    mkdirSync(dataDir(this.id), { recursive: true });
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v != null && !/^(ANTHROPIC_|ORBIT_MOCK$|ORBIT_HOME$|ORBIT_DB$)/.test(k)) env[k] = v;
    Object.assign(env, { ORBIT_PLUGIN_ID: this.id, ORBIT_PLUGIN_DIR: this.dir, ORBIT_PLUGIN_DATA: dataDir(this.id), ORBIT_VERSION: VERSION });
    const exe = resolveExecutable(cmd, env);
    let p: ChildProcess;
    try {
      p = spawn(exe.cmd, [...exe.args, ...args], { cwd: this.dir, env: { ...env, ...exe.env }, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      return this.crashed(`Could not start: ${(e as Error).message}`);
    }
    this.proc = p;
    p.stdout!.setEncoding("utf8");
    p.stdout!.on("data", (chunk: string) => this.onData(chunk));
    p.stderr!.setEncoding("utf8");
    p.stderr!.on("data", (chunk: string) => this.log(chunk.trimEnd()));
    p.on("error", (e) => this.log(`error: ${e.message}`));
    p.on("exit", (code, signal) => {
      this.proc = null;
      for (const [, w] of this.pending) {
        clearTimeout(w.timer);
        w.reject(new Error("The plugin stopped"));
      }
      this.pending.clear();
      if (this.stopping) return this.setState("stopped");
      this.log(`exited (${signal ?? code})`);
      this.crashed(`Stopped unexpectedly (${signal ?? `exit ${code}`})`);
    });
    try {
      const r = await this.request("initialize", { orbit: { version: VERSION }, plugin: { id: this.id, dir: this.dir, data: dataDir(this.id) }, settings: pluginSettings(this.id), protocol: 1 }, 15_000);
      if (r?.tools) this.extra.tools = normaliseTools(r.tools);
      if (r?.commands) this.extra.commands = (r.commands as any[]).map((c) => ({ name: String(c.name).replace(/^\//, ""), description: String(c.description ?? "") }));
      this.setState("running");
      this.log("running");
    } catch (e) {
      this.log(`initialize failed: ${(e as Error).message}`);
      this.stop();
      this.crashed(`Didn't answer initialize: ${(e as Error).message}`);
    }
    if (this.manifest.dev && !this.watcher) {
      let t: ReturnType<typeof setTimeout> | null = null;
      try {
        this.watcher = watch(this.dir, { recursive: true }, (_e, f) => {
          if (!f || /(^|[\\/])(node_modules|\.git|__pycache__)([\\/]|$)/.test(String(f))) return;
          if (t) clearTimeout(t);
          t = setTimeout(() => {
            this.log(`changed: ${f}, restarting`);
            this.restart();
          }, 300);
        });
      } catch {}
    }
  }

  private crashed(why: string) {
    const now = Date.now();
    this.crashes = [...this.crashes.filter((t) => now - t < 5 * 60_000), now];
    if (this.crashes.length >= 5) return this.setState("crashed", `${why}. It crashed 5 times in 5 minutes, so it stays off until you restart it.`);
    this.setState("crashed", why);
    const delay = Math.min(60_000, 1000 * 2 ** (this.crashes.length - 1));
    this.restartTimer = setTimeout(() => this.start(), delay);
  }

  stop() {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.watcher?.close();
    this.watcher = null;
    const p = this.proc;
    this.setState("stopped");
    if (!p) return;
    try {
      this.notify("shutdown", {});
    } catch {}
    setTimeout(() => {
      try {
        p.kill();
      } catch {}
    }, 800);
  }

  async restart() {
    const p = this.proc;
    this.stop();
    if (p) await new Promise((r) => (p.exitCode != null ? r(null) : p.once("exit", r)));
    this.crashes = [];
    this.extra = { tools: [], commands: [] };
    this.subscribed = null;
    await this.start();
  }

  private send(msg: object) {
    if (!this.proc?.stdin?.writable) throw new Error("The plugin isn't running");
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }
  notify(method: string, params: unknown) {
    this.send({ jsonrpc: "2.0", method, params });
  }
  request(method: string, params: unknown, ms = 60_000): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`no answer to ${method} within ${Math.round(ms / 1000)} s`));
      }, ms);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e as Error);
      }
    });
  }

  private onData(chunk: string) {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        this.log(line);
        continue;
      }
      if (msg.id != null && (msg.result !== undefined || msg.error) && !msg.method) {
        const w = this.pending.get(msg.id);
        if (!w) continue;
        clearTimeout(w.timer);
        this.pending.delete(msg.id);
        if (msg.error) w.reject(new Error(String(msg.error.message ?? "error")));
        else w.resolve(msg.result);
      } else if (typeof msg.method === "string") this.onCall(msg);
    }
  }

  private async onCall(msg: { id?: number | string; method: string; params?: any }) {
    try {
      const result = await handleCall(this, msg.method, msg.params ?? {});
      if (msg.id != null) this.send({ jsonrpc: "2.0", id: msg.id, result: result ?? null });
    } catch (e) {
      if (msg.id != null) this.send({ jsonrpc: "2.0", id: msg.id, error: { code: (e as any).code ?? -32000, message: (e as Error).message } });
      else this.log(`${msg.method}: ${(e as Error).message}`);
    }
  }
}

function normaliseTools(list: any[]): PluginTool[] {
  return list
    .filter((t) => TOOL_RE.test(String(t?.name ?? "")))
    .map((t) => ({ name: t.name, description: String(t.description ?? ""), input_schema: normaliseSchema(t.input_schema ?? t.input ?? {}), read_only: !!t.read_only, timeout_s: Number(t.timeout_s) || undefined }));
}

/** "python3 main.py" or ["node", "index.js"]: quoted parts stay together. */
export function commandLine(run: string | string[]): string[] {
  if (Array.isArray(run)) return run.map(String);
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(run))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function onPath(cmd: string, env: Record<string, string>) {
  if (cmd.includes("/") || cmd.includes("\\")) return true;
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const d of (env.PATH ?? "").split(delimiter)) for (const x of exts) if (d && existsSync(join(d, cmd + x))) return true;
  return false;
}

/** bun and node run on Orbit's own binary when they aren't installed, so JS and TS plugins need nothing. */
function resolveExecutable(cmd: string, env: Record<string, string>): { cmd: string; args: string[]; env: Record<string, string> } {
  if ((cmd === "bun" || cmd === "node") && !onPath(cmd, env)) return { cmd: process.execPath, args: [], env: { BUN_BE_BUN: "1" } };
  return { cmd, args: [], env: {} };
}

// ---------- registry ----------
const plugins = new Map<string, Plugin>();
const broken: Found[] = [];

export const enabled = (id: string) => config().plugins?.enabled?.[id] === true;

export function loadPlugins() {
  broken.length = 0;
  const found = scan();
  const keep = new Set<string>();
  for (const f of found) {
    if (!f.manifest) {
      broken.push(f);
      continue;
    }
    keep.add(f.manifest.id);
    const old = plugins.get(f.manifest.id);
    if (old && JSON.stringify(old.manifest) === JSON.stringify(f.manifest) && old.dir === f.dir) continue;
    old?.stop();
    const p = new Plugin(f.dir, f.manifest);
    plugins.set(p.id, p);
    if (enabled(p.id)) p.start();
  }
  for (const [id, p] of plugins)
    if (!keep.has(id)) {
      p.stop();
      plugins.delete(id);
    }
  broadcast("plugins", { plugins: listPlugins() });
}

export const getPlugin = (id: string) => plugins.get(id);
export const runningPlugins = () => [...plugins.values()].filter((p) => p.state === "running" && enabled(p.id));

export function listPlugins() {
  return [
    ...[...plugins.values()].map((p) => ({
      id: p.id,
      dir: p.dir,
      manifest: p.manifest,
      enabled: enabled(p.id),
      state: enabled(p.id) ? p.state : "off",
      error: p.error,
      tools: p.tools.map((t) => t.name),
      commands: p.commands,
      settings: pluginSettings(p.id, true),
    })),
    ...broken.map((b) => ({ id: b.dir.split(/[\\/]/).pop()!, dir: b.dir, manifest: null, enabled: false, state: "broken" as const, error: b.error, tools: [], commands: [], settings: {} })),
  ];
}

export async function setEnabled(id: string, on: boolean) {
  const p = plugins.get(id);
  if (!p) throw new Error("No such plugin");
  const c = config();
  saveConfig({ ...c, plugins: { ...c.plugins, enabled: { ...(c.plugins?.enabled ?? {}), [id]: on } } });
  if (on) await p.restart();
  else p.stop();
  broadcast("plugins", { plugins: listPlugins() });
}

// ---------- settings ----------
export function pluginSettings(id: string, forUi = false): Record<string, unknown> {
  const p = plugins.get(id);
  const saved = config().plugins?.settings?.[id] ?? {};
  const out: Record<string, unknown> = {};
  for (const s of p?.manifest.contributes.settings ?? []) {
    if (s.type === "secret") {
      const v = getSecret(`plugin.${id}.${s.key}`);
      out[s.key] = forUi ? (v ? "set" : "") : v ?? "";
    } else out[s.key] = saved[s.key] ?? s.default ?? null;
  }
  return out;
}
export function savePluginSettings(id: string, values: Record<string, unknown>) {
  const p = plugins.get(id);
  if (!p) throw new Error("No such plugin");
  const plain: Record<string, unknown> = { ...(config().plugins?.settings?.[id] ?? {}) };
  for (const s of p.manifest.contributes.settings) {
    if (!(s.key in values)) continue;
    const v = values[s.key];
    if (s.type === "secret") {
      if (typeof v === "string" && v && v !== "set") setSecret(`plugin.${id}.${s.key}`, v);
    } else plain[s.key] = s.type === "number" ? Number(v) : s.type === "boolean" ? !!v : v;
  }
  const c = config();
  saveConfig({ ...c, plugins: { ...c.plugins, settings: { ...(c.plugins?.settings ?? {}), [id]: plain } } });
  if (p.state === "running" && p.proc) p.notify("settings", pluginSettings(id));
}

// ---------- storage ----------
const storeFile = (id: string) => join(dataDir(id), "storage.json");
function readStore(id: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(storeFile(id), "utf8"));
  } catch {
    return {};
  }
}
function writeStore(id: string, s: Record<string, unknown>) {
  mkdirSync(dataDir(id), { recursive: true });
  writeFileSync(storeFile(id), JSON.stringify(s, null, 2));
}

// ---------- what plugins can call ----------
/** Orbit fills these in at start: the parts of the app plugins reach. */
export interface PluginBridge {
  api: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;
  runAgent: (o: { prompt: string; workspace?: string; cwd?: string; profile?: string; title?: string; wait?: boolean; timeout_s?: number; plugin: string }) => Promise<any>;
  complete: (o: { plugin: string; system?: string; prompt?: string; messages?: any[]; model?: string; max_tokens?: number }) => Promise<any>;
  answerApproval: (id: string, decision: string) => void;
  approvals: () => any[];
  sendMessage: (workspace: string, text: string) => void;
}
let bridge: PluginBridge | null = null;
export const setPluginBridge = (b: PluginBridge) => (bridge = b);

const need = (p: Plugin, perm: Permission) => {
  if (!p.can(perm)) {
    const e = new Error(`This needs the "${perm}" permission in ${MANIFEST}`) as Error & { code: number };
    e.code = -32001;
    throw e;
  }
};
const BLOCKED_API = /^\/api\/(key|remote|plugins|config)(\/|$|\?)/;

async function handleCall(p: Plugin, method: string, a: any): Promise<unknown> {
  if (!bridge) throw new Error("Orbit is starting");
  switch (method) {
    case "orbit.log":
      return p.log(String(a.message ?? a));
    case "orbit.ui.toast":
      return broadcast("notify", { title: String(a.title ?? p.manifest.name), body: String(a.body ?? ""), tone: a.tone, plugin: p.id });
    case "orbit.ui.notify":
      return broadcast("notify", { title: String(a.title ?? p.manifest.name), body: String(a.body ?? ""), system: true, plugin: p.id });
    case "orbit.storage.get":
      return readStore(p.id)[String(a.key)] ?? null;
    case "orbit.storage.set": {
      const s = readStore(p.id);
      s[String(a.key)] = a.value;
      return writeStore(p.id, s);
    }
    case "orbit.storage.delete": {
      const s = readStore(p.id);
      delete s[String(a.key)];
      return writeStore(p.id, s);
    }
    case "orbit.storage.all":
      return readStore(p.id);
    case "orbit.settings.get":
      return pluginSettings(p.id);
    case "orbit.tools.register":
      p.extra.tools = normaliseTools(Array.isArray(a) ? a : a.tools ?? []);
      broadcast("plugins", { plugins: listPlugins() });
      return { tools: p.tools.map((t) => t.name) };
    case "orbit.commands.register":
      p.extra.commands = (Array.isArray(a) ? a : a.commands ?? []).map((c: any) => ({ name: String(c.name).replace(/^\//, ""), description: String(c.description ?? "") }));
      broadcast("plugins", { plugins: listPlugins() });
      return { commands: p.commands.map((c) => c.name) };
    case "orbit.events.subscribe":
      need(p, "events");
      p.subscribed = new Set(Array.isArray(a.types) ? a.types.map(String) : ["*"]);
      return { ok: true };
    case "orbit.events.unsubscribe":
      p.subscribed = null;
      return { ok: true };
    case "orbit.workspaces.list":
      need(p, "workspaces");
      return (await bridge.api("GET", "/api/workspaces")).body;
    case "orbit.workspaces.get":
      need(p, "workspaces");
      return (await bridge.api("GET", `/api/workspaces/${encodeURIComponent(String(a.id))}`)).body;
    case "orbit.workspaces.create":
      need(p, "workspaces");
      return (await bridge.api("POST", "/api/workspaces", { title: a.title, cwd: a.cwd, profile: a.profile, mode: a.mode })).body;
    case "orbit.workspaces.send":
      need(p, "agent");
      bridge.sendMessage(String(a.workspace ?? a.id), String(a.text ?? ""));
      return { ok: true };
    case "orbit.workspaces.stop":
      need(p, "agent");
      return (await bridge.api("POST", `/api/workspaces/${encodeURIComponent(String(a.id ?? a.workspace))}/stop`)).body;
    case "orbit.agent.run":
      need(p, "agent");
      if (!String(a.prompt ?? "").trim()) throw new Error("prompt is empty");
      return bridge.runAgent({ ...a, prompt: String(a.prompt), plugin: p.id });
    case "orbit.model.complete":
      need(p, "model");
      return bridge.complete({ ...a, plugin: p.id });
    case "orbit.approvals.list":
      need(p, "approvals");
      return bridge.approvals();
    case "orbit.approvals.answer":
      need(p, "approvals");
      bridge.answerApproval(String(a.id), a.decision === "allow" || a.decision === "always" ? a.decision : "deny");
      return { ok: true };
    case "orbit.api": {
      need(p, "api");
      const path = String(a.path ?? "");
      if (!path.startsWith("/api/") || BLOCKED_API.test(path)) throw new Error("That part of Orbit isn't open to plugins");
      return bridge.api(String(a.method ?? "GET").toUpperCase(), path, a.body);
    }
    default: {
      const e = new Error(`Unknown method ${method}`) as Error & { code: number };
      e.code = -32601;
      throw e;
    }
  }
}

// ---------- events and hooks to plugins ----------
export function startPlugins() {
  loadPlugins();
  listen((type, raw) => {
    if (type === "plugin_log" || type === "plugins") return;
    for (const p of runningPlugins()) {
      if (p.subscribed && (p.subscribed.has("*") || p.subscribed.has(type))) {
        try {
          p.notify("event", JSON.parse(raw));
        } catch {}
      }
      const hook: HookName | null = type === "turn_start" ? "turn_start" : type === "turn_end" ? "turn_end" : type === "message" ? "message" : type === "approval_request" ? "approval" : null;
      if (hook && p.manifest.contributes.hooks.includes(hook))
        try {
          p.notify(`hook.${hook}`, JSON.parse(raw));
        } catch {}
    }
  });
}

/** Asked before a tool runs: any plugin can block it; an allow counts like a rule. */
export async function beforeTool(ws: { id: string; title: string; cwd: string }, call: { id: string; name: string; input: any; subject: string }): Promise<{ decision: "allow" | "deny" | "ask"; reason: string; plugin: string } | null> {
  let allow: { decision: "allow"; reason: string; plugin: string } | null = null;
  for (const p of runningPlugins().filter((x) => x.manifest.contributes.hooks.includes("before_tool"))) {
    try {
      const r = await p.request("hook.before_tool", { workspace: ws, tool: call.name, input: call.input, subject: call.subject }, 5000);
      const d = r?.decision;
      const reason = String(r?.reason ?? "");
      if (d === "deny") return { decision: "deny", reason: reason || `Blocked by ${p.manifest.name}`, plugin: p.id };
      if (d === "ask") return { decision: "ask", reason: reason || `${p.manifest.name} wants you to decide`, plugin: p.id };
      if (d === "allow" && !allow) allow = { decision: "allow", reason: reason || `Allowed by ${p.manifest.name}`, plugin: p.id };
    } catch (e) {
      p.log(`before_tool: ${(e as Error).message}`);
    }
  }
  return allow;
}

export function afterTool(ws: { id: string }, call: { id: string; name: string; input: any; status: string; output: string }) {
  for (const p of runningPlugins().filter((x) => x.manifest.contributes.hooks.includes("after_tool")))
    try {
      p.notify("hook.after_tool", { workspace: ws.id, tool: call.name, input: call.input, status: call.status, output: call.output.slice(0, 20_000) });
    } catch {}
}

// ---------- tools and commands from plugins ----------
export const toolName = (pluginId: string, tool: string) => `${pluginId.replace(/-/g, "_")}__${tool}`.slice(0, 64);

export function pluginTools() {
  const out: { name: string; description: string; input_schema: any; readOnly: boolean; plugin: Plugin; tool: PluginTool }[] = [];
  for (const p of runningPlugins()) for (const t of p.tools) out.push({ name: toolName(p.id, t.name), description: `${t.description} (from the ${p.manifest.name} plugin)`, input_schema: t.input_schema, readOnly: !!t.read_only, plugin: p, tool: t });
  return out;
}

export async function callPluginTool(p: Plugin, t: PluginTool, input: any, ctx: { workspace: string; cwd: string; call: string }) {
  const r = await p.request("tool.call", { name: t.name, input, workspace: ctx.workspace, cwd: ctx.cwd, call: ctx.call }, (t.timeout_s ?? 120) * 1000);
  if (typeof r === "string") return { content: r };
  return { content: typeof r?.content === "string" ? r.content : JSON.stringify(r?.content ?? r ?? null, null, 2), isError: !!r?.is_error || !!r?.isError };
}

export function pluginCommands() {
  return runningPlugins().flatMap((p) => p.commands.map((c) => ({ plugin: p.id, pluginName: p.manifest.name, ...c })));
}

export async function runCommand(pluginId: string, name: string, args: string, workspace: string | null) {
  const p = getPlugin(pluginId);
  if (!p || p.state !== "running") throw new Error("That plugin isn't running");
  const r = await p.request("command.run", { name, args, workspace }, 120_000);
  return typeof r === "string" ? { reply: r } : (r ?? {});
}

export async function pluginHttp(id: string, req: { method: string; path: string; query: Record<string, string>; headers: Record<string, string>; body: unknown }) {
  const p = getPlugin(id);
  if (!p || p.state !== "running" || !p.manifest.run) throw new Error("That plugin isn't running");
  return p.request("http.request", req, 60_000);
}

/** Skills and knowledge a plugin brings along, read like your own. */
export function pluginContentDirs(kind: "skills" | "knowledge") {
  return [...plugins.values()].filter((p) => enabled(p.id)).map((p) => ({ dir: join(p.dir, kind), plugin: p.id }));
}

export function panelFile(id: string, rel: string): string | null {
  const p = getPlugin(id);
  if (!p || !enabled(p.id)) return null;
  const full = resolve(p.dir, rel);
  if (!full.startsWith(resolve(p.dir) + (process.platform === "win32" ? "\\" : "/"))) return null;
  return existsSync(full) && statSync(full).isFile() ? full : null;
}
