# Changelog

## 0.4.0 (2026-10-22)

Claude works with helpers, and you talk about the work where it is: on the
page, in a doc, on a board.

### Added

- **Helpers (subagents).** Claude hands parts of a task to helpers with the
  `delegate` tool; several sent in one reply run at the same time, as do
  read-only tools. Each helper is a workspace of its own you can open, watch
  and send messages to, shown in the conversation as a lane with what it's
  doing, then its report, cost and time. Helpers get their parent's approval
  mode and nothing more, can be limited to folders (writes elsewhere are
  refused in every mode) and can work in their own git worktree and branch,
  merged or discarded with a click. Explorer, builder, reviewer and tester
  are built in; agent files from `.claude/agents` and `.orbit/agents` work as
  they are. In the Orrery, helpers are moons around their planet.
- **Steering.** A message sent while Claude works joins the run at its next
  step instead of waiting for the end.
- **Comments on the preview.** Click Comment, point at anything on the page
  and say what to change. The comments go to Claude together, with a
  screenshot showing numbered pins and each element's selector and HTML. Dev
  servers are shown through a local proxy so this works there too, with hot
  reload passing through.
- **Docs.** Markdown documents in a workspace that Claude and you both edit.
  Comment on any passage, reply, resolve; Claude reads what you changed since
  its last look as a diff, with the open threads.
- **Whiteboard.** A canvas for notes, text, checklists, images and
  screenshots, links, files, frames and arrows. Claude sends batches of
  changes and new items find a free spot; you pan, zoom, drag, resize, edit,
  connect, and drop or paste images.
- **The side panel** holds Preview, Docs and Board as tabs, and follows Claude
  to where it's working unless you closed it or are typing in it.

### Changed

- Approval questions from a helper also show in the workspace that sent it.
- Screenshots taken from the interface can be taller than the window, so
  comments further down a page are in the picture.

## 0.3.0 (2026-10-22)

Orbit takes the shape of the work: a careful pair, a terminal, an autopilot,
a frontend studio or a research desk.

### Added

- **Profiles**: Pair, Terminal, Autopilot, Frontend and Research, picked at
  launch and switched in a workspace's header. A profile sets the approval
  mode, whether anyone is asked, the tools, the layout, effort, web search,
  the preview, a step limit and instructions. Change any of them, copy them
  into your own, and choose the default, in Settings or `orbit.toml`.
- **Full mode**: Claude decides on its own. Work inside the workspace folder
  goes through at once; actions that reach outside it, escalate, or are
  guarded commands from the catalog go to the judge, where unsure means no.
- **Terminal layout**, like a terminal agent: `❯` requests, `Name(argument)`
  tool rows with the first lines of output, monospace throughout.
- **Plan**: a checklist Claude keeps while it works, above the composer.
- **Live preview** of files and dev servers next to the conversation, on its
  own port and origin, reloading on every change; an HTML file is drawn while
  Claude writes it; phone, tablet, laptop and full widths; a draggable divider.
- **Screenshots** through the Chrome-family browser already installed, with
  console messages: a tool for Claude to check its work (other sites pass the
  gate like a fetch), a camera button and `/shot` for you.

### Security

- The API accepted requests from any page on localhost, whatever its port.
  Cookies are not tied to a port, so a page served by a local dev server could
  have used your Orbit session. Only Orbit's own origin is accepted now.

## 0.2.0 (2026-10-22)

Orbit works with what you already use, and looks quieter doing it.

### Added

- **The 100 programs.** Orbit knows the programs developers use most (editors,
  git and forges, runtimes, package managers, build and test tools, Docker and
  Kubernetes, Terraform, cloud CLIs, databases): it finds them, tells Claude
  how to run them without a prompt, lets their read-only subcommands through,
  never widens their destructive ones into a pattern, and keeps them from
  waiting for input. The list: [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).
- **Editors.** Files open in your editor at the right line. `orbit <folder>`
  opens a folder as a workspace from any terminal. An extension for VS Code,
  Cursor, Windsurf and VSCodium sends a selection, a file or a folder to Orbit.
- **Git panel.** Branches, staged and unstaged files with diffs, stage,
  discard, commit with a message Claude can write, pull and push.
- **Review changes** file by file against how each file was before Claude's
  first change: keep, or put it back.
- **MCP servers** over stdio or HTTP, their tools behind the gate, with the
  Playwright browser, GitHub and memory servers one click away.
