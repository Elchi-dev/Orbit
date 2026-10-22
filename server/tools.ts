import { canDelegate, delegate } from "./helpers";
import { openPreview, previewState, resolveTarget } from "./preview";
import { isLocalUrl, screenshot } from "./screenshot";
import { profileAllows, type Profile } from "./profiles";
import { loadSkill } from "./context";
import { callMcp, mcpSubject, mcpTools } from "./mcp";
import { catalogReadOnly, catalogUnsafe } from "./catalog";
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { config } from "./config";
import { db, now, getWorkspace, type WorkspaceRow } from "./db";
import { shellFor } from "./shell";
import { broadcast } from "./hub";

export interface ToolCtx {
  ws: WorkspaceRow;
  toolCallId: string;
  onOutput: (chunk: string) => void;
  /** aborted when the user stops the run */
  signal?: AbortSignal;
  /** the run has nobody to ask (a mission or a hands-off profile) */
  unattended?: boolean;
}
export interface ToolResult {
  /** what the interface shows and the journal keeps */
  content: string;
  isError?: boolean;
  /** what Claude gets instead, when it is more than text (screenshots) */
  blocks?: any[];
}

type Schema = Record<string, any>;
const obj = (properties: Record<string, Schema>, required: string[]): Schema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const str = (description: string): Schema => ({ type: "string", description });
const int = (description: string): Schema => ({ type: "integer", description });

interface ToolDef {
  name: string;
  description: string;
  input_schema: Schema;
  readOnly: boolean | ((input: any) => boolean);
  /** may run at the same time as other calls from the same reply (helpers) */
  parallel?: boolean;
  ui?: keyof ReturnType<typeof config>["ui_tools"];
  run: (input: any, ctx: ToolCtx) => Promise<ToolResult>;
}

export function resolvePath(cwd: string, p: string) {
  if (!p) return cwd;
  if (p === "~" || p.startsWith("~/")) p = join(homedir(), p.slice(1));
  return isAbsolute(p) ? resolve(p) : resolve(cwd, p);
}

function snapshot(ctx: ToolCtx, path: string) {
  const c = config();
  if (!c.safety.undo_journal) return;
  const existed = existsSync(path);
  let content: Buffer | null = null;
  if (existed) {
    const size = statSync(path).size;
    if (size > c.safety.undo_max_bytes) return;
    content = readFileSync(path);
  }
  db.run("INSERT INTO snapshots (workspace_id, tool_call_id, path, existed, content, created_at) VALUES (?,?,?,?,?,?)", [
    ctx.ws.id,
    ctx.toolCallId,
    path,
    existed ? 1 : 0,
    content,
    now(),
  ]);
}

// ---- read-only detection for shell commands ----
const SAFE_CMDS = new Set([
  "ls", "ll", "la", "cat", "head", "tail", "wc", "pwd", "echo", "printf", "rg", "grep", "egrep", "fgrep", "tree", "file",
  "stat", "du", "df", "which", "whereis", "type", "whoami", "id", "date", "uname", "hostname", "env", "printenv", "sort",
  "uniq", "cut", "tr", "basename", "dirname", "realpath", "readlink", "diff", "cmp", "md5sum", "sha256sum", "shasum",
  "nproc", "uptime", "free", "ps", "lsof", "jq", "less", "more", "column", "nl", "true", "test", "[",
]);
const SAFE_GIT = /^git\s+(status|log|diff|show|branch(\s+-[avr]+)?\s*$|remote\s+-v|rev-parse|ls-files|blame|describe|tag\s*$|config\s+--get)/;
const VERSION_CHECK = /^[\w.-]+\s+(--version|-v|-V|version)\s*$/;

