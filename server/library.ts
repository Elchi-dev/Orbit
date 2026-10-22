// The library: skills (how to do a kind of work) and knowledge (what to know),
// from three places. Built-ins ship inside Orbit and can be switched off or
// copied to edit; your own live in ~/.orbit; a project's in its .orbit folder.
// The first one found under a name wins: project, then yours, then built-in.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ORBIT_DIR, config } from "./config";
import { frontmatter } from "./context";
import { LIBRARY } from "./library-data";

export type LibKind = "skill" | "knowledge";
export type LibSource = "project" | "orbit" | "claude" | "builtin";

export interface KnowledgeEntry {
  name: string;
  title: string;
  description: string;
  /** put in front of Claude every time instead of only listed */
  always: boolean;
  source: LibSource;
  path: string | null;
}

export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const slugName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63) || "untitled";

const stripFront = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
const firstHeading = (text: string) => stripFront(text).match(/^#\s+(.+)$/m)?.[1]?.trim();

// ---------- built-ins ----------
export function builtinSkills() {
  return Object.entries(LIBRARY)
    .filter(([p]) => /^skills\/[^/]+\/SKILL\.md$/.test(p))
    .map(([p, text]) => {
      const fm = frontmatter(text);
      const name = fm.name || p.split("/")[1];
      return { name, description: fm.description ?? "", title: firstHeading(text) ?? name, text };
    });
}

export function builtinKnowledge() {
  return Object.entries(LIBRARY)
    .filter(([p]) => /^knowledge\/[^/]+\.md$/.test(p))
    .map(([p, text]) => {
      const fm = frontmatter(text);
      const name = fm.name || p.slice(10, -3);
      return { name, title: fm.title || firstHeading(text) || name, description: fm.description ?? "", always: fm.always === "true", text };
    });
}

export function templates(kind: LibKind) {
  const dir = `templates/${kind}/`;
  return Object.entries(LIBRARY)
    .filter(([p]) => p.startsWith(dir))
    .map(([p, text]) => {
      // a template starts with its own two lines, then the file it makes
      const meta = (k: string) => text.match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1]?.trim();
      const body = text.replace(/^template(_description)?:.*\r?\n/gm, "");
      return { id: p.slice(dir.length, -3), title: meta("template") || firstHeading(body) || p, description: meta("template_description") ?? "", text: body };
    });
}

// ---------- knowledge ----------
export function knowledgeDirs(cwd?: string): { dir: string; source: LibSource }[] {
  const dirs: { dir: string; source: LibSource }[] = [];
  if (cwd) dirs.push({ dir: join(cwd, ".orbit", "knowledge"), source: "project" });
  dirs.push({ dir: join(ORBIT_DIR, "knowledge"), source: "orbit" });
  return dirs;
}

/** Every knowledge file Claude may use here, minus the ones switched off. */
export function findKnowledge(cwd?: string, all = false): (KnowledgeEntry & { enabled: boolean })[] {
  const k = config().knowledge;
  if (!all && k?.enabled === false) return [];
  const off = new Set(k?.disabled ?? []);
  const seen = new Set<string>();
  const out: (KnowledgeEntry & { enabled: boolean })[] = [];
  for (const { dir, source } of knowledgeDirs(cwd)) {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.endsWith(".md")) continue;
      const path = join(dir, f);
      try {
        if (!statSync(path).isFile()) continue;
        const text = readFileSync(path, "utf8").slice(0, 4000);
        const fm = frontmatter(text);
        const name = f.slice(0, -3);
        if (seen.has(name)) continue;
        seen.add(name);
        out.push({ name, title: fm.title || firstHeading(text) || name, description: fm.description ?? "", always: fm.always === "true", source, path, enabled: !off.has(name) });
      } catch {}
    }
  }
  for (const b of builtinKnowledge()) {
    if (seen.has(b.name)) continue;
    seen.add(b.name);
    out.push({ name: b.name, title: b.title, description: b.description, always: b.always, source: "builtin", path: null, enabled: !off.has(b.name) });
  }
  return all ? out : out.filter((e) => e.enabled);
}

export function readKnowledge(cwd: string | undefined, name: string): string | null {
  const e = findKnowledge(cwd, true).find((x) => x.name === name);
  if (!e) return null;
  if (e.path) return readFileSync(e.path, "utf8");
  return builtinKnowledge().find((b) => b.name === name)?.text ?? null;
}

