// The git panel: what changed in a workspace's folder, and the everyday moves on it.
// These are your actions from the interface, not Claude's, so they don't pass the gate.
// Every call is an argv (never a shell string) with prompts switched off.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { complete, isMock } from "./anthropic";
import { config } from "./config";
import { recordUsage } from "./usage";

const ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", GIT_PAGER: "cat", LC_ALL: "C" };

export class GitError extends Error {}

export async function git(cwd: string, args: string[], input?: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, env: ENV, stdout: "pipe", stderr: "pipe", stdin: input ? "pipe" : "ignore" });
  if (input && proc.stdin) {
    proc.stdin.write(input);
    proc.stdin.end();
  }
  const timer = setTimeout(() => proc.kill(), 60_000);
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  if (code !== 0) throw new GitError((err || out).trim().split("\n").slice(-3).join("\n") || `git ${args[0]} failed`);
  return out;
}

export interface FileChange {
  path: string;
  from?: string;
  /** index (staged) and worktree letters from `git status`: M, A, D, R, ?, U */
  x: string;
  y: string;
}

export interface GitState {
  repo: boolean;
  installed: boolean;
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  staged?: FileChange[];
  changes?: FileChange[];
  conflicts?: FileChange[];
  branches?: string[];
  log?: { hash: string; subject: string; author: string; when: string }[];
}

export function parseStatus(raw: string) {
  const parts = raw.split("\0");
  let branch: string | undefined, upstream: string | undefined;
  let ahead = 0,
    behind = 0;
  const staged: FileChange[] = [];
  const changes: FileChange[] = [];
  const conflicts: FileChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    if (p.startsWith("## ")) {
      const head = p.slice(3);
      const m = head.match(/^(?:No commits yet on )?([^.\s]+(?:\.[^.\s]+)*?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/);
      branch = m?.[1] ?? head;
      upstream = m?.[2];
      ahead = Number(m?.[3]?.match(/ahead (\d+)/)?.[1] ?? 0);
      behind = Number(m?.[3]?.match(/behind (\d+)/)?.[1] ?? 0);
      continue;
    }
    const x = p[0],
      y = p[1],
      path = p.slice(3);
    const change: FileChange = { path, x, y };
    if (x === "R" || x === "C") change.from = parts[++i];
    if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) conflicts.push(change);
    else {
      if (x !== " " && x !== "?") staged.push(change);
      if (y !== " ") changes.push(change);
    }
  }
  return { branch, upstream, ahead, behind, staged, changes, conflicts };
}

let hasGit: boolean | null = null;
export async function state(cwd: string): Promise<GitState> {
  if (hasGit === null) hasGit = !!Bun.which("git");
  if (!hasGit) return { repo: false, installed: false };
  if (!existsSync(cwd)) return { repo: false, installed: true };
  try {
    await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return { repo: false, installed: true };
  }
  const [status, branches, log] = await Promise.all([
    git(cwd, ["status", "--porcelain=v1", "-b", "-z", "--untracked-files=all"]),
    git(cwd, ["branch", "--format=%(refname:short)"]).catch(() => ""),
    git(cwd, ["log", "-n", "12", "--format=%h%x1f%s%x1f%an%x1f%cr"]).catch(() => ""),
  ]);
  return {
    repo: true,
    installed: true,
    ...parseStatus(status),
    branches: branches.split("\n").filter(Boolean),
    log: log
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [hash, subject, author, when] = l.split("\x1f");
        return { hash, subject, author, when };
      }),
  };
}

const MAX_DIFF = 200_000;
export async function diff(cwd: string, path: string, staged: boolean): Promise<string> {
  let out: string;
  if (staged) out = await git(cwd, ["diff", "--cached", "--no-color", "--", path]);
  else {
    out = await git(cwd, ["diff", "--no-color", "--", path]);
    // untracked files have no diff against the index; show them as new
    if (!out.trim() && existsSync(join(cwd, path))) out = await git(cwd, ["diff", "--no-color", "--no-index", "--", "/dev/null", path]).catch((e) => String(e.message));
  }
  return out.length > MAX_DIFF ? out.slice(0, MAX_DIFF) + "\n\n(cut here: the diff is longer)" : out;
}

