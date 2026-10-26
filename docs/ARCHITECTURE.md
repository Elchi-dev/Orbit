# Architecture

<p align="center"><img src="images/ori/working.svg" width="120" alt="Ori typing on a laptop"></p>

Orbit is one process. It serves the interface, holds the API key, runs the
agent loop and every tool, and stores everything in one SQLite file. The
browser only ever talks to it.

```
   browser (localhost:7777)                     orbit (one Bun process)
  +-------------------------+   WebSocket   +------------------------------+     HTTPS     +---------------+
  | React                   | <-----------> | agent loop    server/agent   | ------------> | Anthropic API |
  | Three.js (the Orrery)   |     HTTP      | gate + judge  server/gate    |               | main, judge,  |
  | Motion, Lucide          | <-----------> | tools, shell  server/tools   |               | scribe models |
  +-------------------------+               | HTTP + WS     server/index   |               +---------------+
                                            +---------------+--------------+
                                                            |
                                     +----------------------+----------------------+
                                     |                                             |
                              ~/.orbit/orbit.db                           your machine
                              workspaces, messages,                      a shell per workspace,
                              usage, rules, snapshots                    your files
```

## Server

| File | What |
| --- | --- |
| `server/index.ts` | Command line, HTTP API, WebSocket, the embedded interface, the session cookie and Host and Origin checks |
| `server/agent.ts` | The agent loop, the system prompt, rebuilding the message list, titles and summaries |
| `server/anthropic.ts` | A small streaming client for the Messages API (fetch and server-sent events), and the mock model |
| `server/gate.ts` | Rules, modes, the judge and waiting approvals |
| `server/tools.ts` | Tool definitions and what they do; read-only detection |
| `server/shell.ts` | One persistent shell per workspace |
| `server/db.ts` | The schema and small query helpers |
| `server/config.ts` | `orbit.toml`: defaults, reading, writing, prices |
| `server/secrets.ts` | The API key, encrypted with a key that never leaves `~/.orbit` |
| `server/usage.ts` | Token counts to cost |
| `server/hub.ts` | Sends events to every open tab |
| `server/catalog.ts` | The 100 programs Orbit knows: how to find them, their read-only and guarded subcommands, variables that keep them quiet, how editors open a file at a line |
| `server/integrations.ts` | What is installed, versions, opening files in your editor |
| `server/context.ts` | `AGENTS.md`, `CLAUDE.md` and editor rules from the workspace folder; skills; saved prompts as slash commands |
| `server/mcp.ts` | The MCP client: stdio and streamable HTTP servers, their tools as Claude's tools |
| `server/git.ts` | The git panel: status, diffs, stage, commit, branches, push and pull, commit messages from the scribe |
| `server/review.ts`, `server/diff.ts` | Reviewing Claude's changes per file or per hunk, the review baseline, and the line diff behind it |
| `server/missions.ts` | Missions: schedules, webhooks and unattended runs |
| `server/profiles.ts` | The built-in profiles and the ones from `orbit.toml` |
| `server/preview.ts` | The preview server on its own port: workspace files under a random token, reload events, dev server detection |
| `server/screenshot.ts` | Headless screenshots through an installed Chrome-family browser, with console messages |
| `server/origin.ts` | Which origin may call the API: only Orbit's own |
| `server/helpers.ts` | Helpers (subagents): agent definitions, the `delegate` tool, child workspaces, worktrees, reports, merge and discard |
| `server/annotate.ts` | The comment script every previewed page gets, and the proxy that puts it into dev server pages |
| `server/docs.ts` | Docs shared by Claude and you: versions, comment threads, what changed since Claude's last read |
| `server/board.ts` | The whiteboard: items, arrows, batched changes, placement, uploaded images |
| `server/library.ts`, `server/library-data.ts` | Skills and knowledge: built-ins bundled from `server/library` by `scripts/gen-library.ts`, yours and a project's, switches, templates |
| `server/libgen.ts` | Ori writing a skill or knowledge file: a model limited to web search and reading public pages |
| `server/kindex.ts` | Knowledge folders: passages indexed per file, BM25 search with the knowledge files |
| `server/memory.ts` | Memories suggested after runs and kept by you, the memory part of the system prompt |
| `server/pagecheck.ts` | The speed and accessibility check, over the DevTools protocol |
| `server/replay.ts` | A workspace and its helpers as one timeline |
| `server/remote.ts`, `server/e2e.ts`, `server/fcm.ts` | Phones through the relay: pairing, encrypted sessions, the API and events over them, sealed alerts through the relay or Firebase. The protocol is [REMOTE.md](REMOTE.md) |
| `server/plugins.ts`, `server/plugin-install.ts`, `server/plugin-panel.ts` | Plugins: manifests, processes and JSON-RPC, what they may call, hooks, panels, installing and templates. See [PLUGINS.md](PLUGINS.md) |
| `server/check.ts` | `orbit check`: real work against the API in a throwaway Orbit |

