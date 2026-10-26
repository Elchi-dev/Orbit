# Plugins

<p align="center"><img src="images/ori/helpers.svg" width="140" alt="Ori with little stars on its ring"></p>

If Orbit doesn't do something you want, a plugin can. A plugin is a folder
with an `orbit-plugin.json` and a program in any language. It can:

- give Claude **tools** (look something up, call your company's API, control a device),
- add **slash commands** you type in the composer,
- add **panels** beside the conversation (any HTML page),
- serve **HTTP routes** for those panels or for anything local,
- **check every action before it runs** and allow, block or ask,
- **follow everything** that happens (turns, messages, approvals),
- **use Orbit itself**: create workspaces, have Claude do a task, call a model,
  answer approvals, keep its own data,
- bring **skills and knowledge** Claude gets while the plugin is on,
- have **settings**, including secrets kept encrypted.

There is no sandbox: a plugin runs with your user's rights, like any program
you install. What Orbit never does is give a plugin the API key. Model calls
go through Orbit, count toward your budget and show in your costs.

## The quickest way

Settings, Plugins, **New plugin**. Describe what it should do and press
**Let Claude build it**: Orbit makes the plugin from a template and opens a
workspace in its folder where Claude writes it (with a skill that knows this
page). Or take **Just the template** and write it yourself: it's a working
plugin with a tool, a command, a route, a panel and a setting.

The template sets `"dev": true`, so Orbit restarts the plugin whenever a
file in its folder changes. Logs are in Settings, Plugins, under the plugin.

## A whole plugin

`~/.orbit/plugins/weather/orbit-plugin.json`:

```json
{
  "id": "weather",
  "name": "Weather",
  "version": "1.0.0",
  "description": "Today's weather for any city.",
  "run": "bun index.ts",
  "permissions": [],
  "contributes": {
    "settings": [{ "key": "units", "label": "Units", "type": "select", "options": ["metric", "imperial"], "default": "metric" }]
  }
}
```

`index.ts`:

```ts
import { plugin } from "./orbit-plugin";

plugin.tool("weather", "Today's weather for a city", { city: "string" }, async ({ city }) => {
  const units = plugin.settings.units === "imperial" ? "&temperature_unit=fahrenheit" : "";
  const geo = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(city)}`)).json();
  const { latitude, longitude, name } = geo.results?.[0] ?? {};
  if (!name) return { content: `No place called ${city}`, is_error: true };
  const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m${units}`)).json();
  return `${name}: ${w.current.temperature_2m}${w.current_units.temperature_2m}`;
}, { readOnly: true });

plugin.start();
```

Switch it on in Settings, Plugins, and ask Claude about the weather. The same
in Python, `main.py` with `"run": "python3 main.py"`:

```python
from orbit_plugin import plugin
import json, urllib.request, urllib.parse

@plugin.tool("Today's weather for a city", read_only=True, city="string")
def weather(city, ctx):
    q = urllib.parse.quote(city)
    geo = json.load(urllib.request.urlopen(f"https://geocoding-api.open-meteo.com/v1/search?count=1&name={q}"))
    if not geo.get("results"):
        return {"content": f"No place called {city}", "is_error": True}
    r = geo["results"][0]
    w = json.load(urllib.request.urlopen(f"https://api.open-meteo.com/v1/forecast?latitude={r['latitude']}&longitude={r['longitude']}&current=temperature_2m"))
    return f"{r['name']}: {w['current']['temperature_2m']}{w['current_units']['temperature_2m']}"

plugin.start()
```

## Where plugins live

- `~/.orbit/plugins/<id>/`: yours. Install, New plugin and Remove work here.
- More folders: `dirs` under `[plugins]` in `orbit.toml`.
- Each plugin gets a data folder, `~/.orbit/plugin-data/<id>/`, which stays when
  the plugin is updated.

A new or installed plugin is **off** until you switch it on, after seeing what
it may do. **Install** takes a git address (`https://...`, `git@...`, with
`#branch` if needed) or a folder. JavaScript dependencies in `package.json` are
installed with Orbit's own runtime.

## The manifest

`orbit-plugin.json` at the top of the folder. Editors can check it against
[`sdk/orbit-plugin.schema.json`](../sdk/orbit-plugin.schema.json).

