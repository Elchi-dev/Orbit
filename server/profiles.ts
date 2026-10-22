// Profiles: the shape Orbit takes for a kind of work. A workspace runs under one
// profile, which sets its approval mode, whether anyone is asked, which tools
// Claude gets, how the conversation looks, and a few lines of instructions.
// Five come built in; orbit.toml can change any of them or add new ones.

import { config, type Mode } from "./config";

export interface Profile {
  id: string;
  name: string;
  description: string;
  /** an icon name the interface knows: users, terminal, plane, monitor, telescope, sparkles, code, flask, book, shield */
  icon: string;
  /** how the conversation is drawn: a readable log, or a dense terminal */
  layout: "log" | "terminal";
  /** approval mode for new workspaces */
  mode: Mode;
  /** never ask anyone: an "ask" becomes "no", and Claude is told not to ask questions */
  hands_off: boolean;
  /** tool names, with * at the end for a prefix ("ui_*", "mcp__*"); empty means all */
  tools: string[];
  /** web search on by default */
  web: boolean;
  /** default thinking effort; empty uses the global one */
  effort: string;
  /** the live preview panel and the screenshot tool */
  preview: boolean;
  /** the plan checklist tool */
  plan: boolean;
  /** extra instructions for Claude */
  prompt: string;
  /** how many model calls one request may take; 0 uses the default */
  max_steps: number;
  builtin?: boolean;
}

const READ_ONLY_TOOLS = ["read_file", "list_dir", "glob", "grep", "fetch_url", "load_skill", "plan", "ui_*"];

export const BUILTIN: Profile[] = [
  {
    id: "pair",
    name: "Pair",
    description: "You and Claude side by side. Claude asks before it changes your machine.",
    icon: "users",
    layout: "log",
    mode: "manual",
    hands_off: false,
    tools: [],
    web: false,
    effort: "",
    preview: false,
    plan: true,
    prompt: "",
    max_steps: 0,
  },
  {
    id: "terminal",
    name: "Terminal",
    description: "A terminal in the browser: dense, keyboard first, commands and output inline. Like Claude Code.",
    icon: "terminal",
    layout: "terminal",
    mode: "auto",
    hands_off: false,
    tools: [],
    web: false,
    effort: "",
    preview: false,
    plan: true,
    prompt: "Be terse, like a senior engineer in a terminal. Prefer doing to explaining. Report results in a line or two; no headings, no summaries of what you are about to do.",
    max_steps: 0,
  },
  {
    id: "autopilot",
    name: "Autopilot",
    description: "Give it a goal and walk away. It plans, decides, builds and checks its own work without asking.",
    icon: "plane",
    layout: "log",
    mode: "full",
    hands_off: true,
    tools: [],
    web: true,
    effort: "high",
    preview: true,
    plan: true,
    prompt: [
      "You work autonomously. Nobody will answer questions, so do not ask any: when something is unclear, choose the sensible default, note the choice in the plan, and keep going.",
      "Start by writing a plan with the plan tool, then work through it, updating each item as you go. Build in small steps and run what you build: tests, the build, the app itself. Fix what fails before moving on.",
      "Prefer boring, well-known tools and the project's existing conventions. Initialise git in a new project and commit at milestones.",
      "Finish with a short report: what you built, the decisions you made and why, how to run it, and what is left.",
    ].join("\n"),
    max_steps: 400,
  },
  {
    id: "frontend",
    name: "Frontend",
    description: "Builds interfaces while you watch, with a live preview and screenshots at phone and desktop width.",
    icon: "monitor",
    layout: "log",
    mode: "auto",
    hands_off: false,
    tools: [],
    web: false,
    effort: "",
    preview: true,
    plan: true,
    prompt: [
      "You are building an interface the user is watching in a live preview next to this conversation.",
      "Open the preview early (preview_open) on the page or the dev server you are working on, so the user sees it take shape. For a quick page, write a single index.html; for an app, use the project's framework and start its dev server in the background.",
      "Check your own work: take screenshots at phone and desktop width and look at them before saying something is done, and read the console errors the screenshot tool reports.",
      "Design with intent: a clear type scale, real content instead of lorem ipsum, accessible contrast, visible focus, and layouts that hold from 360 px up.",
    ].join("\n"),
    max_steps: 0,
  },
  {
    id: "research",
    name: "Research",
    description: "Reads, searches and writes up. It never changes your machine.",
    icon: "telescope",
    layout: "log",
    mode: "manual",
    hands_off: false,
    tools: READ_ONLY_TOOLS,
    web: true,
    effort: "high",
    preview: false,
    plan: true,
    prompt: "You research and explain; you cannot change files or run commands here. Cite your sources, say how sure you are, and separate what you found from what you infer.",
    max_steps: 0,
  },
];

const FIELDS: (keyof Profile)[] = ["name", "description", "icon", "layout", "mode", "hands_off", "tools", "web", "effort", "preview", "plan", "prompt", "max_steps"];

/** Built-ins with the changes from orbit.toml, then the profiles orbit.toml adds. */
export function listProfiles(): Profile[] {
  const custom = config().profiles ?? {};
  // Pair follows the global default mode unless orbit.toml gives it its own
  const out: Profile[] = BUILTIN.map((b) => ({
    ...b,
    ...(b.id === "pair" ? { mode: config().permissions.default_mode } : {}),
    ...pick(custom[b.id]),
    id: b.id,
    builtin: true,
  }));
  for (const [id, p] of Object.entries(custom)) {
    if (BUILTIN.some((b) => b.id === id)) continue;
    out.push({ ...BUILTIN[0], ...pick(p), id, builtin: false });
  }
  return out;
}

function pick(p: any): Partial<Profile> {
  if (!p || typeof p !== "object") return {};
  const out: any = {};
  for (const f of FIELDS) if (p[f] !== undefined) out[f] = p[f];
  return out;
}

export function getProfile(id?: string | null): Profile {
  const all = listProfiles();
  return all.find((p) => p.id === id) ?? all.find((p) => p.id === config().workspaces.default_profile) ?? all[0];
}

/** Whether a tool is in the profile's list ("ui_*" style prefixes allowed). */
export function profileAllows(p: Profile, tool: string): boolean {
  if (!p.tools?.length) return true;
  return p.tools.some((t) => (t.endsWith("*") ? tool.startsWith(t.slice(0, -1)) : t === tool));
}