- **Web search with citations**, a switch per workspace.
- **Project instructions and skills.** `AGENTS.md`, `CLAUDE.md`, Cursor,
  Windsurf and Copilot rules are followed; `SKILL.md` skills load from the
  project, `~/.orbit/skills` and `~/.claude/skills`.
- **Slash commands** in the composer, and Markdown files in `.claude/commands`
  or `~/.orbit/prompts` as saved prompts.
- **Smart compaction**: older messages fold into the summary, the last three
  requests stay word for word.
- **Missions**: requests that run on a schedule or from a local webhook,
  unattended, with a report and a notification.
- **Save as a page**: a workspace as one HTML file that opens anywhere.
- **Dictation** in the composer, where the browser supports it.

### Changed

- The interface is quieter: flat surfaces, hairlines and two radii instead of
  glass, glows and pills; the conversation reads as a log without avatars;
  colour means you (peach) or working (lavender) and nothing else.
- On tall phone screens the sky is seen from higher up, so the orbits fit.

### Fixed

- The installers failed with "could not download" while every release is a
  pre-release, because GitHub's `releases/latest` skips pre-releases. They now
  ask the API for the newest release.
- Cache reads were priced at 0.40 USD per million tokens for Opus 5.5 and
  0.20 for Sonnet 5.5; they are 0.20 and 0.10, so cost was shown too high on
  cached requests. Existing `orbit.toml` files keep their old numbers; edit
  `[pricing]` there or delete the section to take the new defaults.

### Verified

- 104 tests, among them: read-only detection for 34 catalog commands and the
  flags that turn them into writes, guarded commands never widened, the MCP
  client against a stdio and an HTTP server, the git panel on a real
  repository, compaction keeping the last requests whole, a mission refusing a
  delete instead of waiting, review undoing a file and removing a new one, the
  line diff.
- The editor extension against a stand-in editor; the compatibility page
  against the catalog; the end-to-end run as before.
- Every new screen with data in Chromium at desktop width and at 390 pixels.

Not verified yet: long sessions against the live API, web search and MCP
against real services (tested with the mock model and test servers),
dictation with a real microphone, the extension inside a real editor, the
Windows and macOS binaries beyond building them.

## 0.1.0 (2026-10-22)

The first release.

### Added

- The Orrery: workspaces as planets in a 3D sky (distance for recency, size
  for work done, sparks while working, a peach pulse when waiting for you),
  with a flat fallback where WebGL is not available.
- Workspaces with their own folder, model, instructions, judge notes and
  memory shelf; rename, archive, delete, export to Markdown, clear history
  with or without a summary, incognito workspaces.
- The agent loop with streaming, adaptive thinking shown as a thought trail,
  per-message effort, prompt caching, images, PDFs and text attachments.
- Tools: one persistent shell per workspace, read, write, edit, list, glob,
  grep and fetch.
- The gate: read-only skip, rules (from `orbit.toml`, Settings and "Always
  allow"), Manual, Auto and Rules modes, a judge model with plain-language
  notes, approvals with reasons sent back to Claude.
- Undo journal for file changes, kill switch, daily and per-workspace budgets.
- Telemetry: tokens per second, time to first token, context, cache hits,
  cost per workspace, per day and for the judge, rate limits.
- Interface tools Claude can use, each switchable: titles, planet style,
  pins, charts and notes, notifications, sandboxed widgets.
- Search across workspaces and a command palette (Ctrl K).
- Single binaries for Linux (x64, arm64), macOS (x64, arm64) and Windows
  (x64), installers that verify checksums, `orbit --mock` and
  `scripts/demo.ts` for trying it without a key.

### Verified

- 37 unit tests, among them: read-only detection for 20 commands, rules that
  cannot be stretched with `;`, `&&`, `$()` or a new line, a failing judge
  asking instead of allowing, "Always allow" answering the next time,
  dangling tool calls closed before the next request, thinking blocks sent
  back unchanged, `orbit.toml` reading back exactly what Orbit wrote.
- An end-to-end run in CI against a real server over HTTP and WebSocket with
  the mock model.
- Every screen with data in Chromium and Firefox at desktop width and at 390
  pixels, no console errors; the 3D sky in Chromium, the flat sky in Firefox.
- The Linux binary run from an empty folder, serving the embedded interface
  and passing the end-to-end run.

Not verified yet: long sessions against the live API, the Windows and macOS
binaries beyond building them.
