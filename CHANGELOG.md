# Changelog

## Unreleased

### Fixed

- The installers failed with "could not download" while every release is a
  pre-release, because GitHub's `releases/latest` skips pre-releases. They now
  ask the API for the newest release.
- Cache reads were priced at 0.40 USD per million tokens for Opus 5.5 and
  0.20 for Sonnet 5.5; they are 0.20 and 0.10, so cost was shown too high on
  cached requests. Existing `orbit.toml` files keep their old numbers; edit
  `[pricing]` there or delete the section to take the new defaults.

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
