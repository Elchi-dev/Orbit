// Helpers (subagents). A helper is a workspace with a parent: its own conversation,
// shell, model, tools and cost, visible and steerable while it runs. It never gets more
// than its parent: the same approval mode, the same gate, optionally fewer folders it may
// write to, optionally its own git worktree so parallel helpers can't trip over each other.
// When it finishes, the parent gets a short report instead of the whole transcript.

import { existsSync, mkdirSync, readdirSync, readFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { ORBIT_DIR, config } from "./config";
import { db, getWorkspace, now, uid, type WorkspaceRow } from "./db";
import { broadcast } from "./hub";
import { frontmatter } from "./context";
import { git } from "./git";

// ---------- agent definitions ----------
export interface AgentDef {
  name: string;
  description: string;
  /** tool names; empty means the parent's tools */
  tools: string[];
  /** "inherit", "fast" (the judge model), "light" (the scribe model), a family (opus, sonnet, haiku) or a model id */
  model: string;
  prompt: string;
  source: "builtin" | "project" | "orbit" | "claude";
}

const READ = ["read_file", "list_dir", "glob", "grep", "fetch_url", "load_skill", "knowledge", "plan"];

export const BUILTIN_AGENTS: AgentDef[] = [
  {
    name: "explorer",
    description: "Finds things out: searches and reads the codebase (and the web) to answer a question. Changes nothing. Fast and cheap; use several at once for separate questions.",
    tools: [...READ, "bash", "screenshot"],
    model: "fast",
    prompt: "You investigate and report. Never change files. Run only commands that look (ls, rg, git log, test listings). Quote file paths with line numbers for everything you claim.",
    source: "builtin",
  },
  {
    name: "builder",
    description: "Implements a well-defined change: writes and edits code, runs it, fixes what fails. Give it the exact goal, the files or folders it owns and how to check the result.",
    tools: [],
    model: "inherit",
    prompt: "You implement one well-defined change. Stay inside the files and folders you were given. Build in small steps and run what you build. If something outside your part blocks you, stop and say so in the report rather than working around it.",
    source: "builtin",
  },
  {
    name: "reviewer",
    description: "Reviews code or a diff for bugs, risks, missing tests and unclear naming, and reports findings ranked by severity. Changes nothing.",
    tools: [...READ, "bash"],
    model: "inherit",
    prompt: "You review. Never change files. Read the diff (git diff, git log -p) and the code around it. Report findings ranked by severity, each with file:line, what is wrong, why it matters and a concrete fix. Say plainly when you find nothing serious.",
    source: "builtin",
  },
  {
    name: "tester",
    description: "Runs tests, builds and linters, and reports exactly what fails and why, with the shortest way to reproduce it. Changes nothing.",
    tools: [...READ, "bash"],
    model: "fast",
    prompt: "You run checks and report. Never change source files. Find how the project runs its tests, builds and linters, run them, and report each failure with the command, the error and the likely cause.",
    source: "builtin",
  },
];

function parseTools(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .replace(/^\[|\]$/g, "")
    .split(/[,\s]+/)
    .map((t) => t.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
    .map((t) => CLAUDE_TOOL_NAMES[t] ?? t);
}

// Claude Code's tool names, so its agent files work here as they are
const CLAUDE_TOOL_NAMES: Record<string, string> = {
  Read: "read_file",
  Write: "write_file",
  Edit: "edit_file",
  MultiEdit: "edit_file",
  Bash: "bash",
  Glob: "glob",
  Grep: "grep",
  LS: "list_dir",
  WebFetch: "fetch_url",
  TodoWrite: "plan",
};

/** Built-ins, then definitions from .claude/agents, .orbit/agents, ~/.orbit/agents and ~/.claude/agents; the first name wins. */
export function listAgents(cwd?: string): AgentDef[] {
  const out: AgentDef[] = [];
  const seen = new Set<string>();
  const dirs: { dir: string; source: AgentDef["source"] }[] = [];
  if (cwd) dirs.push({ dir: join(cwd, ".orbit", "agents"), source: "project" }, { dir: join(cwd, ".claude", "agents"), source: "project" });
  dirs.push({ dir: join(ORBIT_DIR, "agents"), source: "orbit" }, { dir: join(homedir(), ".claude", "agents"), source: "claude" });
  for (const { dir, source } of dirs) {
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const text = readFileSync(join(dir, f), "utf8").slice(0, 40_000);
        const fm = frontmatter(text);
        const name = (fm.name || basename(f, ".md")).trim();
        if (seen.has(name)) continue;
        seen.add(name);
        out.push({
          name,
          description: (fm.description || "").slice(0, 400),
          tools: parseTools(fm.tools),
          model: (fm.model || "inherit").trim(),
          prompt: text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim(),
          source,
        });
      } catch {}
    }
  }
  for (const b of BUILTIN_AGENTS) if (!seen.has(b.name)) out.push(b);
  return out;
}

