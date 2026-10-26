---
name: orbit-plugins
description: Use when building, changing or debugging an Orbit plugin (a folder with orbit-plugin.json), or when the user wants Orbit to do something it can't do yet.
---

# Writing Orbit plugins

An Orbit plugin is a folder with `orbit-plugin.json` and a program that Orbit
starts and talks to with JSON-RPC 2.0, one JSON message per line on stdin and
stdout. stderr goes to the plugin's log. Plugins live in
`~/.orbit/plugins/<id>/`. Orbit restarts a plugin whose manifest has
`"dev": true` whenever a file changes, so you can edit and test in a loop.

## Before you write anything

1. Read the folder: `orbit-plugin.json`, the main file (`index.ts` or
   `main.py`), and the SDK file next to it (`orbit-plugin.ts` or
   `orbit_plugin.py`). The SDK file is the reference for every call; don't
   edit it.
2. Decide what the plugin adds: tools for Claude, slash commands for the user,
   a panel, routes, hooks, settings. Prefer the smallest set that does the job.
3. Decide the permissions it needs (below) and nothing more.

## The manifest

```json
{
  "id": "linear",
  "name": "Linear",
  "version": "0.1.0",
  "description": "Your Linear issues in Orbit.",
  "run": "bun index.ts",
  "dev": true,
  "permissions": ["workspaces"],
  "contributes": {
    "panels": [{ "id": "main", "title": "Linear", "entry": "panel/index.html" }],
    "settings": [{ "key": "token", "label": "API key", "type": "secret", "help": "Linear, Settings, API" }],
    "hooks": []
  }
}
```

- `run` runs in the folder. `bun` and `node` work even when not installed.
  Python needs `python3` on the computer; anything else must be installed too.
- Permissions: `workspaces` (read, create), `agent` (send to Claude, run
  Claude), `model` (call a model), `events` (every event), `approvals` (list,
  answer, and needed for `before_tool` and `approval` hooks), `api` (Orbit's
  HTTP API). Tools, commands, routes, panels, settings and storage need none.
- Settings types: `string`, `secret` (stored encrypted), `number`, `boolean`,
  `select` with `options`. Read them as `plugin.settings.key`.
- Never put a token, key or password in the manifest or the code: make it a
  `secret` setting.

## TypeScript

```ts
import { plugin } from "./orbit-plugin";

plugin.tool("issues", "My open Linear issues", { team: "string?" }, async ({ team }, ctx) => {
  const key = plugin.settings.token as string;
  if (!key) return { content: "Add a Linear API key in Settings, Plugins.", is_error: true };
  const r = await fetch("https://api.linear.app/graphql", { method: "POST", headers: { authorization: key, "content-type": "application/json" }, body: JSON.stringify({ query: "{ viewer { assignedIssues(first: 20) { nodes { identifier title state { name } } } } }" }) });
  if (!r.ok) return { content: `Linear said ${r.status}`, is_error: true };
  return JSON.stringify((await r.json()).data.viewer.assignedIssues.nodes);
}, { readOnly: true });

plugin.command("standup", "Write my standup from today's work", ({ args, workspace }) => ({
  reply: "Asking Claude for your standup.",
  send: `Write my standup from today's commits and my Linear issues. ${args}`,
}));

plugin.route("GET", "/issues", async () => ({ issues: await plugin.storage.get("cache") }));

plugin.start();
```

Also: `plugin.beforeTool(({ tool, input, subject, workspace }) => ({ decision: "deny", reason }) or undefined)`,
`plugin.afterTool`, `plugin.onTurnEnd`, `plugin.on("approval_request", e => ...)`,
`plugin.ready(({ settings }) => ...)`, `plugin.settingsChanged`, `plugin.stopping`,
`await plugin.agent(prompt, { workspace?, cwd?, wait? })`,
`await plugin.model({ prompt, system?, model? })`, `plugin.workspaces.list/get/create/send`,
`plugin.approvals.list/answer`, `plugin.storage.get/set/delete/all`, `plugin.toast`,
`plugin.notify`, `plugin.log`. `console.log` goes to the log, never stdout.

## Python

```python
from orbit_plugin import plugin

@plugin.tool("My open Linear issues", read_only=True, team="string?")
def issues(ctx, team=None):
    ...
    return "text for Claude"          # or {"content": ..., "is_error": True}

@plugin.command("Write my standup")
def standup(args, workspace):
    return {"reply": "Asking Claude.", "send": "Write my standup ..."}

@plugin.route("GET", "/issues")
def issues_route(req):
    return {"issues": plugin.get("cache")}

plugin.start()
```

Tool functions get the inputs as keyword arguments plus `ctx` (`ctx.workspace`,
`ctx.cwd`). Handlers may be async; inside an async handler use
`await plugin.acall(...)` or `await plugin.aagent(...)`. Only the standard
library is available unless the user installs packages; prefer `urllib`.

## Tools

- The input schema can be short: `{ "city": "string", "days": "number?",
  "tags": "string[]" }`. Claude sees the tool as `<plugin_id>__<tool>`.
- Write the description for Claude: what it does, when to use it, what it
  returns. One or two sentences.
- `readOnly: true` only when it changes nothing anywhere: it then runs without
  asking. Anything that writes, sends or deletes must not be read-only, so the
  user's approval mode applies.
- Return short, useful text or JSON. Errors as `{ content, is_error: true }`
  with what to do about it.

## Panels

A panel is an HTML file in the folder, shown as a tab beside the conversation.
Orbit adds `window.orbit` and its colours to the page:
`await orbit.call("/issues")` (your route), `orbit.api("/workspaces")`,
`orbit.on("turn_end", fn)`, `orbit.workspace`, `orbit.send(ws, text)`,
`orbit.toast(title, body)`. Keep it one self-contained file unless it grows.

## Skills and knowledge

`skills/<name>/SKILL.md` and `knowledge/*.md` in the plugin folder join the
library while the plugin is on. Add a short skill that tells Claude when and
how to use the plugin's tools.

## Test it

1. Validate the manifest is JSON and the id matches the folder.
2. Talk to the program directly before Orbit does:
   ```sh
   printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"settings":{}}}' \
     '{"jsonrpc":"2.0","id":2,"method":"tool.call","params":{"name":"issues","input":{}}}' | bun index.ts
   ```
   Every request with an `id` must get exactly one answer line.
3. Tell the user to switch it on in Settings, Plugins (new plugins start off),
   and where to see its log. Then try the tool or command for real.

## Before you call it done

- [ ] `orbit-plugin.json` is valid, lists only the permissions used, and has no secrets.
- [ ] Every tool has a clear description and the right `readOnly`.
- [ ] Nothing writes to stdout except the SDK; logs go through `plugin.log` or `console.log`.
- [ ] Errors come back as `is_error` with a next step, not a crash.
- [ ] Tested by piping JSON-RPC lines into it, and the user knows how to switch it on.
- [ ] `README.md` in the folder says what it does and which settings it needs.
