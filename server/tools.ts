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
}
export interface ToolResult {
  content: string;
  isError?: boolean;
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
    if (SAFE_GIT.test(s) || VERSION_CHECK.test(s)) return true;
    if (first === "find") return !/\s-(delete|exec|execdir|ok|fprint)/.test(s);
    return SAFE_CMDS.has(first);
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

export function enabledTools() {
  const flags = config().ui_tools;
  return TOOLS.filter((t) => !t.ui || flags[t.ui]);
}
export function toolDefs() {
  return enabledTools().map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
}
export function findTool(name: string) {
  return enabledTools().find((t) => t.name === name);
}
export function isReadOnly(name: string, input: any) {
  const t = findTool(name);
  if (!t) return false;
  return typeof t.readOnly === "function" ? t.readOnly(input) : t.readOnly;
}
export function isUiTool(name: string) {
  return name.startsWith("ui_");
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
    default:
      return `${name} ${JSON.stringify(input ?? {})}`;
  }
}