Beside the server: `relay/` is the relay in Go, `android/` the Android app in
Kotlin, `sdk/` the plugin SDKs that ship inside Orbit.

### One turn

1. A message arrives over the WebSocket and is stored.
2. The message list is rebuilt from SQLite: messages of the same role are
   merged, and a tool call that never got a result (a run stopped halfway)
   gets one that says so, because the API refuses a call without a result.
   One cache breakpoint goes on the newest block; the system prompt carries
   the other.
3. The reply streams in. Text, thinking and tool input are forwarded to the
   browser as they arrive, with a running tokens-per-second estimate.
4. The finished reply is stored as the API returned it. Thinking blocks are
   sent back unchanged in later requests, as the API requires.
5. If the reply asks for tools, every call is registered, all of them go
   through the gate at the same time, and the allowed ones run: read-only
   tools and helpers side by side (four at a time by default), everything
   else in order. Shell output is forwarded live.
6. The results are stored as the next user message and the loop continues
   until the reply ends without tools, the budget is used up, or you stop it.

After the first finished turn the scribe model names the workspace.

With web search on, the API's own search tool is added to the request. Its
blocks and the citations on the answer are stored and sent back as they came;
a turn the API pauses during a long search is sent back to let it finish. With
search off, earlier searches go back as plain text.

A message you send while Claude works waits in the workspace's inbox and
joins the run at its next step, marked as sent mid-run.

A mission runs the same loop with `unattended` set: the gate turns Manual into
Rules, a rule that says "ask" into no, and an unsure judge into no, so nothing
ever waits for an answer.

### Helpers

A helper is a workspace with a parent. `delegate` creates one from an agent
definition (built in, or a Markdown file in `.claude/agents` or
`.orbit/agents`), runs the same loop in it and returns its last reply as a
report, with the files it changed and its cost. It gets the parent's approval
mode, never more; its tools can be narrowed by the definition, its writes by
the folders it was given (the gate refuses the rest), and with `isolate` it
works in a git worktree on its own branch under `.orbit/worktrees`, which is
added to `.git/info/exclude`. Helpers can't start helpers. Stopping the parent
stops them; deleting it removes them and their unmerged worktrees.

### What Claude is told

The system prompt is built for every request, so changes apply at once: the
environment, how to work, your profile and standing instructions, the
workspace's instructions, the project's own instruction files, the installed
programs Orbit found with a line on driving each one quietly, the skills by
name and description, the memory shelf and the summary of folded history.

### The shell

Each workspace gets one long-lived `bash` (PowerShell on Windows), so `cd`,
variables and an activated virtualenv carry over between commands. A command
is written to its stdin wrapped like this:

```
{
<command>
} < /dev/null 2>&1
printf '\n__ORBIT_DONE_<token>_%s__\n' "$?"
```

Output is read until the marker with the random token appears; the number in
it is the exit code. Standard input comes from `/dev/null`, so a command that
waits for input fails instead of hanging. A timeout or the kill switch kills
the shell's process tree; the next command starts a fresh shell.

### Data

