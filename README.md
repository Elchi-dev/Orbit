```
 ██████╗ ██████╗ ██████╗ ██╗████████╗
██╔═══██╗██╔══██╗██╔══██╗██║╚══██╔══╝
██║   ██║██████╔╝██████╔╝██║   ██║
██║   ██║██╔══██╗██╔══██╗██║   ██║
╚██████╔╝██║  ██║██████╔╝██║   ██║
 ╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚═╝   ╚═╝
```

**Claude with a real shell, and a sky to keep it in :3**

[![CI](https://github.com/Elchi-dev/Orbit/actions/workflows/ci.yml/badge.svg)](https://github.com/Elchi-dev/Orbit/actions/workflows/ci.yml)
[![Status](https://img.shields.io/badge/status-alpha-orange)](#status)
[![TypeScript](https://img.shields.io/badge/TypeScript-Bun-3178C6?logo=typescript&logoColor=white)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Made by Elchi](https://img.shields.io/badge/made%20by-Elchi-8A2BE2)](https://github.com/Elchi-dev)

![The Orrery: every workspace is a planet around the sun](docs/images/orrery.webp)

---

## Overview

I wanted Claude on my own machine, with my own key, doing real work: running
the tests, editing the files, cleaning up the server. Every interface I tried
was one of two things. A chat box, where the model can only tell you what to
type. Or an agent with full access and a yes-or-no prompt for every single
`ls`, until you either click "allow all" out of boredom or give up.

Orbit is the middle I wanted. One binary, one command, a browser tab on
`localhost:7777`. Claude gets a persistent shell and your files. Nothing it
does reaches your machine without passing one gate, and the gate only bothers
you when it has a reason to.

It also does not look like a chat app. Workspaces are planets around a sun:
how close they orbit says how recently you used them, their size says how much
work went into them, sparks mean Claude is working there and a peach pulse
means it is waiting for you.

> Orbit is alpha. The agent loop, the gate, the judge and the interface are
> built and tested; long sessions against the live API have not been run yet.
> See [Status](#status) for what that means.

---

## The trick

**Every action passes one gate, and the gate only thinks when it has to.**

```
      Claude proposes an action
                 |
                 v
     read-only? (ls, cat, rg,      yes
     git status, file reads) ----------------------------> run now, no wait
                 | no
                 v
     one of your rules matches?    yes
     "allow rm -rf ./build/*" -----------------------------> allow or block
                 | no
                 v
            workspace mode
      +----------+-------------+
      |          |             |
   Manual       Auto         Rules
      |          |             |
      |    judge model reads   +--------------------------> blocked
      |    your notes + goal
      |     |     |      |
      |   allow  deny   unsure
      |     |     |      |
      v     v     v      v
   you decide: Allow once, Always allow (saves a rule), Deny with a reason
```

Everything else follows from that:

- **Fast by default.** Read-only work never waits for anyone, and your rules
  answer instantly. The judge is only asked about the rest, about several
  actions in parallel, and an action it allowed once is not asked again.
- **You can talk to the safety layer.** Auto mode's judge follows notes in
  plain language ("rm -rf inside the workspace is fine, never touch ~/.ssh").
  Rules are for the things you want decided without any model at all.
- **Failing closed.** If the judge errors or times out, Orbit asks you. It
  never falls through to allow.
- **Rules cannot be stretched.** A wildcard never crosses a shell operator, so
  `allow rm -rf ./build/*` does not also allow `rm -rf ./build/x; rm -rf ~`.
- **A way back.** Every file is saved before Claude changes it, the kill switch
  ends the shell and everything it started, and denied actions go back to
  Claude with the reason so it tries something else.

---

## A quick look

![A finished run: a read-only search, two edits allowed by a rule, a test run allowed by the judge](docs/images/workspace.webp)

Your request is marked by the peach line; Claude's work reads as text and plain
rows. Each row says who let it through: **read-only**, **your rule**,
**judge** or **you**. Open one for the diff, the reason and the output.

| | |
| --- | --- |
| ![The approval: the judge was not sure, so Orbit asks](docs/images/approval.webp) | ![The git panel with a diff and a commit message](docs/images/git.webp) |
| When something needs you, the screen dims behind an eclipse. **Y**, **A** or **N** on the keyboard. | Branches, diffs, stage, commit, pull and push, next to the conversation. Claude writes the commit message if you want. |
| ![Reviewing changes file by file](docs/images/review.webp) | ![Missions with a schedule, a webhook and the last report](docs/images/missions.webp) |
| Every file Claude changed, against how it was before. Keep it, or put it back. | Missions run on a schedule or a webhook while you're away, and never wait for an approval. |
| ![Integrations: the programs Orbit found on this machine](docs/images/integrations.webp) | ![Slash commands and saved prompts](docs/images/slash.webp) |
| The 100 programs Orbit knows, and which ones you have. | Type `/` for commands; your `.claude/commands` show up there too. |
| ![A web search with numbered citations](docs/images/search.webp) | ![A chart Claude drew in the conversation](docs/images/chart.webp) |
| Web search with sources, a switch per workspace. | Claude can name workspaces, pin facts and draw charts. Each one is a switch. |

<p align="center"><img src="docs/images/telemetry.webp" alt="Telemetry: speed, first token, context, cache hits and cost" width="420"></p>

<p align="center"><img src="docs/images/phone.webp" alt="Orbit on a phone" width="560"></p>

---

## Works with what you already use

- **The 100 programs developers use most**, from git, Docker and kubectl to
  pnpm, uv, Terraform, the cloud CLIs and psql. For each one that is installed,
  Orbit tells Claude it is there and how to run it without a prompt, lets its
  read-only subcommands through (`docker ps`, `kubectl get`), refuses to widen
  its destructive ones into a rule (`terraform apply`, `kubectl delete`), and
  sets the variables that stop it from paging or asking. The full list, and
  what Orbit knows about each: [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).
- **Your editor.** Paths open in VS Code, Cursor, Windsurf, Zed, JetBrains,
  Sublime or Xcode at the right line. `orbit .` in any terminal opens that
  folder as a workspace. The [extension](integrations/vscode) for VS Code,
  Cursor, Windsurf and VSCodium sends a selection with `Ctrl Alt O`.
- **Your project's instructions.** `AGENTS.md`, `CLAUDE.md`, `.cursorrules`,
  `.cursor/rules`, `.windsurfrules` and Copilot's instructions are followed.
- **Your skills and prompts.** `SKILL.md` skills from `.claude/skills` and
  `~/.claude/skills`, and Markdown prompts from `.claude/commands`, work as
  they are.
- **Everything else through MCP.** Add a server by command or URL; its tools
  pass the same gate. A real browser for Claude (Playwright), GitHub and a
  memory store are one click away.

---

## Install

```sh
# Linux and macOS
curl -fsSL https://raw.githubusercontent.com/Elchi-dev/Orbit/main/install.sh | sh
```

```powershell
# Windows, in PowerShell
irm https://raw.githubusercontent.com/Elchi-dev/Orbit/main/install.ps1 | iex
```

The installer picks the binary for your system from the latest release,
checks it against `SHA256SUMS` and puts it in `~/.local/bin` (Windows:
`%LOCALAPPDATA%\Programs\Orbit`). Then:

```
orbit
```

The browser opens on `http://localhost:7777`. Paste your Anthropic API key once
and launch your first workspace by typing what you want done.

```
orbit .               this folder as a workspace (or hand it to the running Orbit)
orbit --port 7778     another port
orbit --no-open       don't open the browser
orbit --mock          a fake model, no API calls: try the interface for free
orbit --version
```

To build it yourself you need [Bun](https://bun.sh) 1.4 or newer:

```sh
git clone https://github.com/Elchi-dev/Orbit.git && cd Orbit
bun install && bun run build            # binaries in release/
```

---

## What is in it

| Part | What it does |
| --- | --- |
| **The Orrery** | The home screen: a 3D sky where every workspace is a planet. Drag to turn it, scroll to zoom, click or Tab to a planet. Falls back to a flat sky where WebGL is not available. |
| **Workspaces** | A folder, a model, instructions and judge notes each. Clear the history with or without a summary, export to Markdown, search everything with Ctrl K, incognito workspaces that delete themselves when you leave. |
| **Tools** | One persistent shell per workspace (`cd` and variables carry over), read, write, edit, list, glob, grep and fetch. |
| **The gate** | Read-only skip, rules, three modes, a judge with your notes, approvals with "Always allow" and a reason on deny. [docs/PERMISSIONS.md](docs/PERMISSIONS.md) |
| **Safety** | Undo journal for every changed file, kill switch (Esc twice), daily and per-workspace budgets, a session cookie and Host and Origin checks on every request. [SECURITY.md](SECURITY.md) |
| **Telemetry** | Speed, first token, context used, cache hits, cost per workspace, per day and for the judge, rate limits. |
| **Interface tools** | Claude may rename the workspace, restyle its planet, pin facts, show charts and notes, notify you, and build sandboxed widgets. Each one is a switch. |
| **Composer** | Images, PDFs and text files by drag, paste or click; long pastes become attachments; an effort picker per message; web search; dictation; `/` commands and saved prompts. |
| **Git and review** | A git panel (branches, diffs, stage, commit, pull, push) and a review of every file Claude changed, kept or put back one by one. |
| **Missions** | Requests that run on a schedule or from a local webhook, unattended, with a report and a notification. |
| **Context** | Project instruction files, skills, MCP servers, the 100 known programs, smart compaction of older history. |
| **Sharing** | Export to Markdown, or save a workspace as one HTML page that opens anywhere. |

Everything lives in one SQLite file in `~/.orbit`, next to `orbit.toml`. The
annotated config is [orbit.example.toml](orbit.example.toml).

---

## Planned

- Long sessions against the live API, and fixing what they turn up
- Hunk by hunk review, secrets for MCP servers from the encrypted store
- Knowledge files per workspace and automatic memory
- Replay, and parallel helpers drawn as moons around a planet
- A phone companion with pairing, voice out, other providers

Reasons and order: [docs/ROADMAP.md](docs/ROADMAP.md).

---

## Non-goals

- **Not a sandbox.** Orbit runs as you. The gate decides what runs; it does not
  contain what runs. If you want isolation, run Orbit inside a VM or container
  and give it that machine.
- **Not a hosted service, and not multi-user.** One person, one machine,
  loopback only. There are no accounts.
- **Not an IDE.** It does not replace your editor; it opens files in it and
  takes selections from it. It is where you hand work over and watch it happen.
- **Not a chat app with extras.** No characters, no social features, no
  hosted sharing: a workspace leaves your machine only as a file you save.

---

## Status

Alpha, and honest about it.

Built and tested: the agent loop with streaming, adaptive thinking, tool use
and web search, the persistent shell, all file tools, the gate with read-only
detection for the shell and the 100 known programs, rules, three modes and the
judge, approvals with "Always allow", the undo journal, review and kill switch,
budgets, compaction, missions, MCP servers, the git panel, skills and project
instructions, the editor links and extension, the whole interface, single
binaries for five platforms and the installers.

Not yet: long sessions against the live API (everything above was driven by
the mock model, test servers and unit tests), web search and MCP against real
services, the extension inside a real editor, dictation with a real
microphone, the 3D sky in Firefox (checked with the flat fallback only),
Windows beyond building the binary.

The test bar: 104 tests named after what they protect, including the rule
that once let an allow rule be stretched with `;`, flags that turn a read-only
command into a write, and a mission that must refuse instead of waiting. CI
starts a real server and drives it end to end over HTTP and WebSocket, checks
that the compatibility page matches the catalog, and runs the extension
against a stand-in editor. Every screen was checked with data at desktop width
and at 390 pixels.

---

## Docs

| Document | What |
| --- | --- |
| [docs/PERMISSIONS.md](docs/PERMISSIONS.md) | The gate in detail: read-only list, rule syntax, modes, the judge, unattended runs |
| [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) | The 100 programs, what Orbit knows about each, the editor links |
| [integrations/vscode](integrations/vscode) | The extension for VS Code, Cursor, Windsurf and VSCodium |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the server, the agent loop and the interface fit together |
| [orbit.example.toml](orbit.example.toml) | Every setting, annotated |
| [SECURITY.md](SECURITY.md) | What Orbit protects against, what it does not, how to report a problem |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Why Bun and React, why MIT, and the other choices |
| [docs/ROADMAP.md](docs/ROADMAP.md) | What comes next, and why in that order |
| [CHANGELOG.md](CHANGELOG.md) | Releases |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Running it from source, tests, the demo |

---

## License

MIT. See [LICENSE](LICENSE).

**Made by Elchi**
