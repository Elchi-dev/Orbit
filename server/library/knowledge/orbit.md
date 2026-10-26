---
title: How Orbit works
description: Orbit itself: the sky, the gate and modes, profiles, helpers, the panel, missions, the library, settings and shortcuts. Read it when the user asks how to do something in Orbit.
always: false
---

# How Orbit works

Orbit is the app the user is talking to you in. It runs on their own computer and gives you a shell and their files, with a gate in front of everything that changes something. When they ask how Orbit works, answer from this file and point to where things are on screen. Say plainly when something is not here rather than guessing.

## The sky

The first screen is the Orrery: every planet is a workspace (a folder, a conversation and everything done there). Closer to the sun means used more recently, bigger means more work went into it. Sparks mean work is running there, a peach pulse means it is waiting for the user, small moons are helpers working for it. Drag to turn the sky, scroll to zoom, click a planet to fly in. At the bottom: type what you want done and press Launch; the button on its left picks the profile, the folder button picks where. Top bar: search (Ctrl K), the list of all workspaces, today's spending, settings.

## The gate

Every action passes one gate, in this order:
1. Things that only look (reading files, listing, `git status`, about 100 known programs' read-only commands) run straight away.
2. The user's rules: "always allow this", "never that", per workspace or everywhere. Settings, Approvals holds them.
3. The workspace's mode:
   - **Manual**: asks the user for everything else.
   - **Auto**: a second, cheaper model (the judge) allows the safe things and asks about the rest.
   - **Rules**: only what a rule allows runs; the rest is refused.
   - **Full**: decides on its own inside the workspace folder; anything outside it, or anything that escalates (sudo and similar), goes to the judge, and unsure means no.

Approvals: Y allow, A always (saves a rule), N deny. Every file is saved before it changes, so the review drawer can keep or undo each file. Esc stops a run; twice also ends the shell. While a run is going, the kill switch at the bottom of the dock stops it and ends the shell.

## Profiles

A profile bundles how a workspace works: approval mode, tools, layout, effort, web search, preview and plan. Built in: **Pair** (side by side, you approve), **Terminal** (dense and keyboard first), **Autopilot** (say what to build and walk away), **Frontend** (live preview beside the conversation), **Research** (web search, nothing on the machine changes). Pick one at Launch, switch in the workspace header, edit or add in Settings, Profiles.

## In a workspace

Header: the name (click to rename) and folder, the profile, the mode, Ori showing what is happening, and the pill with speed, context, cost, Compact and Clear. The conversation shows every action as a row that says who let it through; open a row for the output, the diff and the reason. While you work, a message the user sends joins your next step. The composer takes `/` for commands and saved prompts, files by drop or paste, Web on or off, and effort.

The dock (right edge): the shell, review changes, git (diff, commit, branches), missions, the memory shelf (pinned facts), workspace settings, and the panel buttons.

## The side panel

- **Preview**: the page being built, live, at any width. Comment: click anything on the page and say what to change; comments arrive together with a pinned screenshot.
- **Docs**: Markdown documents both of you edit, with comment threads on passages.
- **Board**: a whiteboard of notes, checklists, images, frames and arrows.

## Helpers

You can hand parts of a task to helpers (`delegate`) that run at the same time. Each is a workspace of its own the user can open and message. A builder can work on its own git branch; the user then picks Merge or Discard. Helpers never get more permission than their workspace.

## Missions

A mission is a request that runs on a schedule or when its webhook is called, unattended. It never waits for an answer: anything a rule or the judge does not allow is refused, and the user gets a report. In the dock, Missions.

## The library

Settings, Library (or the book in the sky's top bar) holds skills and knowledge:
- **Skills** are instructions for a kind of work, loaded when a task fits. Built-ins ship with Orbit; the user's own live in `~/.orbit/skills`, a project's in `.orbit/skills` or `.claude/skills`.
- **Knowledge** is reference the user keeps for you: files in `~/.orbit/knowledge` or a project's `.orbit/knowledge`. Ones marked "always" are in front of you every time; the rest you read with the knowledge tool.
- Built-ins can be switched off, or copied to edit. New ones start blank, from a template, or are written by Ori: a small model that may only search the web and read pages drafts one from a description, usually for a few cents, and the user reviews it before saving.

## Plugins

Settings, Plugins. A plugin is a folder in `~/.orbit/plugins` with an
`orbit-plugin.json`, written in any language. It can add tools, slash
commands, panels, checks before every action, settings, skills and knowledge,
and use Orbit itself. New plugins start off. "New plugin" makes one from a
template, and "Let Claude build it" opens a workspace in its folder where you
write it with the orbit-plugins skill. A plugin never gets the API key.

## Your phone

Settings, Your phone. The Orbit app for Android reaches this computer from
anywhere through a relay the user runs on a small server (a one-line install),
end to end encrypted. Pair the phone by scanning the QR code there. Approvals
reach the phone as alerts, through the relay or Firebase.

## Settings (Ctrl ,)

The API key (encrypted on this computer), models for work, the judge and titles, approvals and rules, budgets (daily and per workspace; Orbit stops before them), profiles, integrations (the programs Orbit found, MCP servers, editors, skills), the library, and the interface (theme, motion: full, calm or off).

## Ori

Ori is Orbit's mascot, the small star in the corner. Ask Ori (or press ?) explains parts of Orbit and offers a tour of the sky or a workspace. The setup can be run again from there.

## Command line

`orbit` starts it and opens the browser; `orbit .` opens the current folder as a workspace; `orbit --port`, `--no-open`, `--mock` (fake model, no API calls); `orbit check` tries real work against the API in a throwaway Orbit. Config is `~/.orbit/orbit.toml`, data `~/.orbit/orbit.db`.
