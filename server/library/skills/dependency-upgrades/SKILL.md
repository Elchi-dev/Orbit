---
name: dependency-upgrades
description: Use when upgrading a library, framework, toolchain or language runtime, especially across a major version, or when fixing breakage caused by an upgrade or a lockfile change.
---

# Dependency Upgrades

Upgrade one thing at a time, on a branch, with the changelog open, and fix each breakage at its cause.

## Establish the starting point

1. Confirm the working tree is clean and create a branch: `git switch -c upgrade/<package>-<target>`.
2. Run the full build, test suite, linter and type checker. Record the baseline. Pre-existing failures are not yours to explain later.
3. Find the current version actually installed, not just the declared range:
   - `npm ls <pkg>`, `pnpm why <pkg>`, `yarn why <pkg>`
   - `pip show <pkg>`, `uv tree`, `poetry show <pkg>`
   - `cargo tree -i <pkg>`, `go list -m all | grep <pkg>`, `bundle info <pkg>`
4. Find who depends on it transitively; another package may pin it or require a range.

## Read before you change

- Read the official changelog and migration or upgrade guide for every major version between current and target. Skipping one means missing its breaking changes.
- Check the target's supported runtime versions and peer dependencies. A library upgrade may force a runtime or framework upgrade first.
- Look for an official codemod or migration tool.
- Search the project's issue tracker for known regressions in the target release. Prefer the latest patch of the target line.
- Write down the breaking changes that could affect this codebase. That list drives the rest of the work.

Do not rely on memory for what changed between versions. Check the current docs.

## Find every use

```sh
rg -n "from ['\"]<pkg>|require\(['\"]<pkg>|import <pkg>|<pkg>::" --hidden -g '!node_modules' -g '!vendor'
```

- Include config files, build scripts, Dockerfiles, CI images, `.tool-versions`, `.nvmrc`, `engines`, `python_requires`, `rust-toolchain`, `go` directives.
- Cross-check each item on your breaking-change list against these uses. Mark each as affected or not.

## Upgrade in steps

- Upgrade one major version at a time when the gap spans several and each has its own migration guide.
- Upgrade one package or tightly coupled group at a time (a framework and its official plugins move together). Never bundle unrelated upgrades.
- Use the package manager to change versions so the lockfile is regenerated consistently:
  - `npm install <pkg>@<version>`, `pnpm up <pkg>@<version>`, `yarn up <pkg>@<version>`
  - `uv add <pkg>==<version>` or `poetry add <pkg>@<version>` or edit requirements and recompile the lock
  - `cargo update -p <pkg> --precise <version>` or edit `Cargo.toml`, `go get <module>@<version>`, `bundle update <gem> --conservative`
- Run the official codemod if one exists, then read its diff. Codemods miss dynamic usages and sometimes produce code that compiles but behaves differently.
- Commit the version bump plus lockfile, then the code changes it required, in reviewable steps.

## Lockfiles

- Commit lockfiles for applications. Never delete and regenerate a lockfile to resolve a conflict or an error; that silently upgrades everything else.
- On a lockfile merge conflict, take one side, then rerun the install command to reconcile.
- In CI and for verification, install exactly from the lock: `npm ci`, `pnpm install --frozen-lockfile`, `yarn install --immutable`, `uv sync --locked`, `cargo build --locked`, `bundle install` with frozen settings.
- Review the lockfile diff: unexpected new packages or many unrelated version changes mean something went wrong.

## Fix by cause, not symptom

When something breaks:
1. Read the full error and find the first failure.
2. Match it against the breaking-change list and the migration guide. Most failures are documented.
3. Apply the documented replacement API or setting.

Do not:
- Pin a transitive dependency to an old version to silence an error without understanding why.
- Add type casts, `any`, `# type: ignore`, `@ts-expect-error` or lint disables to get past new type errors.
- Wrap new exceptions in broad catches.
- Downgrade back silently. If the upgrade is blocked, stop and report why.

Deprecation warnings that appear after the upgrade are the next major's breaking changes. Fix them now if cheap, otherwise list them.

## Verify behaviour, not just the build

- Run the full test suite, type checker, linter and production build.
- Behavioural changes often pass tests: default values, timezone or locale handling, serialization formats, sort stability, HTTP client timeouts, retry defaults, logging format. Check each documented default change against your usage.
- Start the application and exercise the paths that use the dependency most.
- For runtime upgrades, also check: native extensions rebuild, Docker base images, CI matrix versions, and deployment environment versions all match.
- Run the ecosystem's vulnerability audit after the upgrade.

## Report

State: from and to versions, breaking changes that applied and how you handled each, codemods run, anything pinned or deferred and why, and any behavioural difference a user might notice.

## Before you call it done

- [ ] Branch created; baseline results recorded.
- [ ] Changelog and migration guide read for every major version crossed.
- [ ] Every use found and checked against the breaking-change list.
- [ ] Version changed through the package manager; lockfile regenerated, reviewed and committed.
- [ ] Codemod output reviewed by hand.
- [ ] Breakages fixed at their cause; no suppressions, no stray pins.
- [ ] Tests, types, lint, build and a manual run pass; frozen-lockfile install works.
- [ ] Runtime, CI and container versions consistent.
- [ ] Summary lists versions, changes made and anything deferred.
