---
name: writing-docs
description: Use when asked to write or improve a README, a getting-started guide, a how-to, reference pages, or other technical documentation for a project, library, tool or API.
---

# Writing Docs

Good docs get the reader from arrival to success fast, and every command in them works. Write for a reader who is busy, skimming, and about to copy-paste.

## 1. Know the reader and what they need first

Before writing, answer from the code and the request:

- **Who arrives here?** A first-time evaluator, a new user installing it, a daily user looking something up, a contributor.
- **What do they need in the first screen?** Usually: what this is, why they would use it, and how to get it running.
- **What do they already know?** Do not explain `git clone` to developers. Do explain a project-specific concept the first time it appears.

Read the project before writing: the entry points, the CLI help output, config files, existing docs, tests (they show real usage), and the package manifest (name, scripts, supported runtimes).

## 2. Pick the right kind of doc

Each page should be one kind. Mixing them is the most common reason docs feel muddled.

| Kind | Reader's need | Shape | Example title |
| --- | --- | --- | --- |
| Tutorial | Learn by doing, first time | A guided path with a guaranteed working result | "Build your first plugin" |
| How-to guide | Get a specific task done | Numbered steps toward a goal, assumes competence | "Rotate the API keys" |
| Reference | Look up exact facts | Complete, consistent, structured like the code | "CLI options", "Config keys" |
| Explanation | Understand why | Prose about design, trade-offs, concepts | "How sync conflicts are resolved" |

Rules:

- Tutorials and how-tos do not stop to explain theory. Link to the explanation instead.
- Reference does not teach. It lists every option with type, default, and a one-line meaning.
- Explanation does not contain step lists.

## 3. README structure

A README is a landing page. Default order:

1. **Name and one sentence** saying what it does and for whom. "Orbit is a local workspace where..." not "A next-generation platform for...".
2. **Quickstart**: the shortest path from nothing to a visible result. Install, one command, what you should see.
3. **Example**: one realistic usage showing the main value.
4. **Install details**: requirements, platform notes, alternatives.
5. **Usage / Configuration**: the common cases, then a link to full reference.
6. **Links**: docs site, contributing, license, support.

Cut badges, marketing, and roadmaps unless the user asks for them.

## 4. Quickstarts that actually run

- Start from a clean state: state prerequisites explicitly (runtime, OS, accounts, keys).
- Every step is a command or an action, in order, with nothing implied.
- Show the expected output, or a short excerpt of it, after the key command so the reader knows it worked.
- Use real values or obvious placeholders: `YOUR_API_KEY`, `<project-name>`. Say where to get each one.
- Keep it under about ten steps. If it needs more, the product needs a setup script or the doc needs splitting.

Example:

````markdown
## Quickstart

Requires Node.js (the version listed under `engines` in `package.json`).

```sh
npm install -g acme-cli
acme init my-site
cd my-site && acme dev
```

Open http://localhost:3000. You should see the starter page.
````

## 5. Examples

- Every non-trivial feature gets at least one example, placed next to its description.
- Examples are complete enough to run: include imports, setup, and the call. Mark elided parts clearly with a comment.
- Show input and output together.
- Prefer one realistic example over three toy ones. `createUser({ email: "ana@example.com" })` beats `foo(bar)`.
- Use language tags on every code block (`sh`, `ts`, `json`, `toml`) so it highlights.
- Separate the command from its output; do not prefix commands with `$` if readers will copy them.

## 6. Keep docs true

- **Run every command you document**, in a fresh directory or a clean shell where possible. If you cannot run one (needs paid account, other OS), say so in your summary to the user.
- Copy flag names, config keys, defaults, and env var names from the source code or `--help`, not from memory.
- Check every relative link and anchor resolves to a file or heading that exists.
- When code changes behavior, update the docs in the same change. When you notice a doc that is wrong, fix it or report it.
- Avoid facts that rot: "currently", "new in", hard-coded version numbers in prose. Point to the changelog or use the version variable.

## 7. Plain language

- Use "you" and the imperative: "Run `make`", not "The user should run `make`".
- Short sentences. One instruction per step.
- Common words: "use" not "utilize", "start" not "initiate", "so" not "in order to".
- Define a term the first time, then use exactly that term every time. Do not alternate "workspace", "project", and "space" for one concept.
- Avoid "simply", "just", "easy", "obviously". They insult the reader who is stuck.
- Put conditions before instructions: "If you use Windows, run...".
- Use headings readers would search for. "Configure a proxy" beats "Networking considerations".
- Put warnings before the step they apply to, not after.

## 8. Reference pages

- Generate from source where possible (CLI help, schema, type definitions) so it stays complete.
- Order consistently: alphabetical, or by frequency of use, and say which.
- For each item: name, type, default, required or optional, one-line description, example.

```markdown
### `timeout`
Type: integer (seconds). Default: `30`. Optional.
Maximum time to wait for a response before failing. Example: `timeout = 120`
```

## Before you call it done

- [ ] The first screen says what it is, who it is for, and how to start.
- [ ] Each page is one kind: tutorial, how-to, reference, or explanation.
- [ ] You ran every command in a clean environment, or listed the ones you could not run.
- [ ] Flags, keys, defaults, and paths match the current source.
- [ ] Every example runs as written and shows its output.
- [ ] Links and anchors resolve.
- [ ] Placeholders are obvious and you say where to get real values.
- [ ] No "simply", "just", "easy", no marketing, no stale version claims in prose.
- [ ] Headings match what a reader would search for.