| Table | What |
| --- | --- |
| `workspaces` | title, folder, model, mode, planet style, instructions, judge notes, summary, incognito |
| `messages` | content blocks as the API returned them, JSON |
| `tool_calls` | input, the matched text, status, output, who decided and why, durations |
| `usage` | tokens per call, by kind (main, judge, scribe), time to first token, speed, cost |
| `rules` | pattern, verdict, kind, scope (one workspace or all) |
| `snapshots` | file contents before a change, for undo and review (`reviewed` once kept) |
| `missions` | prompt, schedule, approval mode, webhook token, next and last run, the last report |
| `pins` | the memory shelf |
| `secrets` | the API key, AES-256-GCM |
| `search` | full-text index over messages (FTS5); incognito workspaces are left out |
| `docs`, `doc_comments` | shared Markdown docs, their versions and the text as Claude last read it; comment threads |
| `boards` | one whiteboard per workspace: items and arrows as JSON, a version, the version Claude last saw |

Helpers live in `workspaces` too, with `parent_id`, `agent`, `scope`, `tools`,
`branch` and `report` set.

### Events

The server pushes one stream of events to every open tab: `message`,
`block_start`, `delta`, `block_stop`, `speed`, `usage`, `tool_call`,
`tool_output`, `approval_request`, `approval_resolved`, `workspace`,
`turn_start`, `turn_end`, `cleared`, `compacted`, `missions`, `mcp`, `file_changed`,
`queued`, `helper`, `doc`, `doc_deleted`, `board`, `preview`, `plan`, `notify`
and `error`. The tab sends
`send`, `approval`, `stop` and `kill`.

## Interface

`web/src`, React with TypeScript.

| Where | What |
| --- | --- |
| `lib/store.ts` | All state, one store; applies server events |
| `components/orrery/` | The home screen. `OrreryScene` is the 3D sky (planet surfaces, the sun, nebula and dust are shaders); `FlatOrrery` is the same layout without WebGL |
| `components/cockpit/` | A workspace: the conversation, tool rows, helper lanes, composer with slash commands and dictation, telemetry, the dock and its panels (shell, review, git, missions, memory, workspace), and the side panel with Preview, Docs and Board |
| `components/Integrations.tsx`, `components/McpPage.tsx` | Settings pages for the editor and the 100 programs, and for MCP servers |
| `lib/slash.ts`, `lib/share.tsx` | Slash commands; saving a workspace as one HTML page |
| `components/Approval.tsx` | The approval eclipse |
| `components/Settings.tsx` | Settings; writes `orbit.toml` through the server |
| `styles.css`, `app.css` | Tokens and the interaction rules every control follows |

Planet labels are ordinary buttons laid over the canvas and moved every frame
to sit under their planet, so they can be clicked, focused with Tab and read
by a screen reader.

## The preview

The preview runs a second, read-only server on loopback (the next port, 7778
by default). Workspace files are served under a random token per workspace,
HTML gets a few lines that reload the page when a file in the folder changes,
and nothing outside the folder is served. Because it is another origin, and
the API accepts only its own, a page being built can't use your session. A dev
server is shown through a small proxy on a port of its own, so its pages get
the comment script too; requests, redirects and websockets (hot reload) pass
through unchanged. While Claude streams a `write_file` for an
HTML file, the interface reads the half-arrived content out of the tool input
and draws it without its scripts; the real page takes over once it is written.

Comments on the preview work through a script in every previewed page. It
talks to the interface only with `postMessage`: in comment mode it outlines
what's under the pointer and reports the element you click (a selector, its
text and a slice of its HTML), and it draws numbered pins for the comments.
When the comments go to Claude, the screenshot's address carries the pins, so
the script draws them into the picture.

Screenshots start the installed browser headless with a window of the asked
width, let timers and requests settle, and read console messages from its log.

## Editors

`integrations/vscode` is the extension for VS Code, Cursor, Windsurf and
VSCodium. It never talks to Claude: it opens
`http://localhost:7777/#/open?path=...&file=...&line=...&text=...`, and the
interface finds or makes the workspace for the folder and puts the text into
its composer. `orbit <folder>` does the same from a terminal, handing the
folder to the Orbit that is running when there is one. The other way, the
server starts the editor's own command with the file and line, or returns its
link (`vscode://file/...`) for the browser to open.

## Build

`bun run build` builds the interface with Vite, packs every file of it into
`server/embedded.ts`, compiles the server for five platforms with
`bun build --compile`, and puts the stub `embedded.ts` back. The result is one
file per platform with nothing to install next to it.