export function resolveModel(alias: string, parent: WorkspaceRow): string {
  const c = config();
  const a = (alias || "inherit").toLowerCase();
  if (a === "inherit") return parent.model || c.models.pilot;
  if (a === "fast") return c.models.judge;
  if (a === "light") return c.models.scribe;
  const family = Object.keys(c.pricing).find((m) => m.includes(a));
  return family ?? alias;
}

// ---------- who may delegate ----------
export function depthOf(ws: WorkspaceRow): number {
  let d = 0;
  let cur: WorkspaceRow | null = ws;
  while (cur?.parent_id && d < 10) {
    cur = getWorkspace(cur.parent_id);
    d++;
  }
  return d;
}

export function canDelegate(ws: WorkspaceRow): boolean {
  const h = config().helpers;
  return h?.enabled !== false && depthOf(ws) < (h?.max_depth ?? 1);
}

export const helpersOf = (parentId: string) => db.query<WorkspaceRow, [string]>("SELECT * FROM workspaces WHERE parent_id = ? ORDER BY created_at").all(parentId);

// ---------- worktrees ----------
async function makeWorktree(parent: WorkspaceRow, slug: string) {
  const top = (await git(parent.cwd, ["rev-parse", "--show-toplevel"])).trim();
  const base = (await git(top, ["rev-parse", "HEAD"])).trim();
  const branch = `orbit/${slug}`;
  const dir = join(top, ".orbit", "worktrees", slug);
  mkdirSync(join(top, ".orbit", "worktrees"), { recursive: true });
  // keep Orbit's folders out of the user's git status without touching their .gitignore
  try {
    const exclude = join((await git(top, ["rev-parse", "--git-common-dir"])).trim().replace(/^(?!\/)/, `${top}/`), "info", "exclude");
    const cur = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
    if (!cur.includes(".orbit/")) appendFileSync(exclude, `${cur.endsWith("\n") || !cur ? "" : "\n"}.orbit/\n`);
  } catch {}
  await git(top, ["worktree", "add", "-b", branch, dir, "HEAD"]);
  const sub = relative(top, parent.cwd);
  return { cwd: sub ? join(dir, sub) : dir, branch, base };
}

