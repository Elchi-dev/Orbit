# Decisions

Newest first. Each one says what was decided and why, and what was given up.

## Rule wildcards stop at shell operators (2026-10-22)

`*` in a rule matches anything except `; & | ` `` ` `` `$ ( ) < >` and new
lines. Before, `allow rm -rf ./build/*` also matched
`rm -rf ./build/x; rm -rf ~`. The cost: a rule cannot allow a chained command
with a wildcard; write one rule per command, or a regex rule if you really
mean it. A test keeps this.

## WebGL is optional (2026-10-22)

The home screen checks for WebGL 2 before loading the 3D sky and catches
errors while it runs. Without it, the same sky is drawn flat with plain
elements. Found when a browser without WebGL showed a blank page: the whole
interface was gone, not just the sky.

## MIT (2026-10-22)

Orbit runs with full access to the machine it is on. Nobody should have to
trust a binary with that much access whose source they may only look at, so
it is MIT, like moat. A source-available licence like hydra's was the
alternative; it would protect the work for a while but make the trust
question harder.

## Bun, TypeScript and React instead of Go and SvelteKit (2026-10-22)

The usual choice for a tool like this would be Go with an embedded SvelteKit
interface. Orbit differs on purpose:

- The Orrery is the product's face, and React Three Fiber with drei is the
  most complete way to build a 3D scene with shaders as components. The
  Svelte equivalent (Threlte) is smaller and younger.
- Bun compiles the server and the interface into one file per platform with no
  runtime to install, which is what `curl ... | sh` needs; it also brings
  SQLite, WebSockets, TOML, globbing and spawning without dependencies.
- One language on both sides of the WebSocket: the event and message types
  are shared.

Given up: a smaller binary (Bun's is 65 to 89 MB, a Go one would be about 15)
and Go's tooling. Dependencies stay few: the server uses none besides Bun
itself; the interface uses React, Three.js, Motion, zustand, Lucide and a
Markdown renderer.

## No SDK for the API (2026-10-22)

The client in `server/anthropic.ts` is about 200 lines of `fetch` and
server-sent events. It controls every field Orbit relies on (adaptive
thinking with summaries, effort, cache breakpoints, rate limit headers) and
keeps thinking blocks byte for byte, which the API requires in tool loops.
It also makes the mock model a few lines.

## The judge skips read-only actions (2026-10-22)

Asking a model about `ls` makes Auto mode slow and expensive for nothing. Read
detection is strict instead: a command is read-only only when every part of
it is on a short list and nothing redirects, substitutes or escalates. Rules
come before the judge for the same reason: they cost nothing.

## One shared shell per workspace (2026-10-22)

A fresh process per command is simpler but loses `cd`, exported variables and
activated environments, so Claude would repeat them on every call and still
get them wrong. The cost is that one hung command blocks the workspace until
its timeout or the kill switch; standard input from `/dev/null` prevents the
most common hang.

## The API key in an encrypted file, not the OS keychain (2026-10-22)

The key is encrypted with AES-256-GCM using a master key in
`~/.orbit/master.key` (mode 0600). Keychain access differs on each system and
would need native code in a single static binary. The protection is the same
as for other secrets in your home folder; the key never reaches the browser
or a log. `ANTHROPIC_API_KEY` works too and is never stored.

## One binary, installed with curl (2026-10-22)

`curl -fsSL .../install.sh | sh` on Linux and macOS, `irm ... | iex` on
Windows, both verifying `SHA256SUMS` from the release. No package manager, no
runtime.

## Workspaces, not chats (2026-10-22)

A workspace is a folder, a model, instructions, judge notes and a memory
shelf, with a conversation in it. The word says what it is for: work happens
there, and it stays where you left it.

## A quiet interface around one loud sky (2026-10-22)

The first interface wrapped everything in glass, glows, pills and gradient
avatars, and read like every generated app. Now the sky is the one loud thing:
the cockpit uses flat ink surfaces, hairline borders and two radii, the
conversation is a log (your request marked by a peach rule, Claude's work as
text and plain tool rows), and colour carries meaning only: peach is you or
"needs you", lavender is "working".

## "Compatible" means five concrete things (2026-10-22)

"Works with the 100 programs developers use" had to mean something checkable.
For each program in `server/catalog.ts` Orbit finds it, tells Claude it is
there and how to run it without a prompt, lets its read-only subcommands
through, never widens its destructive ones into a pattern, and sets the
variables that stop it from waiting for input. Editors also open files at a
line. The list is code, and the documentation is generated from it, so the two
can't disagree. Deeper links (the git panel, the editor extension, MCP) are
separate features, not claims about the list.

## Borrow formats instead of inventing them (2026-10-22)

Project instructions are read from `AGENTS.md`, `CLAUDE.md` and the rule files
Cursor, Windsurf and Copilot use; skills use the `SKILL.md` folder format;
saved prompts are Markdown files in `.claude/commands`; apps connect through
MCP. Someone arriving from another tool brings their setup along unchanged.

## Missions never wait (2026-10-22)

A scheduled or webhook run has nobody to ask. Rather than parking an approval
until someone shows up, an unattended run treats every "ask" as "no": Manual
becomes Rules, an "ask" rule refuses, and an unsure judge refuses. The report
says what was refused, and a rule fixes it for next time.

## The editor extension only hands over text (2026-10-22)

The extension never calls the API. It opens a local link, and Orbit puts the
selection into the composer of the right workspace, where nothing is sent until
you press Enter. One place holds the key, the gate and the history.

## Profiles instead of one right way to work (2026-10-22)

People want different things from the same agent: a careful pair, a terminal,
an autopilot that builds a project alone, a frontend studio, a research desk.
Rather than one workflow with switches everywhere, a profile bundles the few
settings that make the difference (approvals, who is asked, tools, layout,
effort, preview, instructions). The built-ins are ordinary profiles you can
change, and `orbit.toml` adds new ones, so the shape is configuration, not code.

## Full autonomy still has a floor (2026-10-22)

"Decide everything yourself" should not mean "delete my home folder if it
seems right". Full mode lets everything inside the workspace through and sends
only what reaches outside it, escalates or is catalogued as destructive to the
judge, which can say no but never waits for you. Block rules still win.

## The preview is another origin (2026-10-22)

A page Claude builds runs real scripts. Served from Orbit's own origin it could
call the API with your session. The preview has its own read-only server on
another port, and the API accepts only Orbit's exact origin, which also closed
the older gap where any local page could.
