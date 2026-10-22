# Architecture

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
   through the gate at the same time, and the allowed ones run in order.
   Shell output is forwarded live.
6. The results are stored as the next user message and the loop continues
   until the reply ends without tools, the budget is used up, or you stop it.

After the first finished turn the scribe model names the workspace.

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
| `snapshots` | file contents before a change, for undo |
| `pins` | the memory shelf |
| `secrets` | the API key, AES-256-GCM |
| `search` | full-text index over messages (FTS5); incognito workspaces are left out |

### Events

The server pushes one stream of events to every open tab: `message`,
`block_start`, `delta`, `block_stop`, `speed`, `usage`, `tool_call`,
`tool_output`, `approval_request`, `approval_resolved`, `workspace`,
`turn_start`, `turn_end`, `cleared`, `notify` and `error`. The tab sends
`send`, `approval`, `stop` and `kill`.

## Interface

`web/src`, React with TypeScript.

| Where | What |
| --- | --- |
| `lib/store.ts` | All state, one store; applies server events |
| `components/orrery/` | The home screen. `OrreryScene` is the 3D sky (planet surfaces, the sun, nebula and dust are shaders); `FlatOrrery` is the same layout without WebGL |
| `components/cockpit/` | A workspace: the conversation, tool capsules, composer, telemetry, the dock and its drawers |
| `components/Approval.tsx` | The approval eclipse |
| `components/Settings.tsx` | Settings; writes `orbit.toml` through the server |
| `styles.css`, `app.css` | Tokens and the interaction rules every control follows |

Planet labels are ordinary buttons laid over the canvas and moved every frame
to sit under their planet, so they can be clicked, focused with Tab and read
by a screen reader.

## Build

`bun run build` builds the interface with Vite, packs every file of it into
`server/embedded.ts`, compiles the server for five platforms with
`bun build --compile`, and puts the stub `embedded.ts` back. The result is one
file per platform with nothing to install next to it.