| Field | | |
| --- | --- | --- |
| `id` | required | lower case letters, digits and dashes; the folder name in `~/.orbit/plugins` |
| `name` | required | shown in Orbit |
| `version`, `description`, `author`, `homepage` | | shown in Settings, Plugins |
| `run` | | the command that starts it, run in the plugin's folder: `"bun index.ts"`, `"python3 main.py"`, `["./my-binary", "--stdio"]`. Leave it out for a plugin that only brings panels, skills or knowledge |
| `permissions` | | what it may use of Orbit, below |
| `contributes.tools` | | tools declared up front (they can also be registered at start) |
| `contributes.commands` | | slash commands, likewise |
| `contributes.panels` | | `{ "id", "title", "entry": "panel/index.html" }` |
| `contributes.settings` | | `{ "key", "label", "type": "string" \| "secret" \| "number" \| "boolean" \| "select", "default", "options", "help" }` |
| `contributes.hooks` | | any of `before_tool`, `after_tool`, `turn_start`, `turn_end`, `message`, `approval` |
| `dev` | | restart when a file in the folder changes |

`bun` and `node` in `run` work even when neither is installed: Orbit runs them
on its own runtime. Anything else (`python3`, `go run .`, a binary) must be
installed on the computer.

### Permissions

| Permission | Lets the plugin |
| --- | --- |
| `workspaces` | list and read workspaces and conversations, create workspaces |
| `agent` | send messages to Claude and start Claude runs (costs money) |
| `model` | call a model directly (costs money) |
| `events` | receive every event Orbit sends the interface |
| `approvals` | list and answer approvals; needed for `before_tool` and `approval` hooks |
| `api` | call any of Orbit's HTTP API, except the key, the config, remote and plugins |

Tools, commands, routes, panels, settings, storage, logs, toasts and
notifications need no permission.

## Skills, knowledge and panels

- `skills/<name>/SKILL.md` and `knowledge/*.md` in the plugin's folder join
  the library while the plugin is on (see the Library in Settings).
- A panel is an HTML file in the folder. It shows as a tab beside the
  conversation and in the dock. Orbit adds a small script that gives the page
  `window.orbit` and Orbit's colours:

```js
await orbit.call("/hello")              // your plugin's route GET /hello
await orbit.call("/notes", { body: {} }) // POST with a JSON body
await orbit.api("/workspaces")          // Orbit's API
orbit.on("turn_end", (e) => ...)        // live events ("*" for all)
orbit.workspace                         // the workspace the panel is beside
await orbit.send(orbit.workspace, "Summarise the last run")
orbit.toast("Saved", "All three notes", "good")
orbit.openWorkspace(id)
```

A panel runs on Orbit's own origin, so it can do anything the interface can.

## The protocol

Orbit starts the plugin with `run`, in its folder, and talks to it with
[JSON-RPC 2.0](https://www.jsonrpc.org/specification), **one JSON message per
line** on stdin and stdout. Anything the plugin writes to **stderr** goes to
its log. The SDKs do all of this; the protocol is here for other languages.

The environment has `ORBIT_PLUGIN_ID`, `ORBIT_PLUGIN_DIR`, `ORBIT_PLUGIN_DATA`
and `ORBIT_VERSION`. `ANTHROPIC_*` variables are removed.

### Orbit calls the plugin

| Method | Params | Answer |
| --- | --- | --- |
| `initialize` | `{ orbit: { version }, plugin: { id, dir, data }, settings, protocol: 1 }` | `{ tools?: [...], commands?: [...] }` within 15 s |
| `tool.call` | `{ name, input, workspace, cwd, call }` | a string, or `{ content, is_error? }` |
| `command.run` | `{ name, args, workspace }` | a string, or `{ reply?, send?, open? }`: `reply` is shown to the user, `send` goes to Claude in that workspace, `open` opens a panel tab |
| `http.request` | `{ method, path, query, headers, body }` for `/plugins/<id>/api/<path>` | `{ status?, headers?, body }`, or just the body |
| `hook.before_tool` | `{ workspace: { id, title, cwd }, tool, input, subject }` | `{ decision: "allow" \| "deny" \| "ask", reason? }` or `null`, within 5 s |
| `hook.after_tool`, `hook.turn_start`, `hook.turn_end`, `hook.message`, `hook.approval` | the event | notification, no answer |
| `event` | any Orbit event, after `orbit.events.subscribe` | notification |
| `settings` | the new settings | notification |
| `shutdown` | | notification; exit soon after (Orbit stops it after 0.8 s) |

Tool input schemas are JSON schemas, or short: `{ "city": "string", "days":
"number?", "tags": "string[]" }` (a `?` makes it optional). A tool marked
`read_only` runs without asking, like reading a file; others pass the gate
like any action. Claude sees a plugin tool as `<plugin_id>__<tool>`, with
dashes in the id turned into underscores.

`before_tool`: any `deny` blocks the action, `ask` sends it to you, an
`allow` counts like one of your rules. Plugins are asked in turn; no answer
within 5 seconds counts as no opinion.

### The plugin calls Orbit

Requests (with an `id`, answered) or notifications (no `id`):

| Method | Permission | Params | Answer |
| --- | --- | --- | --- |
| `orbit.log` | | `{ message }` | |
| `orbit.ui.toast` | | `{ title, body?, tone? }` (`info`, `good`, `warn`, `bad`) | |
| `orbit.ui.notify` | | `{ title, body? }`: a system notification | |
| `orbit.storage.get` / `.set` / `.delete` / `.all` | | `{ key, value? }` | the value |
| `orbit.settings.get` | | | the settings |
| `orbit.tools.register` | | `{ tools: [...] }`, replaces the ones registered at start | |
| `orbit.commands.register` | | `{ commands: [...] }` | |
| `orbit.events.subscribe` | `events` | `{ types: ["turn_end", ...] }` or `["*"]` | |
| `orbit.workspaces.list` / `.get` / `.create` | `workspaces` | `{ id }`, `{ title?, cwd?, profile?, mode? }` | the workspace |
| `orbit.workspaces.send` | `agent` | `{ workspace, text }` | |
| `orbit.workspaces.stop` | `agent` | `{ id }` | |
| `orbit.agent.run` | `agent` | `{ prompt, workspace?, cwd?, profile?, title?, wait?, timeout_s? }` | `{ workspace, reason, text, cost }` |
| `orbit.model.complete` | `model` | `{ prompt?, system?, messages?, model?, max_tokens? }` | `{ text, model, cost }` |
| `orbit.approvals.list` / `.answer` | `approvals` | `{ id, decision: "allow" \| "always" \| "deny" }` | |
| `orbit.api` | `api` | `{ method, path, body? }` | `{ status, body }` |

`orbit.agent.run` gives Claude a task with all of Orbit's tools, in a new
workspace (or the one you name), behind the same gate: what the workspace's
mode doesn't allow, it asks you about. With `wait: false` it answers at once
with the workspace id.

Errors come back as JSON-RPC errors; a missing permission is code `-32001`.

### A plugin in any other language

Read lines from stdin, write lines to stdout. A whole plugin in Go:

```go
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

type msg struct {
	ID     any             `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
}

