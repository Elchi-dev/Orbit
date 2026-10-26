<p align="center"><img src="docs/images/ori/hi.svg" width="220" alt="Ori, Orbit's mascot, a small star with a ring, waving hi"></p>

<h1 align="center">orbit</h1>

<p align="center"><b>Claude with a real shell, and a sky to keep it in :3</b></p>

<p align="center">
<a href="https://github.com/Elchi-dev/Orbit/actions/workflows/ci.yml"><img src="https://github.com/Elchi-dev/Orbit/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
<a href="#status"><img src="https://img.shields.io/badge/status-alpha-orange" alt="Status: alpha"></a>
<a href="https://bun.sh"><img src="https://img.shields.io/badge/TypeScript-Bun-3178C6?logo=typescript&amp;logoColor=white" alt="TypeScript on Bun"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
<a href="https://github.com/Elchi-dev"><img src="https://img.shields.io/badge/made%20by-Elchi-8A2BE2" alt="Made by Elchi"></a>
</p>

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

## Meet Ori

<table>
<tr>
<td align="center"><img src="docs/images/ori/hi.svg" width="110" alt=""><br><sub>hi</sub></td>
<td align="center"><img src="docs/images/ori/working.svg" width="110" alt=""><br><sub>running a command</sub></td>
<td align="center"><img src="docs/images/ori/searching.svg" width="110" alt=""><br><sub>on the web</sub></td>
<td align="center"><img src="docs/images/ori/needs.svg" width="110" alt=""><br><sub>needs you</sub></td>
<td align="center"><img src="docs/images/ori/done.svg" width="110" alt=""><br><sub>done</sub></td>
</tr>
</table>

Ori is the small star the workspaces orbit, with a ring of its own and two
mitten hands. It shows what Claude is doing (thinking, a pose for each kind of
tool, waiting for you, done), keeps you company in empty places, and explains
Orbit when you ask:

- **Setup with Ori.** The first start is a short wizard: your key, how you
  like to work, and who approves.
- **Ask Ori.** The button in the corner, or <kbd>?</kbd>: the sky, the gate,
  profiles, helpers, the panel, missions and shortcuts, each in a few lines.
- **Tours.** Ori walks you around the sky or a workspace with a spotlight.
  The first visit to each offers it once.

| | | |
| --- | --- | --- |
| ![The setup wizard: Ori asks who says yes](docs/images/welcome.webp) | ![Ask Ori: topics and the tour, from the corner of the sky](docs/images/ask-ori.webp) | ![The sky tour: a spotlight on where you start](docs/images/tour.webp) |

All fifteen poses, and how to use them: [docs/ORI.md](docs/ORI.md).

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

## One app, shaped for the job

![Picking a profile when launching a workspace](docs/images/profiles.webp)

Every workspace runs under a **profile**: who approves, which tools Claude gets,
how the conversation looks and what Claude is told. Five come built in, and
each can be changed or copied into your own (Settings, Profiles, or
`[profiles.<id>]` in `orbit.toml`).

| Profile | For | How it works |
| --- | --- | --- |
| **Pair** | working side by side | you approve what changes your machine |
| **Terminal** | people who live in a terminal | dense, keyboard first, `Bash(npm test)` rows with output, like Claude Code in the browser |
| **Autopilot** | "build me this" and walk away | **Full** mode: it plans, decides and builds on its own and never asks; only actions that reach outside the folder or escalate go to the judge, and unsure means no |
| **Frontend** | interfaces | a live preview next to the conversation, screenshots at phone and desktop width |
| **Research** | reading and writing up | web search on, no shell, nothing on your machine changes |

![The Terminal profile: commands and output inline, a plan above the prompt](docs/images/terminal.webp)

---

## Build interfaces while you watch

| | |
| --- | --- |
| ![The page appearing in the preview while Claude writes it](docs/images/live.webp) | ![The finished page at phone width, with the screenshots Claude took to check it](docs/images/preview.webp) |
| While Claude writes an HTML file, the preview draws it as it arrives. | Then the real page, reloading by itself on every change. Claude checks its work with screenshots; you switch widths, or drop a screenshot into your message. |

- **The preview** shows a file, a folder or a dev server (Vite, Next and the
  rest are picked up from their output), on its own port, so a page being
  built can never reach Orbit.
- **Screenshots** come from the Chrome, Edge or Brave you already have, in
  half a second, with the page's console errors. `/shot <url>` captures any
  site into your message, for "make it look like this".

---

## Helpers that work side by side

![Three helpers sent at once: one measures, one builds on its own branch, one reviews](docs/images/helpers.webp)

Claude can hand parts of a task to **helpers**: separate agents with their own
context, shell and model. Several sent in one reply run at the same time.

