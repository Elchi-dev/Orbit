# Roadmap

What comes after 0.1, in order, with the reason for the order. Each step
ships on its own.

## 0.2: use it every day

The point of this release is that Orbit holds up in long, real sessions.

- **Long-session hardening.** Run it against the live API for days of real
  work and fix what breaks. The mock model and the tests cover the paths, not
  the surprises.
- **Smart compaction.** One click summarises older messages to free context,
  showing tokens before and after. Clearing exists; this is the gentler
  version, and long sessions need it first.
- **Web search with citations**, as a switch in the composer, through the
  API's own search tool. Most real tasks need something current.
- **Diff review.** Collect a run's file changes and accept or reject them hunk
  by hunk before they are kept. It turns the undo journal from a safety net
  into a workflow.

## 0.3: memory and knowledge

- **Knowledge files per workspace.** A docs folder indexed locally, searched by
  a tool instead of pasted into every request.
- **Automatic memory.** Facts from past workspaces offered to the memory shelf,
  each one editable, with answers saying which memories they used.
- **Skills.** Folders of instructions and scripts loaded only when relevant, in
  the open format, so existing skills work.

These come after 0.2 because they make Orbit better at what it already does;
0.2 makes it dependable.

## 0.4: watching it work

- **Replay.** Scrub a timeline to watch a finished run happen again, commands
  and file changes included.
- **Parallel helpers.** Split a task into helpers, drawn as moons around the
  workspace's planet, each with its own stream.
- **Share a run** as one self-contained HTML file.

## Later

- **Missions:** tasks on a schedule or started by a local webhook, in Rules
  mode, with a summary when they finish.
- **Phone companion:** approve or deny from the phone on the same network,
  with a pairing code. Off by default.
- **Voice** in and out.
- **Other providers** (OpenAI, Gemini, local models) behind the same gate and
  telemetry.
- **A browser tool**, gated like everything else.

## Not planned

See "Non-goals" in the [README](../README.md): no hosted version, no accounts,
no sandboxing pretending to be security.
