# Contributing

Issues and pull requests are welcome. For anything bigger than a fix, open an
issue first so we can agree on the shape before you build it.

## Running it from source

You need [Bun](https://bun.sh) 1.4 or newer.

```sh
bun install
bun run dev                    # server on :7777 and the interface on :5173
```

Open `http://localhost:5173`. Without an API key you can use the mock model:

```sh
ORBIT_MOCK=1 bun run dev
```

Or start with a sky full of example workspaces, in a throwaway data folder
(your `~/.orbit` is not touched):

```sh
bun scripts/demo.ts            # then open http://localhost:7777
```

The screenshots in `docs/images` are taken from this demo.

## Before a pull request

```sh
bun run typecheck && bun test && bun scripts/lint-text.ts
bun scripts/gen-compat.ts --check && node integrations/vscode/test.js
```

CI runs the same, builds the interface and drives a running server end to end
with `scripts/smoke.ts`.

- **Adding a program** to the list of 100 (or replacing one): edit
  `server/catalog.ts`, run `bun scripts/gen-compat.ts` to regenerate
  `docs/COMPATIBILITY.md`, and add a line to `server/catalog.test.ts` for any
  subcommand you mark read-only that has a flag which writes.
- **The editor extension** is plain JavaScript in `integrations/vscode`, with
  no build step. `node test.js` runs it against a stand-in editor.

- A test for every fix, named after what broke, with a comment saying what
  happened.
- No new dependency without a reason in the pull request. The server has none
  besides Bun.
- Interface: every control reacts to hover, press and focus (the classes in
  `web/src/styles.css`), works at 390 px wide, in Chromium and Firefox.
- Writing: plain words, sentence case, no em or en dashes
  (`scripts/lint-text.ts` checks).

## Releases

Publishing a GitHub release with a tag like `v0.2.0` runs
`.github/workflows/release.yml`, which builds the binaries, writes
`SHA256SUMS`, packs the editor extension as `orbit-vscode.vsix`, and attaches
all of it to the release the installers download from.