- **You watch them work.** Each helper shows what it's doing right now, then
  its report, cost and time. Open one for its whole run.
- **You can talk to them.** Send a message to a running helper and it joins
  its next step. Claude can follow up with the same helper, which keeps what
  it learned.
- **They don't collide.** A builder can be given the folders it may write to
  (writes elsewhere are refused, in every mode) and its own git worktree and
  branch. When it's done you **Merge** (the changes come back staged) or
  discard it.
- **They never get more than the workspace that sent them.** Same approval
  mode, same gate, and their questions come up where you are.
- **Agent files you already have work.** Explorer, builder, reviewer and
  tester are built in; Markdown agents from `.claude/agents` and
  `.orbit/agents` are picked up as they are.

In the Orrery, helpers circle their planet as small moons.

---

## Point at it, write it down, lay it out

A panel beside the conversation holds three things, each a click in the dock.

| | |
| --- | --- |
| ![Comments pinned to elements of a page in the preview](docs/images/comments.webp) | **Comment on the preview.** Click Comment, then anything on the page, and say what should change. The comments collect in a list and go to Claude together, with a screenshot showing numbered pins, the element's selector and its HTML. Works for dev servers too, hot reload included. |
| ![A doc with a highlighted passage and a comment thread](docs/images/docs.webp) | **Docs.** Plans, specs and notes as Markdown that you and Claude both edit. Select a passage to comment on it; Claude answers in the thread and resolves it. When it reads the doc again it sees exactly what you changed. |
| ![The whiteboard with three options in a frame, a checklist and an arrow](docs/images/board.webp) | **Whiteboard.** Claude lays out options, flows, screenshots and checklists; you move, resize, edit, draw arrows and drop in images. It reads back what you changed. Docs and the board are each a switch. |

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

## Orbit on your phone

The Orbit app for Android reaches the Orbit on your computer from anywhere.
Between the two sits a small relay you run on any cheap server, installed
with one line:

```sh
curl -fsSL https://raw.githubusercontent.com/Elchi-dev/Orbit/main/relay/install.sh | sudo sh -s -- --domain relay.example.com
```

The relay only passes sealed messages along. Your phone and your computer
agree on keys when you scan a QR code in Settings, Your phone, and everything
after that is encrypted end to end (X25519, HKDF and AES-256-GCM, written down
with test vectors in [docs/REMOTE.md](docs/REMOTE.md)). Nothing opens on your
home network. On the phone: the sky, every workspace and conversation, a new
task, approvals, and an alert when Claude needs you, through the relay or
Firebase, which carries it without being able to read it.

![The Android app: the sky, a workspace, an approval, and everything waiting for you](docs/images/android.webp)

![Settings, Your phone: the relay online, a paired phone, and a pairing code](docs/images/phone-settings.webp)

---

## Make it yours: plugins

If Orbit doesn't do something, a plugin can. A plugin is a folder with an
`orbit-plugin.json` and a program in any language, spoken to over stdin and
stdout. It can give Claude tools, add slash commands and panels, check every
action before it runs, follow every event, and use Orbit itself: start Claude
on a task, call a model under your budget, answer approvals, keep its own
data. TypeScript runs on Orbit's own runtime, so nothing needs installing;
Python and anything else work too. A plugin never sees your API key.

In Settings, Plugins, **New plugin**, describe what it should do and press
**Let Claude build it**. [docs/PLUGINS.md](docs/PLUGINS.md) has the manifest,
the protocol and a whole plugin in TypeScript, Python and Go.

![Settings, Plugins: the env-guard example, what it may do, its settings](docs/images/plugins.webp)

---

## It learns what you keep

- **The library.** Eighteen built-in skills (debugging, code review, security
  review, accessibility, release, research reports and more) and Orbit's own
  manual, each one a switch, plus your own and your projects'. Ori writes a new
  skill or knowledge file from a description, after searching for current
  practice, usually for a few cents.
- **Knowledge folders.** Point a workspace at `docs/` or a wiki export: it is
  indexed on your computer and searched when needed, not pasted into every
  request.
- **Memory.** After some work, Ori suggests a few things worth remembering
  everywhere, like how you like answers or what a project runs on. Nothing is
  kept until you say yes, and answers show which memories they used.

| | |
| --- | --- |
| ![The library: built-in skills, each a switch](docs/images/library.webp) | ![Memory: two suggestions waiting, and what is kept](docs/images/memory.webp) |

---

## Watch it again

**Replay** plays a finished run back: every message, every command with who
allowed it and its output, every file change with its diff, helpers side by
side, at up to eight times speed with the waiting squeezed out. **Review**
keeps or undoes one change at a time, not just whole files. In the preview, a
**check** measures speed and finds the accessibility problems a page shows by
itself, and hands them to Claude to fix.

