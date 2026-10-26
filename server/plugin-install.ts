// Getting plugins in and out: from a git repository or a folder, a new one from
// a template, and removing one. They all live in ~/.orbit/plugins/<id>.

import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MANIFEST, parseManifest, pluginsDir } from "./plugins";
// both SDKs ship inside Orbit as text and are copied into new plugins
import TS_SDK_TEXT from "../sdk/typescript/orbit-plugin.ts" with { type: "text" };
import PY_SDK from "../sdk/python/orbit_plugin.py" with { type: "text" };
const TS_SDK = TS_SDK_TEXT as unknown as string;

const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

async function run(cmd: string[], cwd?: string) {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if ((await p.exited) !== 0) throw new Error((err || out).trim().split("\n").slice(-3).join(" ") || `${cmd[0]} failed`);
  return out;
}

/** A git URL (https or ssh, optionally #branch) or a folder on this computer. Returns the plugin's id. */
export async function installPlugin(source: string): Promise<string> {
  const src = source.trim();
  if (!src) throw new Error("Paste a git address or a folder.");
  mkdirSync(pluginsDir(), { recursive: true });
  const staging = join(tmpdir(), `orbit-plugin-${crypto.randomUUID().slice(0, 8)}`);
  try {
    const local = resolve(src.replace(/^~(?=$|[\\/])/, process.env.HOME ?? ""));
    if (existsSync(local) && statSync(local).isDirectory()) {
      if (!existsSync(join(local, MANIFEST))) throw new Error(`No ${MANIFEST} in that folder.`);
      cpSync(local, staging, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(p.slice(local.length)) });
    } else if (/^(https:\/\/|git@|ssh:\/\/)/.test(src)) {
      const [url, branch] = src.split("#");
      await run(["git", "clone", "--depth", "1", ...(branch ? ["--branch", branch] : []), url, staging]);
      rmSync(join(staging, ".git"), { recursive: true, force: true });
    } else throw new Error("That is neither a folder here nor a git address (https://... or git@...).");
    const file = join(staging, MANIFEST);
    if (!existsSync(file)) throw new Error(`No ${MANIFEST} at the top of the repository.`);
    const m = parseManifest(JSON.parse(readFileSync(file, "utf8")));
    const dest = join(pluginsDir(), m.id);
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
    renameSync(staging, dest);
    // JavaScript dependencies install with Orbit's own runtime; nothing else needed
    if (existsSync(join(dest, "package.json"))) {
      const pkg = JSON.parse(readFileSync(join(dest, "package.json"), "utf8"));
      if (Object.keys(pkg.dependencies ?? {}).length) {
        const p = Bun.spawn([process.execPath, "install", "--production"], { cwd: dest, env: { ...process.env, BUN_BE_BUN: "1" }, stdout: "ignore", stderr: "pipe" });
        await p.exited;
      }
    }
    return m.id;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function removePlugin(id: string) {
  if (!ID_RE.test(id)) throw new Error("No such plugin");
  const dir = join(pluginsDir(), id);
  if (!existsSync(dir)) throw new Error("Only plugins in ~/.orbit/plugins can be removed here.");
  rmSync(dir, { recursive: true, force: true });
}

// ---------- new plugins from a template ----------
const PANEL = (name: string) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${name}</title>
</head>
<body>
  <h3>${name}</h3>
  <p>This panel is a plain HTML page in your plugin's folder. <code>window.orbit</code> talks to your plugin and to Orbit.</p>
  <button class="primary" id="hi">Ask the plugin</button>
  <pre id="out"></pre>
  <script>
    document.getElementById("hi").onclick = async () => {
      const r = await orbit.call("/hello");
      document.getElementById("out").textContent = JSON.stringify(r, null, 2);
    };
    orbit.on("turn_end", (e) => console.log("a turn ended in", e.workspaceId));
  </script>
</body>
</html>
`;

const README = (name: string, run: string, lang: string) => `# ${name}

An Orbit plugin. It lives in this folder; Orbit starts it with \`${run}\` and
talks to it over stdin and stdout (see Orbit's docs/PLUGINS.md).

- \`orbit-plugin.json\`: name, permissions, settings, panels, hooks.
- \`${lang === "python" ? "main.py" : "index.ts"}\`: tools, commands and routes.
- \`panel/index.html\`: the panel shown beside the conversation.
- \`skills/\` and \`knowledge/\`: Markdown files Claude gets while the plugin is on.

Change a file and Orbit restarts the plugin (\`"dev": true\` in the manifest).
Logs are in Settings, Plugins.
`;

const TS_MAIN = `import { plugin } from "./orbit-plugin";

// A tool Claude can call. The input schema can be short: { name: "string", count: "number?" }.
plugin.tool("greet", "Say hello to someone by name", { name: "string" }, async ({ name }) => {
  const count = ((await plugin.storage.get<number>("greeted")) ?? 0) + 1;
  await plugin.storage.set("greeted", count);
  return \`Hello, \${name}! (greeting number \${count})\`;
}, { readOnly: true });

// A slash command: type /hello in the composer.
plugin.command("hello", "Ask Claude to greet you", ({ args }) => ({
  reply: "Asking Claude to say hello.",
  send: \`Use the greet tool to greet \${args || "me"}.\`,
}));

// A route for the panel: orbit.call("/hello") in panel/index.html.
plugin.route("GET", "/hello", async () => ({ hello: "from the plugin", greeted: await plugin.storage.get("greeted") }));

plugin.ready(({ settings }) => plugin.log("ready with settings", settings));

plugin.start();
`;

const PY_MAIN = `from orbit_plugin import plugin


@plugin.tool("Say hello to someone by name", read_only=True, name="string")
def greet(name, ctx):
    count = (plugin.get("greeted") or 0) + 1
    plugin.set("greeted", count)
    return f"Hello, {name}! (greeting number {count})"


@plugin.command("Ask Claude to greet you")
def hello(args, workspace):
    return {"reply": "Asking Claude to say hello.", "send": f"Use the greet tool to greet {args or 'me'}."}


@plugin.route("GET", "/hello")
def hello_route(req):
    return {"hello": "from the plugin", "greeted": plugin.get("greeted")}


@plugin.ready
def ready(info):
    plugin.log("ready with settings", info["settings"])


plugin.start()
`;

const SKILL = (id: string, name: string) => `---
name: ${id}-guide
description: Use when the user asks about ${name} or wants to use its tools.
---

# Using ${name}

Explain here how and when Claude should use this plugin's tools.
`;

export function scaffoldPlugin(o: { id: string; name: string; language: string; description: string }): string {
  const id = o.id.trim().toLowerCase();
  if (!ID_RE.test(id)) throw new Error("The id is lower case letters, digits and dashes, like my-plugin.");
  const dir = join(pluginsDir(), id);
  if (existsSync(dir)) throw new Error(`A plugin called ${id} already exists.`);
  const name = o.name.trim() || id;
  const py = o.language === "python";
  const runCmd = py ? "python3 main.py" : "bun index.ts";
  mkdirSync(join(dir, "panel"), { recursive: true });
  mkdirSync(join(dir, "skills", `${id}-guide`), { recursive: true });
  mkdirSync(join(dir, "knowledge"), { recursive: true });
  const manifest = {
    $schema: "https://raw.githubusercontent.com/Elchi-dev/Orbit/main/sdk/orbit-plugin.schema.json",
    id,
    name,
    version: "0.1.0",
    description: o.description.trim() || `${name}, an Orbit plugin.`,
    run: runCmd,
    dev: true,
    permissions: ["workspaces"],
    contributes: {
      panels: [{ id: "main", title: name, icon: "puzzle", entry: "panel/index.html" }],
      settings: [{ key: "greeting", label: "Greeting", type: "string", default: "Hello" }],
      hooks: [],
    },
  };
  writeFileSync(join(dir, MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
  if (py) {
    writeFileSync(join(dir, "main.py"), PY_MAIN);
    writeFileSync(join(dir, "orbit_plugin.py"), PY_SDK);
  } else {
    writeFileSync(join(dir, "index.ts"), TS_MAIN);
    writeFileSync(join(dir, "orbit-plugin.ts"), TS_SDK);
  }
  writeFileSync(join(dir, "panel", "index.html"), PANEL(name));
  writeFileSync(join(dir, "skills", `${id}-guide`, "SKILL.md"), SKILL(id, name));
  writeFileSync(join(dir, "README.md"), README(name, runCmd, py ? "python" : "typescript"));
  return dir;
}