export function isReadOnlyCommand(command: string): boolean {
  const c = command.trim();
  if (!c) return true;
  if (/[`]|\$\(|>|<\(|\btee\b|\bsudo\b/.test(c)) return false;
  const segments = c.split(/\s*(?:&&|\|\||;|\||\n)\s*/).filter(Boolean);
  return segments.every((seg) => {
    const s = seg.replace(/^(\w+=\S*\s+)+/, "");
    const first = s.split(/\s+/)[0];
    if (first === "cd") return true;
    if (catalogUnsafe(s)) return false;
    if (SAFE_GIT.test(s) || VERSION_CHECK.test(s)) return true;
    if (first === "find") return !/\s-(delete|exec|execdir|ok|fprint)/.test(s);
    return SAFE_CMDS.has(first) || catalogReadOnly(s);
  });
}

// ---- grep fallback when ripgrep is missing ----
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "target", ".venv", "__pycache__"]);
function walk(dir: string, out: string[], limit: number) {
  if (out.length >= limit) return;
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= limit) return;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p, out, limit);
    } else out.push(p);
  }
}

const TOOLS: ToolDef[] = [
  {
    name: "delegate",
    description:
      "Send a task to a helper: a separate agent with its own context, shell and model that works while you wait and returns a short report. Several delegate calls in the same reply run in parallel. The helper sees none of this conversation, so the task must stand on its own: the goal, the relevant files, constraints, and how to check the result. Set paths to the folders or files a builder may change (writes elsewhere are refused). Set isolate to give it its own git worktree and branch, so parallel builders can't collide; the user merges the branch. To follow up with the same helper (it keeps its context), pass helper with its id from the earlier report.",
    input_schema: obj(
      {
        agent: str("Which kind of helper, from the list in your instructions (default builder)"),
        task: str("The complete task, standing on its own"),
        name: str("A short name the user sees, like 'Login form' or 'Find slow queries'"),
        paths: { type: "array", items: { type: "string" }, description: "Folders or files the helper may change, relative to the workspace. Leave out for no limit." },
        isolate: { type: "boolean", description: "Work in a separate git worktree on its own branch" },
        model: str("Override the model: fast, light, inherit, opus, sonnet, haiku or a model id"),
        helper: str("The id of an earlier helper to continue, instead of starting a new one"),
      },
      ["task"],
    ),
    readOnly: true,
    parallel: true,
    async run(input, ctx) {
      const { runTurn } = await import("./agent");
      return delegate(ctx.ws, input, { unattended: ctx.unattended, signal: ctx.signal, run: runTurn });
    },
  },
  {
    name: "plan",
    description:
      "Write or update your plan for the current task as a checklist the user sees above the composer. Send the whole list every time. Use it for work with more than two steps: write it before you start, mark one item doing at a time, and mark items done (or skipped, with the reason in the text) as you go.",
    input_schema: obj(
      {
        items: {
          type: "array",
          description: "The whole plan, in order",
          items: obj({ text: str("One step, a short line"), status: { type: "string", enum: ["todo", "doing", "done", "skipped"] } }, ["text", "status"]),
        },
      },
      ["items"],
    ),
    readOnly: true,
    async run(input, ctx) {
      const items = (Array.isArray(input?.items) ? input.items : [])
        .slice(0, 60)
        .map((i: any) => ({ text: String(i?.text ?? "").slice(0, 300), status: ["todo", "doing", "done", "skipped"].includes(i?.status) ? i.status : "todo" }))
        .filter((i: any) => i.text);
      db.run("UPDATE workspaces SET plan = ? WHERE id = ?", [JSON.stringify(items), ctx.ws.id]);
      broadcast("plan", { workspaceId: ctx.ws.id, plan: items });
      const done = items.filter((i: any) => i.status === "done").length;
      return { content: `Plan saved: ${done} of ${items.length} done.` };
    },
  },
  {
    name: "preview_open",
    description:
      "Show a page in the live preview next to the conversation, where the user watches it. target is a file or folder in the workspace (an HTML file, or a folder with index.html; it reloads by itself when files change) or a local dev server URL like http://localhost:5173. Start dev servers in the background first.",
    input_schema: obj({ target: str("A path in the workspace, or a http://localhost URL") }, ["target"]),
    readOnly: true,
    async run(input, ctx) {
      try {
        const st = openPreview(ctx.ws.id, String(input?.target ?? "."));
        return { content: `The preview now shows ${st.target} (${st.url}).` };
      } catch (e) {
        return { content: (e as Error).message, isError: true };
      }
    },
  },
  {
    name: "screenshot",
    description:
      "Look at a page the way a person would: load it in a headless browser at one or more widths and get the screenshots back, plus the page's console messages and errors. target is a path in the workspace, a local URL, or any https URL (another site, for reference; that passes the approval gate like a fetch). Leave it out for what the preview shows. Use it to check your own frontend work before calling it done.",
    input_schema: obj(
      {
        target: str("A path in the workspace or a http://localhost URL; empty for the current preview"),
        widths: { type: "array", items: { type: "integer" }, description: "CSS widths in pixels, like [390, 1280]. Default [1280]." },
        full: { type: "boolean", description: "Capture up to 4000 px of height instead of one screen" },
      },
      [],
    ),
    // looking at your own pages only reads; loading another site goes out, like fetch_url
    readOnly: (i) => !/^https?:\/\//.test(String(i?.target ?? "")) || isLocalUrl(String(i.target)),
    async run(input, ctx) {
      const cur = previewState(ctx.ws.id);
      const target = String(input?.target || cur?.target || "").trim();
      if (!target) return { content: "Nothing to look at: give a target or open the preview first.", isError: true };
      const remote = /^https?:\/\//.test(target) && !isLocalUrl(target);
      let url: string;
      try {
        url = remote ? target : resolveTarget(ctx.ws.id, target).url;
      } catch (e) {
        return { content: (e as Error).message, isError: true };
      }
      const widths = (Array.isArray(input?.widths) && input.widths.length ? input.widths : [1280]).slice(0, 4).map((w: any) => Number(w) || 1280);
      const blocks: any[] = [];
      const names: string[] = [];
      let consoleLines: string[] = [];
      for (const w of widths) {
        try {
          const s = await screenshot(url, w, { full: !!input?.full, remote });
          blocks.push({ type: "text", text: `${target} at ${w} px:` });
          blocks.push({ type: "image", source: { type: "base64", media_type: "image/png", data: s.image } });
          names.push(s.file);
          consoleLines = s.console;
        } catch (e) {
          return { content: (e as Error).message, isError: true };
        }
      }
      const consoleText = consoleLines.length ? `Console:\n${consoleLines.join("\n")}` : "Console: nothing logged.";
      blocks.push({ type: "text", text: consoleText });
      return { content: `Screenshots of ${target} at ${widths.join(", ")} px\n[shots: ${names.join(" ")}]\n${consoleText}`, blocks };
    },
  },
  {
    name: "load_skill",
    parallel: true,
    description: "Load a skill's full instructions by name (the skills are listed in the system prompt). Returns the SKILL.md and the other files in its folder.",
    input_schema: obj({ name: str("The skill's name") }, ["name"]),
    readOnly: true,
    async run(input, ctx) {
      return loadSkill(ctx.ws.cwd, String(input?.name ?? ""));
    },
  },
  {
    name: "bash",
    description:
      "Run a shell command in this workspace's persistent shell session (state like cd and exported variables carries over). stdout and stderr are combined. Avoid interactive commands.",
    input_schema: obj({ command: str("The command to run"), timeout_s: int("Optional timeout in seconds") }, ["command"]),
    readOnly: (i) => isReadOnlyCommand(String(i?.command ?? "")),
    async run(input, ctx) {
      const shell = shellFor(ctx.ws.id, ctx.ws.cwd);
      shell.onData = ctx.onOutput;
      const r = await shell.run(String(input.command), Math.min(Number(input.timeout_s) || config().safety.command_timeout_s, 3600));
      shell.onData = null;
      let tail = "";
      if (r.timedOut) tail = `\n[timed out after ${input.timeout_s ?? config().safety.command_timeout_s}s; the shell was restarted]`;
      else if (r.killed) tail = "\n[stopped by the user]";
      else if (r.exitCode) tail = `\n[exit code ${r.exitCode}]`;
      return { content: (r.output.trim() || "(no output)") + tail, isError: !!(r.timedOut || r.killed || r.exitCode) };
    },
  },
  {
    name: "read_file",
    parallel: true,
    description: "Read a text file. Paths are relative to the workspace folder unless absolute. Returns numbered lines.",
    input_schema: obj(
      { path: str("File path"), offset: int("First line to read, 1-based"), limit: int("Number of lines to read") },
      ["path"],
    ),
    readOnly: true,
    async run(input, ctx) {
      const p = resolvePath(ctx.ws.cwd, input.path);
      if (!existsSync(p)) return { content: `File not found: ${p}`, isError: true };
      if (statSync(p).isDirectory()) return { content: `${p} is a folder; use list_dir`, isError: true };
      const lines = readFileSync(p, "utf8").split("\n");
      const start = Math.max(1, Number(input.offset) || 1);
      const count = Math.min(Number(input.limit) || 2000, 5000);
      const slice = lines.slice(start - 1, start - 1 + count);
      const body = slice.map((l, i) => `${String(start + i).padStart(5)}  ${l.length > 2000 ? l.slice(0, 2000) + "…" : l}`).join("\n");
      const more = start - 1 + count < lines.length ? `\n[${lines.length - (start - 1 + count)} more lines]` : "";
      return { content: body + more };
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file with the given content. Creates parent folders. The previous version is kept for undo.",
    input_schema: obj({ path: str("File path"), content: str("Full file content") }, ["path", "content"]),
    readOnly: false,
    async run(input, ctx) {
      const p = resolvePath(ctx.ws.cwd, input.path);
      snapshot(ctx, p);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, String(input.content));
      broadcast("file_changed", { workspaceId: ctx.ws.id, path: p, kind: "write" });
      return { content: `Wrote ${String(input.content).split("\n").length} lines to ${p}` };
    },
  },
  {
    name: "edit_file",
    description:
      "Replace an exact string in a file. old_string must match exactly once unless replace_all is true. Read the file first.",
    input_schema: obj(
      {
        path: str("File path"),
        old_string: str("Exact text to replace"),
        new_string: str("Replacement text"),
        replace_all: { type: "boolean", description: "Replace every occurrence" },
      },
      ["path", "old_string", "new_string"],
    ),
    readOnly: false,
    async run(input, ctx) {
      const p = resolvePath(ctx.ws.cwd, input.path);
      if (!existsSync(p)) return { content: `File not found: ${p}`, isError: true };
      const text = readFileSync(p, "utf8");
      const count = text.split(input.old_string).length - 1;
      if (count === 0) return { content: "old_string was not found in the file", isError: true };
      if (count > 1 && !input.replace_all)
        return { content: `old_string matches ${count} times; add context or set replace_all`, isError: true };
      snapshot(ctx, p);
      const next = input.replace_all ? text.split(input.old_string).join(input.new_string) : text.replace(input.old_string, () => input.new_string);
      writeFileSync(p, next);
      broadcast("file_changed", { workspaceId: ctx.ws.id, path: p, kind: "edit" });
      return { content: `Edited ${p} (${input.replace_all ? count : 1} replacement${count > 1 && input.replace_all ? "s" : ""})` };
    },
  },
  {
    name: "list_dir",
    parallel: true,
    description: "List a folder's entries with sizes. Relative to the workspace folder unless absolute.",
    input_schema: obj({ path: str("Folder path, default is the workspace folder") }, []),
    readOnly: true,
    async run(input, ctx) {
      const p = resolvePath(ctx.ws.cwd, input.path ?? ".");
      if (!existsSync(p)) return { content: `Not found: ${p}`, isError: true };
      const entries = readdirSync(p, { withFileTypes: true })
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
        .slice(0, 500)
        .map((e) => {
          if (e.isDirectory()) return `${e.name}/`;
          try {
            return `${e.name}  ${statSync(join(p, e.name)).size} B`;
          } catch {
            return e.name;
          }
        });
      return { content: `${p}\n${entries.join("\n") || "(empty)"}` };
    },
  },
  {
    name: "glob",
    parallel: true,
    description: "Find files by glob pattern, e.g. src/**/*.ts. Skips node_modules and .git.",
    input_schema: obj({ pattern: str("Glob pattern"), path: str("Folder to search, default workspace folder") }, ["pattern"]),
    readOnly: true,
    async run(input, ctx) {
      const base = resolvePath(ctx.ws.cwd, input.path ?? ".");
      const out: string[] = [];
      for await (const f of new Bun.Glob(input.pattern).scan({ cwd: base, onlyFiles: true })) {
        if (/(^|\/)(node_modules|\.git)\//.test(f)) continue;
        out.push(f);
        if (out.length >= 500) break;
      }
      return { content: out.length ? out.join("\n") : "No matches" };
    },
  },
  {
    name: "grep",
    parallel: true,
    description: "Search file contents with a regular expression. Returns file:line: text matches.",
    input_schema: obj(
      { pattern: str("Regular expression"), path: str("Folder or file, default workspace folder"), glob: str("Only files matching this glob") },
      ["pattern"],
    ),
    readOnly: true,
    async run(input, ctx) {
      const base = resolvePath(ctx.ws.cwd, input.path ?? ".");
      const rg = Bun.which("rg");
      if (rg) {
        const args = [rg, "-n", "--no-heading", "--color", "never", "-m", "50", "--max-columns", "300"];
        if (input.glob) args.push("-g", input.glob);
        args.push("-e", input.pattern, base);
        const p = Bun.spawnSync(args);
        const text = p.stdout.toString().split("\n").slice(0, 400).join("\n").trim();
        return { content: text || "No matches" };
      }
      let re: RegExp;
      try {
        re = new RegExp(input.pattern);
      } catch (e) {
        return { content: `Bad pattern: ${(e as Error).message}`, isError: true };
      }
      const files: string[] = [];
      if (statSync(base).isFile()) files.push(base);
      else walk(base, files, 5000);
      const g = input.glob ? new Bun.Glob(input.glob) : null;
      const hits: string[] = [];
      for (const f of files) {
        if (g && !g.match(relative(base, f))) continue;
        let text: string;
        try {
          if (statSync(f).size > 1_000_000) continue;
          text = readFileSync(f, "utf8");
        } catch {
          continue;
        }
        if (text.includes("\0")) continue;
        text.split("\n").forEach((l, i) => {
          if (hits.length < 400 && re.test(l)) hits.push(`${relative(base, f)}:${i + 1}: ${l.slice(0, 300)}`);
        });
        if (hits.length >= 400) break;
      }
      return { content: hits.join("\n") || "No matches" };
    },
  },
  {
    name: "fetch_url",
    parallel: true,
    description: "Download a web page or API response and return it as text (HTML is reduced to readable text).",
    input_schema: obj({ url: str("http or https URL") }, ["url"]),
    readOnly: false,
    async run(input) {
      try {
        const res = await fetch(input.url, { redirect: "follow", headers: { "user-agent": "Orbit/0.1" } });
        let text = await res.text();
        if ((res.headers.get("content-type") ?? "").includes("html")) {
          text = text
            .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "")
            .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/\n{3,}/g, "\n\n");
        }
        if (text.length > 40000) text = text.slice(0, 40000) + "\n[cut]";
        return { content: `HTTP ${res.status}\n\n${text}`, isError: !res.ok };
      } catch (e) {
        return { content: `Fetch failed: ${(e as Error).message}`, isError: true };
      }
    },
  },
  // ---- tools that change the Orbit interface itself (each can be switched off in config) ----
  {
    name: "ui_set_title",
    description: "Rename this workspace when the topic becomes clear or changes. Keep it under 6 words.",
    input_schema: obj({ title: str("New workspace title") }, ["title"]),
    readOnly: true,
    ui: "set_title",
    async run(input, ctx) {
      const t = String(input.title).slice(0, 80);
      db.run("UPDATE workspaces SET title = ?, titled = 1 WHERE id = ?", [t, ctx.ws.id]);
      broadcast("workspace", { workspace: getWorkspace(ctx.ws.id) });
      return { content: `Renamed workspace to "${t}"` };
    },
  },
  {
    name: "ui_set_planet",
    description: "Choose how this workspace's planet looks in the Orrery, to match the topic.",
    input_schema: obj(
      {
        color: str("Main colour as hex, e.g. #7A64E0"),
        surface: { type: "string", enum: ["gas", "rocky", "ice", "ocean", "lava"], description: "Surface type" },
        rings: { type: "boolean", description: "Whether the planet has rings" },
      },
      ["color", "surface"],
    ),
    readOnly: true,
    ui: "set_planet",
    async run(input, ctx) {
      const style = { color: /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : "#B8A6FF", surface: input.surface, rings: !!input.rings };
      db.run("UPDATE workspaces SET style = ? WHERE id = ?", [JSON.stringify(style), ctx.ws.id]);
      broadcast("workspace", { workspace: getWorkspace(ctx.ws.id) });
      return { content: "Planet updated" };
    },
  },
  {
    name: "ui_notify",
    description: "Send the user a desktop notification, e.g. when a long task finishes or needs them.",
    input_schema: obj({ title: str("Short title"), body: str("One sentence") }, ["title", "body"]),
    readOnly: true,
    ui: "notify",
    async run(input, ctx) {
      broadcast("notify", { workspaceId: ctx.ws.id, title: input.title, body: input.body });
      return { content: "Notification sent" };
    },
  },
  {
    name: "ui_pin",
    description: "Save a fact to this workspace's memory shelf. Pinned facts are included in every future turn here.",
    input_schema: obj({ text: str("The fact to remember, one or two sentences") }, ["text"]),
    readOnly: true,
    ui: "pin",
    async run(input, ctx) {
      db.run("INSERT INTO pins (workspace_id, text, created_at) VALUES (?,?,?)", [ctx.ws.id, String(input.text).slice(0, 1000), now()]);
      broadcast("pins", { workspaceId: ctx.ws.id });
      return { content: "Pinned" };
    },
  },
  {
    name: "ui_show",
    description:
      "Show the user a visual panel in the conversation. kind=markdown for a formatted note; kind=chart with content as JSON {\"type\":\"bar\"|\"line\",\"labels\":[...],\"series\":[{\"name\":\"...\",\"values\":[...]}]}.",
    input_schema: obj(
      { kind: { type: "string", enum: ["markdown", "chart"] }, title: str("Panel title"), content: str("Markdown text or chart JSON") },
      ["kind", "title", "content"],
    ),
    readOnly: true,
    ui: "show",
    async run() {
      return { content: "Shown to the user" };
    },
  },
  {
    name: "ui_widget",
    description:
      "Build a small interactive tool (calculator, form, mini app) as one self-contained HTML document. It runs in a sandbox with scripts but no network.",
    input_schema: obj({ title: str("Widget title"), html: str("Complete HTML document") }, ["title", "html"]),
    readOnly: true,
    ui: "widget",
    async run() {
      return { content: "Widget rendered for the user" };
    },
  },
];

export function enabledTools(): ToolDef[] {
  const flags = config().ui_tools;
  const mcp: ToolDef[] = mcpTools().map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
    readOnly: t.readOnly,
    run: (input) => callMcp(t.name, input),
  }));
  return [...TOOLS.filter((t) => !t.ui || flags[t.ui]), ...mcp];
}
/** The tools Claude is offered: everything switched on, narrowed by the workspace's profile. */
export function toolDefs(profile?: Profile, ws?: WorkspaceRow) {
  return enabledTools()
    .filter((t) => !profile || allowedBy(profile, t.name, ws))
    .map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
}

export function allowedBy(profile: Profile, name: string, ws?: WorkspaceRow) {
  if (ws) {
    // a helper gets the tools its agent definition lists, and never the interface tools that belong to its parent
    let own: string[] = [];
    try {
      own = JSON.parse(ws.tools || "[]");
    } catch {}
    if (own.length && !own.some((t) => (t.endsWith("*") ? name.startsWith(t.slice(0, -1)) : t === name))) return false;
    if (ws.parent_id && /^(ui_set_title|ui_set_planet|ui_notify)$/.test(name)) return false;
    if (name === "delegate") return canDelegate(ws);
  }
  if (name === "plan") return profile.plan;
  if (PREVIEW_TOOLS.has(name)) return profile.preview;
  return profileAllows(profile, name);
}
const PREVIEW_TOOLS = new Set(["preview_open", "screenshot"]);
export function findTool(name: string) {
  return enabledTools().find((t) => t.name === name);
}
export function isReadOnly(name: string, input: any) {
  const t = findTool(name);
  if (!t) return false;
  return typeof t.readOnly === "function" ? t.readOnly(input) : t.readOnly;
}
export function isUiTool(name: string) {
  return name.startsWith("ui_") || name === "preview_open";
}

/** The text a rule pattern is matched against, e.g. "rm -rf build", "write /home/me/x.ts". */
export function subjectOf(name: string, input: any, cwd: string): string {
  switch (name) {
    case "bash":
      return String(input?.command ?? "");
    case "write_file":
    case "edit_file":
      return `write ${resolvePath(cwd, input?.path ?? "")}`;
    case "read_file":
    case "list_dir":
      return `read ${resolvePath(cwd, input?.path ?? ".")}`;
    case "fetch_url":
      return `fetch ${input?.url ?? ""}`;
    case "screenshot":
      return /^https?:\/\//.test(String(input?.target ?? "")) ? `fetch ${input.target}` : `screenshot ${input?.target ?? ""}`;
    default:
      if (name.startsWith("mcp__")) return mcpSubject(name, input);
      return `${name} ${JSON.stringify(input ?? {})}`;
  }
}
