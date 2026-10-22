// What a project already says about itself: instruction files other tools use
// (AGENTS.md, CLAUDE.md, Cursor and Copilot rules) and skills in the SKILL.md
// folder format. Both are read from disk on every request, so edits apply at once.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { ORBIT_DIR, config } from "./config";
import { builtinSkills } from "./library";

const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md", "CLAUDE.local.md", ".cursorrules", ".windsurfrules", ".github/copilot-instructions.md"];
const MAX_FILE = 20_000;
const MAX_TOTAL = 40_000;

export interface ProjectFile {
  path: string;
  text: string;
  cut: boolean;
}

export function projectInstructions(cwd: string): ProjectFile[] {
  const out: ProjectFile[] = [];
  let total = 0;
  const files = [...INSTRUCTION_FILES];
  // Cursor's newer rules live in .cursor/rules/*.mdc
  try {
    for (const f of readdirSync(join(cwd, ".cursor", "rules")).sort()) if (f.endsWith(".mdc") || f.endsWith(".md")) files.push(`.cursor/rules/${f}`);
  } catch {}
  for (const f of files) {
    const p = join(cwd, f);
    try {
      if (!existsSync(p) || !statSync(p).isFile()) continue;
      let text = readFileSync(p, "utf8").trim();
      if (!text) continue;
      const room = Math.min(MAX_FILE, MAX_TOTAL - total);
      if (room <= 0) break;
      const cut = text.length > room;
      if (cut) text = text.slice(0, room);
      total += text.length;
      out.push({ path: f, text, cut });
    } catch {}
  }
  return out;
}

// ---------- skills ----------
export interface Skill {
  name: string;
  description: string;
  dir: string;
  source: "project" | "orbit" | "claude" | "builtin";
  enabled: boolean;
}

/** Read the --- frontmatter --- at the top of a SKILL.md: plain key: value lines are enough for name and description. */
export function frontmatter(text: string): Record<string, string> {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  let key = "";
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      out[key] = kv[2].replace(/^["']|["']$/g, "").replace(/^[>|]-?$/, "");
    } else if (key && /^\s+\S/.test(line)) out[key] = `${out[key]} ${line.trim()}`.trim();
  }
  return out;
}

export function skillDirs(cwd?: string): { dir: string; source: Skill["source"] }[] {
  const dirs: { dir: string; source: Skill["source"] }[] = [];
  if (cwd) {
    dirs.push({ dir: join(cwd, ".orbit", "skills"), source: "project" });
    dirs.push({ dir: join(cwd, ".claude", "skills"), source: "project" });
  }
  dirs.push({ dir: join(ORBIT_DIR, "skills"), source: "orbit" });
  dirs.push({ dir: join(homedir(), ".claude", "skills"), source: "claude" });
  for (const d of config().skills?.dirs ?? []) dirs.push({ dir: d.replace(/^~(?=$|[\\/])/, homedir()), source: "orbit" });
  return dirs;
}

/** Skills Claude may load here: the project's, yours, Claude Code's, then the built-ins. `all` keeps the switched-off ones too. */
export function findSkills(cwd?: string, all = false): Skill[] {
  if (!all && config().skills?.enabled === false) return [];
  const off = new Set(config().skills?.disabled ?? []);
  const seen = new Set<string>();
  const out: Skill[] = [];
  for (const { dir, source } of skillDirs(cwd)) {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const e of entries.sort()) {
      const file = join(dir, e, "SKILL.md");
      try {
        if (!existsSync(file)) continue;
        const fm = frontmatter(readFileSync(file, "utf8").slice(0, 4000));
        const name = (fm.name || e).trim();
        // the first one found wins, so a project can override a personal skill
        if (seen.has(name)) continue;
        seen.add(name);
        out.push({ name, description: (fm.description || "").slice(0, 400), dir: join(dir, e), source, enabled: !off.has(name) });
      } catch {}
    }
  }
  for (const b of builtinSkills()) {
    if (seen.has(b.name)) continue;
    seen.add(b.name);
    out.push({ name: b.name, description: b.description.slice(0, 400), dir: "", source: "builtin", enabled: !off.has(b.name) });
  }
  return all ? out : out.filter((s) => s.enabled);
}

const MAX_SKILL = 60_000;

/** The full SKILL.md plus a list of the other files in the folder, for Claude to read when it needs them. */
export function loadSkill(cwd: string, name: string): { content: string; isError?: boolean } {
  const s = findSkills(cwd).find((x) => x.name === name);
  if (!s) return { content: `No skill called "${name}". Available: ${findSkills(cwd).map((x) => x.name).join(", ") || "none"}.`, isError: true };
  if (s.source === "builtin") return { content: `Built-in skill: ${s.name}\n\n${builtinSkills().find((b) => b.name === name)!.text}` };
  let body = readFileSync(join(s.dir, "SKILL.md"), "utf8");
  if (body.length > MAX_SKILL) body = body.slice(0, MAX_SKILL) + "\n\n(cut here)";
  const files: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 3 || files.length > 200) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name !== "SKILL.md") files.push(relative(s.dir, p));
    }
  };
  try {
    walk(s.dir, 0);
  } catch {}
  return {
    content: `Skill folder: ${s.dir}\n${files.length ? `Other files in it (read them with read_file when the instructions point to them):\n${files.map((f) => `- ${f}`).join("\n")}\n` : ""}\n${body}`,
  };
}

// ---------- saved prompts as slash commands ----------
export interface Command {
  name: string;
  description: string;
  body: string;
  source: "project" | "orbit" | "claude";
}

/**
 * Markdown files become /commands: the project's .claude/commands and .orbit/prompts,
 * then ~/.orbit/prompts and ~/.claude/commands. $ARGUMENTS in the body is replaced by
 * what follows the command, the same convention other tools use.
 */
export function findCommands(cwd?: string): Command[] {
  const dirs: { dir: string; source: Command["source"] }[] = [];
  if (cwd) dirs.push({ dir: join(cwd, ".claude", "commands"), source: "project" }, { dir: join(cwd, ".orbit", "prompts"), source: "project" });
  dirs.push({ dir: join(ORBIT_DIR, "prompts"), source: "orbit" }, { dir: join(homedir(), ".claude", "commands"), source: "claude" });
  const seen = new Set<string>();
  const out: Command[] = [];
  for (const { dir, source } of dirs) {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of entries.sort()) {
      if (!f.endsWith(".md")) continue;
      const name = f.slice(0, -3).replace(/[^\w.-]/g, "-");
      if (seen.has(name)) continue;
      try {
        const text = readFileSync(join(dir, f), "utf8").slice(0, 40_000);
        const fm = frontmatter(text);
        const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
        seen.add(name);
        out.push({ name, description: fm.description || body.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "").slice(0, 120) || "", body, source });
      } catch {}
    }
  }
  return out;
}