const paths = (p: unknown) => {
  const list = (Array.isArray(p) ? p : [p]).map(String).filter(Boolean);
  if (!list.length) throw new GitError("Pick at least one file");
  if (list.some((x) => x.startsWith("-"))) throw new GitError("That isn't a file name");
  return list;
};

export const stage = async (cwd: string, p: unknown) => git(cwd, ["add", "--", ...paths(p)]);
export const stageAll = async (cwd: string) => git(cwd, ["add", "--all"]);
export const unstage = async (cwd: string, p: unknown) => git(cwd, ["restore", "--staged", "--", ...paths(p)]);

/** Throw away changes. Tracked files go back to the last commit; untracked ones are deleted. */
export async function discard(cwd: string, p: unknown) {
  const list = paths(p);
  const st = parseStatus(await git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...list]));
  const untracked = st.changes.filter((c) => c.x === "?").map((c) => c.path);
  const tracked = list.filter((x) => !untracked.includes(x));
  if (tracked.length) await git(cwd, ["restore", "--worktree", "--", ...tracked]);
  if (untracked.length) await git(cwd, ["clean", "-f", "--", ...untracked]);
}

export async function commit(cwd: string, message: string, all = false) {
  const msg = message.trim();
  if (!msg) throw new GitError("Write a commit message first");
  if (all) await stageAll(cwd);
  return git(cwd, ["commit", "-F", "-"], msg + "\n");
}

export const checkout = async (cwd: string, branch: string) => {
  if (!branch || branch.startsWith("-")) throw new GitError("That isn't a branch name");
  return git(cwd, ["switch", branch]);
};
export const createBranch = async (cwd: string, branch: string) => {
  if (!/^[\w./-]+$/.test(branch) || branch.startsWith("-")) throw new GitError("Branch names use letters, digits, / . _ and -");
  return git(cwd, ["switch", "-c", branch]);
};
export const push = async (cwd: string) => {
  const s = parseStatus(await git(cwd, ["status", "--porcelain=v1", "-b", "-z"]));
  return s.upstream ? git(cwd, ["push"]) : git(cwd, ["push", "-u", "origin", s.branch ?? "HEAD"]);
};
export const pull = async (cwd: string) => git(cwd, ["pull", "--ff-only"]);
export const init = async (cwd: string) => git(cwd, ["init"]);

/** Ask the scribe model for a commit message that describes the staged changes. */
export async function draftMessage(wsId: string, cwd: string): Promise<string> {
  let staged = await git(cwd, ["diff", "--cached", "--no-color", "--stat"]);
  if (!staged.trim()) throw new GitError("Stage some changes first");
  const patch = await git(cwd, ["diff", "--cached", "--no-color", "-U2"]);
  const recent = await git(cwd, ["log", "-n", "8", "--format=%s"]).catch(() => "");
  if (isMock()) return "Update " + staged.split("\n")[0].trim().split(/\s+/)[0];
  const c = config();
  const r = await complete({
    model: c.models.scribe,
    max_tokens: 400,
    effort: "low",
    system:
      "You write git commit messages. Reply with the message only: a subject line under 70 characters in the imperative mood, then, only when the change needs it, a blank line and a short body that says why. Match the style of the recent subjects. No quotes, no code fences, no emoji, no dashes as punctuation.",
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: `Recent subjects:\n${recent || "(none)"}\n\nStaged:\n${staged}\n\n${patch.slice(0, 40_000)}` }],
      },
    ],
  });
  recordUsage(wsId, null, "scribe", c.models.scribe, r.usage);
  return r.text.trim().replace(/^```\w*\n?|```$/g, "").trim();
}