// ---------- running one ----------
export interface DelegateInput {
  agent?: string;
  task: string;
  name?: string;
  paths?: string[];
  isolate?: boolean;
  model?: string;
  helper?: string;
  /** the delegate call that started it, so the interface can show the helper in place */
  call_id?: string;
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "helper";

const REPORT = `When you are done, end with a report for the agent that sent you, in this shape:
Outcome: one line, done or not and why.
What I found or did: short bullets, with file:line where it helps.
Files changed: paths, or "none".
Open: what is left or uncertain.
Keep it under 250 words; the full conversation stays available to the user.`;

export async function createHelper(parent: WorkspaceRow, input: DelegateInput): Promise<WorkspaceRow> {
  const agents = listAgents(parent.cwd);
  const def = agents.find((a) => a.name === (input.agent || "builder")) ?? agents.find((a) => a.name === "builder")!;
  const title = (input.name || `${def.name}: ${input.task.split("\n")[0]}`).slice(0, 60);
  const id = uid("w_");
  let cwd = parent.cwd;
  let branch = "";
  let base = "";
  if (input.isolate) {
    const wt = await makeWorktree(parent, `${slugify(input.name || def.name)}-${id.slice(2, 6)}`);
    cwd = wt.cwd;
    branch = wt.branch;
    base = wt.base;
  }
  const scope = (input.paths ?? []).map((p) => resolve(parent.cwd, p)).map((p) => (branch ? p.replace(resolve(parent.cwd), cwd) : p));
  const prompt = [
    `You are a helper ("${def.name}") working for another agent in Orbit. You see nothing of its conversation: everything you need is in the task.`,
    def.prompt,
    scope.length ? `You may change files only in: ${scope.join(", ")}. Writes elsewhere are refused.` : "",
    branch ? `You work in your own git worktree on branch ${branch}, made from the last commit (uncommitted changes in the main folder are not here). Your changes come back for review.` : "",
    REPORT,
  ]
    .filter(Boolean)
    .join("\n\n");
  db.run(
    `INSERT INTO workspaces (id, title, cwd, model, mode, style, system_prompt, judge_notes, incognito, titled, profile, parent_id, agent, scope, tools, branch, base, helper_state, call_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      title,
      cwd,
      resolveModel(input.model || def.model, parent),
      parent.mode,
      parent.style,
      prompt,
      parent.judge_notes,
      parent.incognito,
      1,
      parent.profile,
      parent.id,
      def.name,
      JSON.stringify(scope),
      JSON.stringify(def.tools),
      branch,
      base,
      "running",
      input.call_id ?? "",
      now(),
      now(),
    ],
  );
  const w = getWorkspace(id)!;
  broadcast("helper", { workspaceId: parent.id, helper: helperView(w) });
  return w;
}

export function helperView(w: WorkspaceRow) {
  return { id: w.id, title: w.title, agent: w.agent, model: w.model, state: w.helper_state, branch: w.branch, report: w.report, parent_id: w.parent_id, cwd: w.cwd, call_id: w.call_id, created_at: w.created_at };
}

function setState(w: WorkspaceRow, state: string, report?: string) {
  db.run("UPDATE workspaces SET helper_state = ?, report = COALESCE(?, report), updated_at = ? WHERE id = ?", [state, report ?? null, now(), w.id]);
  const fresh = getWorkspace(w.id)!;
  broadcast("helper", { workspaceId: w.parent_id, helper: helperView(fresh) });
}

/** What the helper changed: files from its journal, or the diff of its branch. */
async function changes(w: WorkspaceRow): Promise<string> {
  if (w.branch) {
    try {
      await git(w.cwd, ["add", "-A"]);
      const staged = (await git(w.cwd, ["diff", "--cached", "--name-only"])).trim();
      if (staged) await git(w.cwd, ["-c", "user.name=Orbit helper", "-c", "user.email=helper@orbit.local", "commit", "-q", "-m", `${w.title}`]);
      const stat = (await git(w.cwd, ["diff", "--stat", `${w.base}..HEAD`])).trim();
      return stat ? `On branch ${w.branch}:\n${stat}` : "none";
    } catch (e) {
      return `(could not read the branch: ${(e as Error).message})`;
    }
  }
  const files = db
    .query<{ path: string }, [string]>("SELECT DISTINCT path FROM snapshots WHERE workspace_id = ? ORDER BY id")
    .all(w.id)
    .map((r) => relative(w.cwd, r.path) || r.path);
  return files.length ? files.join(", ") : "none";
}

function costOfHelper(id: string) {
  return db.query<{ cost: number; tokens: number }, [string]>("SELECT COALESCE(SUM(cost),0) AS cost, COALESCE(SUM(input+output+cache_read+cache_write),0) AS tokens FROM usage WHERE workspace_id = ?").get(id)!;
}

/**
 * Run a task in a helper and wait for its report. A follow-up to an earlier helper
 * (input.helper) continues its conversation instead of starting a new one.
 */
export async function delegate(parent: WorkspaceRow, input: DelegateInput, opts: { unattended?: boolean; signal?: AbortSignal; run: (wsId: string, content: any[], o: any) => Promise<string> }) {
  if (!input?.task?.trim()) return { content: "Give the helper a task.", isError: true };
  let w: WorkspaceRow;
  if (input.helper) {
    const prev = getWorkspace(input.helper);
    if (!prev || prev.parent_id !== parent.id) return { content: `No helper ${input.helper} here.`, isError: true };
    w = prev;
    if (input.call_id) db.run("UPDATE workspaces SET call_id = ? WHERE id = ?", [input.call_id, w.id]);
  } else {
    try {
      w = await createHelper(parent, input);
    } catch (e) {
      return { content: `The helper couldn't start: ${(e as Error).message}`, isError: true };
    }
  }
  setState(w, "running");
  const onAbort = () => import("./agent").then((a) => a.stop(w.id));
  opts.signal?.addEventListener("abort", onAbort);
  let reason = "error";
  try {
    reason = await opts.run(w.id, [{ type: "text", text: input.task }], { unattended: opts.unattended });
  } catch (e) {
    reason = `error: ${(e as Error).message}`;
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }
  w = getWorkspace(w.id)!;
  const last = db
    .query<{ content: string }, [string]>("SELECT content FROM messages WHERE workspace_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1")
    .get(w.id);
  const reply = last ? (JSON.parse(last.content) as any[]).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim() : "";
  const changed = await changes(w);
  const { cost, tokens } = costOfHelper(w.id);
  setState(w, reason === "done" ? "done" : reason === "stopped" ? "stopped" : "failed", reply.slice(0, 6000));
  const head = `Helper "${w.title}" (${w.agent}, ${w.model}, id ${w.id}) ${reason === "done" ? "finished" : `ended: ${reason}`}.`;
  const tail = [`Files changed: ${changed}`, w.branch ? `Its changes are on branch ${w.branch}; the user reviews and merges them from the helper's panel. Don't merge it yourself.` : "", `Cost: $${cost.toFixed(4)}, ${Math.round(tokens / 1000)}k tokens.`]
    .filter(Boolean)
    .join("\n");
  return { content: `${head}\n\nReport:\n${reply || "(no report)"}\n\n${tail}`, isError: reason !== "done" };
}

