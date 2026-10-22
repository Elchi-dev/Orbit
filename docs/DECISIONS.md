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
