# Roadmap

What comes next, in order, with the reason for the order. Each step ships on
its own.

## Done in 0.2

Smart compaction, web search with citations, reviewing changes per file,
skills, project instruction files, slash commands and saved prompts, missions
(schedules and webhooks), a browser for Claude (through the Playwright MCP
server), saving a workspace as one HTML page, dictation, the git panel, MCP
servers, the editor extension and `orbit <folder>`, and the catalog of 100
programs. See the [changelog](../CHANGELOG.md).

## Done in 0.3

Profiles (Pair, Terminal, Autopilot, Frontend, Research, your own), Full
mode, the terminal layout, the plan, the live preview with pages drawn while
they are written, and screenshots for you and for Claude.

## Done in 0.4

Steering a running task, helpers (subagents) that run in parallel with their
own worktrees, comments on any element in the preview, docs shared by Claude
and you, and the whiteboard.

## 0.5: use it every day

- **Long-session hardening.** Run it against the live API for days of real
  work and fix what breaks. The mock model and the tests cover the paths, not
  the surprises. This is the most important item on the list.
- **A performance and accessibility check** next to screenshots in the
  preview.
- **Docs in the repository.** Keep a doc as a Markdown file in the workspace
  folder when you want it in git, not only in Orbit.
- **Hunk by hunk review.** Review already keeps or undoes whole files; some
  changes want a finer cut.
- **Secrets for MCP servers** from Orbit's encrypted store instead of
  `orbit.toml`.

## 0.6: memory and knowledge

- **Knowledge files per workspace.** A docs folder indexed locally, searched by
  a tool instead of pasted into every request.
- **Automatic memory.** Facts from past workspaces offered to the memory shelf,
  each one editable, with answers saying which memories they used.

## 0.7: watching it work

- **Replay.** Scrub a timeline to watch a finished run happen again, commands
  and file changes included, helpers side by side.

## Later

- **Phone companion:** approve or deny from the phone on the same network,
  with a pairing code. Off by default.
- **Voice out.** Dictation is in; spoken replies are not.
- **Other providers** (OpenAI, Gemini, local models) behind the same gate and
  telemetry.
- **JetBrains and Neovim plugins** like the VS Code extension. Until then,
  `orbit <folder>` from an external tool or a key mapping does the same.

## Not planned

See "Non-goals" in the [README](../README.md): no hosted version, no accounts,
no sandboxing pretending to be security.