func reply(id any, result any) {
	b, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
	fmt.Println(string(b))
}

func main() {
	in := bufio.NewScanner(os.Stdin)
	in.Buffer(make([]byte, 1<<20), 1<<26)
	for in.Scan() {
		var m msg
		if json.Unmarshal(in.Bytes(), &m) != nil || m.Method == "" {
			continue
		}
		switch m.Method {
		case "initialize":
			reply(m.ID, map[string]any{"tools": []any{map[string]any{
				"name": "shout", "description": "Upper-cases text", "read_only": true,
				"input_schema": map[string]any{"text": "string"},
			}}})
		case "tool.call":
			var p struct{ Input struct{ Text string } }
			json.Unmarshal(m.Params, &p)
			reply(m.ID, strings.ToUpper(p.Input.Text))
		case "shutdown":
			os.Exit(0)
		default:
			if m.ID != nil {
				reply(m.ID, nil)
			}
		}
	}
}
```

With `"run": "go run ."` (or a built binary). Answer every request that has an
`id`, even ones you don't handle, so nothing waits for a timeout.

## The SDKs

One file each, no dependencies, copied into every new plugin:

- TypeScript and JavaScript, [`sdk/typescript/orbit-plugin.ts`](../sdk/typescript/orbit-plugin.ts):
  `plugin.tool`, `.command`, `.route`, `.beforeTool`, `.afterTool`,
  `.onTurnStart`, `.onTurnEnd`, `.onMessage`, `.onApproval`, `.on(event)`,
  `.ready`, `.settingsChanged`, `.stopping`; and `.agent`, `.model`,
  `.workspaces`, `.approvals`, `.storage`, `.api`, `.toast`, `.notify`, `.log`.
  `console.log` goes to the plugin's log.
- Python, [`sdk/python/orbit_plugin.py`](../sdk/python/orbit_plugin.py): the
  same as decorators (`@plugin.tool`, `@plugin.command`, `@plugin.route`,
  `@plugin.before_tool`, `@plugin.on("turn_end")`, ...) and calls
  (`plugin.agent`, `plugin.model`, `plugin.get` and `plugin.set` for storage,
  ...). Handlers may be plain or async. `print` goes to the plugin's log.

## What happens when things go wrong

- A plugin that doesn't answer `initialize` within 15 s, or exits, is
  restarted after 1, 2, 4... seconds. Five crashes in five minutes and it stays
  off until you restart it; the reason shows in Settings, Plugins.
- A tool call that doesn't answer within its `timeout_s` (120 s by default)
  fails like any tool, and Claude is told.
- A broken manifest shows as "Can't read it" with the reason.