![Replay of a finished run, the steps on the left and the selected one on the right](docs/images/replay.webp)

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
| **Git and review** | A git panel (branches, diffs, stage, commit, pull, push) and a review of every file Claude changed, kept or put back a file or a change at a time. |
| **Missions** | Requests that run on a schedule or from a local webhook, unattended, with a report and a notification. |
| **Context** | Project instruction files, skills, MCP servers, the 100 known programs, smart compaction of older history. |
| **Profiles** | Pair, Terminal, Autopilot, Frontend and Research, or your own: approvals, tools, layout, effort and instructions per kind of work. A plan checklist Claude keeps while it works. |
| **Preview** | Live preview of files and dev servers, the page drawn while it is written, widths from phone to laptop, screenshots for you and for Claude, comments on any element, and a speed and accessibility check. |
| **Helpers** | Subagents that run in parallel, each a workspace you can open and talk to, with folder limits, their own worktree and branch, and a report. |
| **Docs and the whiteboard** | Markdown docs you both edit and comment on, kept as files in the repository if you like, and a canvas for notes, screenshots, checklists, frames and arrows. |
| **Steering** | Send a message while Claude works and it joins the run at the next step. |
| **Sharing** | Export to Markdown, or save a workspace as one HTML page that opens anywhere. |
| **Library and memory** | Built-in and your own skills and knowledge, knowledge folders searched per workspace, memories you keep across workspaces. |
| **Replay** | A finished run played back on a timeline, helpers side by side. |
| **Plugins** | Tools, commands, panels, hooks and settings from a folder, in any language, with access to Orbit itself. [docs/PLUGINS.md](docs/PLUGINS.md) |
| **Your phone** | The Android app and a relay you run, end to end encrypted, with alerts for approvals. [docs/REMOTE.md](docs/REMOTE.md) |

Everything lives in one SQLite file in `~/.orbit`, next to `orbit.toml`. The
annotated config is [orbit.example.toml](orbit.example.toml).

---

## Planned

- Long sessions against the live API, and fixing what they turn up
- Voice out, other providers, JetBrains and Neovim plugins

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
judge, approvals with "Always allow", the undo journal, review per file and per
change, the kill switch, budgets, compaction, missions, MCP servers with their
tokens encrypted, the git panel, the library, knowledge folders, memory,
project instructions, the editor links and extension, profiles and Full mode,
the plan, the live preview, screenshots and the page check, steering, helpers
with worktrees, comments on the preview (also through a real Vite dev server
with hot reload), docs as files, the whiteboard, replay, plugins in TypeScript
and Python (also on the compiled binary with no Bun or Node installed), the
relay with its installer, the phone protocol (checked against a second
implementation), the Android app's networking against a real Orbit and relay,
the whole interface in Chromium and Firefox, single binaries for five
platforms and the installers.

Not yet: long sessions against the live API (everything above was driven by
the mock model, test servers and unit tests), helpers run by a real model on
a real project, web search and MCP against real services, the extension inside
a real editor, dictation with a real microphone, Firefox on a real GPU, the
Android app on a real phone (its screens were rendered in tests, its camera,
notifications and background service never ran on a device), Firebase
delivery end to end, the relay's Let's Encrypt setup on a real server, Windows
beyond building the binary.

To try it against the real API yourself: `orbit check`. It runs ten real
tasks in a throwaway Orbit, usually for $0.30 to $1, and writes a report.

The test bar: 179 tests for the server, 15 for the relay and 54 for the app, named after what they protect, including the rule
that once let an allow rule be stretched with `;`, flags that turn a read-only
command into a write, a mission that must refuse instead of waiting, a page on
another local port that must not reach the API, a preview that must not
serve anything outside its folder, and a helper that must not write outside
the folders it was given. CI
starts a real server and drives it end to end over HTTP and WebSocket, checks
that the compatibility page matches the catalog, and runs the extension
against a stand-in editor. Every screen was checked with data at desktop width
and at 390 pixels.

---

## Docs

| Document | What |
| --- | --- |
| [docs/PERMISSIONS.md](docs/PERMISSIONS.md) | The gate in detail: read-only list, rule syntax, modes, the judge, unattended runs |
| [docs/PLUGINS.md](docs/PLUGINS.md) | Plugins: the manifest, permissions, panels, the protocol, the SDKs |
| [docs/REMOTE.md](docs/REMOTE.md) | Orbit on your phone: setting up a relay, and the encrypted protocol |
| [relay/README.md](relay/README.md) | Running the relay: the installer, behind nginx or Caddy, updates |
| [docs/ORI.md](docs/ORI.md) | Ori: every pose, where it shows up, using it in code |
| [docs/MOTION.md](docs/MOTION.md) | How everything moves: appearing, leaving, hover, press, touch, idle |
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