const MAX_ALWAYS = 8000;

/** The part of the system prompt about knowledge: an index, plus the files marked "always". */
export function knowledgePrompt(cwd: string): string {
  const list = findKnowledge(cwd);
  if (!list.length) return "";
  const always: string[] = [];
  let room = config().knowledge?.always_max_chars ?? MAX_ALWAYS;
  for (const e of list.filter((x) => x.always)) {
    const body = stripFront(readKnowledge(cwd, e.name) ?? "");
    if (!body || body.length > room) continue;
    room -= body.length;
    always.push(`<knowledge name="${e.name}">\n${body}\n</knowledge>`);
  }
  const rest = list.filter((x) => !always.some((a) => a.startsWith(`<knowledge name="${x.name}"`)));
  const parts: string[] = [];
  if (always.length) parts.push(`What the user keeps in front of you (knowledge files):\n${always.join("\n")}`);
  if (rest.length)
    parts.push(
      `Knowledge files: reference the user keeps for you. When a question touches one, read it with the knowledge tool (by name, or search them all with a query) instead of guessing.\n${rest
        .map((e) => `- ${e.name}: ${e.description || e.title}`)
        .join("\n")}`,
    );
  return parts.join("\n\n");
}

/** A plain term search over every knowledge file: the best few passages with their file. */
export function searchKnowledge(cwd: string, query: string, limit = 6) {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
  if (!terms.length) return [];
  const hits: { name: string; score: number; text: string }[] = [];
  for (const e of findKnowledge(cwd)) {
    const body = stripFront(readKnowledge(cwd, e.name) ?? "");
    const paras = body.split(/\n\s*\n/);
    paras.forEach((p, i) => {
      const low = (e.title + " " + p).toLowerCase();
      // passages matching more of the words beat ones repeating a single word
      let score = 0;
      for (const t of terms) {
        const n = low.split(t).length - 1;
        if (n) score += 10 + Math.min(n, 5);
      }
      if (score) hits.push({ name: e.name, score: score + (i === 0 ? 0.5 : 0), text: p.slice(0, 1200) });
    });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---------- writing your own ----------
const userDir = (kind: LibKind, cwd?: string, project = false) =>
  project && cwd ? join(cwd, ".orbit", kind === "skill" ? "skills" : "knowledge") : join(ORBIT_DIR, kind === "skill" ? "skills" : "knowledge");

export function entryPath(kind: LibKind, name: string, cwd?: string, project = false) {
  if (!NAME_RE.test(name)) throw new Error("Names are lower case letters, digits and dashes, like code-review.");
  const dir = userDir(kind, cwd, project);
  return kind === "skill" ? join(dir, name, "SKILL.md") : join(dir, `${name}.md`);
}

/** Make sure a skill's text starts with frontmatter carrying its name and description. */
export function normaliseSkill(name: string, text: string, description?: string) {
  const fm = frontmatter(text);
  const body = stripFront(text);
  const desc = (description ?? fm.description ?? "").replace(/\s+/g, " ").trim();
  return `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body}\n`;
}

export function normaliseKnowledge(text: string, meta: { title?: string; description?: string; always?: boolean }) {
  const fm = frontmatter(text);
  const body = stripFront(text);
  const title = (meta.title ?? fm.title ?? firstHeading(text) ?? "").trim();
  const desc = (meta.description ?? fm.description ?? "").replace(/\s+/g, " ").trim();
  const always = meta.always ?? fm.always === "true";
  return `---\ntitle: ${title}\ndescription: ${desc}\nalways: ${always}\n---\n\n${body}\n`;
}

export function saveEntry(kind: LibKind, name: string, text: string, opts: { cwd?: string; project?: boolean } = {}) {
  const path = entryPath(kind, name, opts.cwd, opts.project);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  return path;
}

export function deleteEntry(kind: LibKind, name: string, opts: { cwd?: string; project?: boolean } = {}) {
  const path = entryPath(kind, name, opts.cwd, opts.project);
  if (!existsSync(path)) throw new Error("Only your own files can be deleted; built-ins can be switched off.");
  if (kind === "skill") rmSync(join(path, ".."), { recursive: true, force: true });
  else rmSync(path);
}
