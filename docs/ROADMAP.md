# Roadmap

<p align="center"><img src="images/ori/searching.svg" width="120" alt="Ori looking through a telescope"></p>

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
and you, and the whiteboard. In 0.4.1: Ori, a setup wizard, Ask Ori and tours,
motion throughout, and a flat sky that matches the 3D one.

## Done in 0.7

What 0.5 to 0.7 planned, shipped together, plus two things that weren't on
the list:

- **0.5:** a speed and accessibility check beside the preview, docs kept as
  files in the repository, review one change at a time, MCP tokens in the
  encrypted store, and `orbit check` for trying it against the live API.
- **0.6:** the library (built-in skills and knowledge, your own, written by
  Ori on request), knowledge folders searched per workspace, and automatic
  memory you approve.
- **0.7:** replay of a finished run, helpers side by side.
- **Also:** the Android app with a relay you run, end to end encrypted, and
  plugins in any language.

## Next: use it every day

- **Long-session hardening.** Run it against the live API for days of real
  work and fix what breaks. `orbit check` is the start; the mock model and the
  tests cover the paths, not the surprises. This is the most important item.
- **The phone app on more phones**, and an iPhone app.

## Later

- **Voice out.** Dictation is in; spoken replies are not.
- **Other providers** (OpenAI, Gemini, local models) behind the same gate and
  telemetry.
- **JetBrains and Neovim plugins** like the VS Code extension. Until then,
  `orbit <folder>` from an external tool or a key mapping does the same.

## Not planned

See "Non-goals" in the [README](../README.md): no hosted version, no accounts,
no sandboxing pretending to be security.