/** Bring a helper's branch into the main folder as staged changes, for the user to look at and commit. */
export async function mergeHelper(id: string) {
  const w = getWorkspace(id);
  if (!w?.branch || !w.parent_id) throw new Error("This helper has no branch to merge");
  const parent = getWorkspace(w.parent_id)!;
  const top = (await git(parent.cwd, ["rev-parse", "--show-toplevel"])).trim();
  await git(top, ["merge", "--squash", w.branch]);
  setState(w, "merged");
  return { ok: true };
}

/** Remove a helper's worktree and branch. */
export async function discardHelper(id: string) {
  const w = getWorkspace(id);
  if (!w?.branch) throw new Error("This helper has no branch");
  const top = (await git(w.cwd, ["rev-parse", "--show-toplevel"]).catch(() => w.cwd)).trim();
  const main = (await git(top, ["rev-parse", "--git-common-dir"])).trim();
  const mainTop = resolve(top, main, "..");
  const wtRoot = top;
  await git(mainTop, ["worktree", "remove", "--force", wtRoot]).catch(() => {});
  await git(mainTop, ["branch", "-D", w.branch]).catch(() => {});
  setState(w, w.helper_state === "merged" ? "merged" : "discarded");
  return { ok: true };
}

export const isInScope = (ws: WorkspaceRow, path: string): boolean => {
  let scope: string[] = [];
  try {
    scope = JSON.parse(ws.scope || "[]");
  } catch {}
  if (!scope.length) return true;
  const p = resolve(path);
  return scope.some((s) => p === s || p.startsWith(s.endsWith(sep) ? s : s + sep));
};
