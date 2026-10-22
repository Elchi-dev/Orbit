import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export const ORBIT_DIR = process.env.ORBIT_HOME ?? join(homedir(), ".orbit");
export const CONFIG_PATH = join(ORBIT_DIR, "orbit.toml");
mkdirSync(ORBIT_DIR, { recursive: true });

export type Verdict = "allow" | "deny" | "ask";
export type Mode = "manual" | "auto" | "rules" | "full";
export interface Rule {
  pattern: string;
  verdict: Verdict;
  kind?: "glob" | "regex";
}
export interface McpServer {
  /** a local server: the command to start, its arguments and extra variables */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** a remote server: its URL and headers (a token, for example) */
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  /** let tools the server marks read-only skip the gate (default true) */
  trust_readonly?: boolean;
}
export interface Price {
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
  context: number;
}

export interface Config {
  server: { port: number; host: string; open_browser: boolean };
  models: { pilot: string; judge: string; scribe: string; effort: string; max_tokens: number; thinking_display: string };
  permissions: {
    default_mode: Mode;
    skip_readonly: boolean;
    judge_context_messages: number;
    judge_timeout_ms: number;
    judge_notes: string;
    rules: Rule[];
  };
  ui_tools: { set_title: boolean; set_planet: boolean; notify: boolean; pin: boolean; show: boolean; widget: boolean; auto_title: boolean; docs: boolean; whiteboard: boolean };
  ui: { motion: "full" | "calm" | "off"; sound: boolean; house_style: boolean };
  budget: { daily_usd: number; workspace_usd: number };
  safety: { undo_journal: boolean; undo_max_bytes: number; command_timeout_s: number };
  workspaces: { home: string; default_profile: string };
  profile: { about: string; instructions: string };
  integrations: { editor: string; briefing: boolean };
  mcp: { servers: Record<string, McpServer> };
  context: { project_files: boolean };
  skills: { enabled: boolean; dirs: string[]; disabled: string[] };
  knowledge: { enabled: boolean; disabled: string[]; always_max_chars: number };
  library: { generator_model: string; max_searches: number };
  remote: { relay_url: string; name: string; alert_delay_ms: number };
  /** changes to the built-in profiles, and new ones, by id */
  profiles: Record<string, Record<string, unknown>>;
  helpers: { enabled: boolean; max_parallel: number; max_depth: number };
  pricing: Record<string, Price>;
}

export const DEFAULT_CONFIG: Config = {
  server: { port: 7777, host: "127.0.0.1", open_browser: true },
  models: {
    pilot: "claude-opus-5-5",
    judge: "claude-sonnet-5-5",
    scribe: "claude-haiku-5-5",
    effort: "medium",
    max_tokens: 32000,
    thinking_display: "summarized",
  },
  permissions: {
    default_mode: "manual",
    skip_readonly: true,
    judge_context_messages: 6,
    judge_timeout_ms: 12000,
    judge_notes: "",
    rules: [],
  },
  ui_tools: { set_title: true, set_planet: true, notify: true, pin: true, show: true, widget: false, auto_title: true, docs: true, whiteboard: true },
  ui: { motion: "full", sound: false, house_style: true },
  budget: { daily_usd: 20, workspace_usd: 5 },
  safety: { undo_journal: true, undo_max_bytes: 2_000_000, command_timeout_s: 300 },
  workspaces: { home: join(homedir(), "orbit-workspaces"), default_profile: "pair" },
  profile: { about: "", instructions: "" },
  integrations: { editor: "auto", briefing: true },
  mcp: { servers: {} },
  context: { project_files: true },
  skills: { enabled: true, dirs: [], disabled: [] },
  knowledge: { enabled: true, disabled: [], always_max_chars: 8000 },
  library: { generator_model: "claude-haiku-5-5", max_searches: 5 },
  remote: { relay_url: "", name: "", alert_delay_ms: 4000 },
  profiles: {},
  helpers: { enabled: true, max_parallel: 4, max_depth: 1 },
  // USD per million tokens, checked October 2026. Edit in orbit.toml when prices change.
  pricing: {
    "claude-fable-5-1": { input: 10, output: 50, cache_write: 12.5, cache_read: 1, context: 1_000_000 },
    "claude-opus-5-5": { input: 4, output: 20, cache_write: 5, cache_read: 0.2, context: 1_000_000 },
    "claude-sonnet-5-5": { input: 2, output: 10, cache_write: 2.5, cache_read: 0.1, context: 1_000_000 },
    "claude-haiku-5-5": { input: 0.1, output: 0.5, cache_write: 0.125, cache_read: 0.01, context: 1_000_000 },
  },
};

function isObj(v: unknown): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function deepMerge<T>(base: T, over: any): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : over) as T;
  const out: any = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isObj(v) && isObj((base as any)[k]) ? deepMerge((base as any)[k], v) : v;
  }
  return out;
}

// ---- tiny TOML writer (enough for our own config shape) ----
function tomlValue(v: unknown): string {
  if (typeof v === "string") {
    if (v.includes("\n")) return `"""\n${v.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"')}"""`;
    return JSON.stringify(v);
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map(tomlValue).join(", ")}]`;
  return JSON.stringify(String(v));
}

function quoteKey(k: string) {
  return /^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k);
}

export function toToml(obj: Record<string, any>, prefix = ""): string {
  let out = "";
  const scalars: string[] = [];
  const tables: [string, any][] = [];
  const arrTables: [string, any[]][] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (isObj(v)) tables.push([k, v]);
    else if (Array.isArray(v) && v.length && v.every(isObj)) arrTables.push([k, v]);
    else scalars.push(`${quoteKey(k)} = ${tomlValue(v)}`);
  }
  if (scalars.length) out += scalars.join("\n") + "\n";
  for (const [k, v] of tables) {
    const name = prefix ? `${prefix}.${quoteKey(k)}` : quoteKey(k);
    const inner = toToml(v, name);
    out += `\n[${name}]\n` + inner;
  }
  for (const [k, arr] of arrTables) {
    const name = prefix ? `${prefix}.${quoteKey(k)}` : quoteKey(k);
    for (const item of arr) out += `\n[[${name}]]\n` + toToml(item, name);
  }
  return out;
}

const HEADER = `# Orbit config. Edit by hand or from Settings; both stay in sync.
# Rules: pattern is matched against the action, e.g. "rm -rf *" for shell,
# "write /path/**" for file writes, "fetch https://*" for web fetches.
`;

let current: Config = DEFAULT_CONFIG;

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    current = structuredClone(DEFAULT_CONFIG);
    saveConfig(current);
    return current;
  }
  try {
    const parsed = Bun.TOML.parse(readFileSync(CONFIG_PATH, "utf8"));
    current = deepMerge(structuredClone(DEFAULT_CONFIG), parsed);
  } catch (e) {
    console.error(`[orbit] could not parse ${CONFIG_PATH}, using defaults:`, (e as Error).message);
    current = structuredClone(DEFAULT_CONFIG);
  }
  return current;
}

export function saveConfig(c: Config) {
  current = c;
  writeFileSync(CONFIG_PATH, HEADER + toToml(c as any));
}

export function config(): Config {
  return current;
}

export function priceFor(model: string): Price {
  const p = current.pricing[model];
  if (p) return p;
  const line = Object.keys(current.pricing).find((k) => model.startsWith(k));
  return line ? current.pricing[line] : { input: 0, output: 0, cache_write: 0, cache_read: 0, context: 200_000 };
}
