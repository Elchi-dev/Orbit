---
name: refactoring
description: Use when restructuring code without changing what it does: renaming, extracting or inlining functions and modules, removing duplication or dead code, or preparing code for a feature.
---

# Refactoring

Refactoring changes structure and leaves behaviour exactly as it was. If behaviour changes, it is not a refactor, and it goes in a separate step.

## Set the goal and the boundary

- State the concrete goal in one line: "extract the retry logic so the upload path can reuse it", not "clean up".
- List what is in scope and stop at that boundary. Note other smells you see, but do not fix them in this change.
- Identify the public surface: exported functions, HTTP routes, CLI flags, config keys, database schema, serialized formats, event names. Changing any of these is a behaviour change for someone. Keep them stable or treat the change as a migration.

## Tests first

1. Run the full suite and record the result before touching anything.
2. Check that tests actually cover the code you will move. Read them or use the coverage tool.
3. If coverage is thin, write characterization tests first: call the code with representative inputs and assert the current outputs, including odd ones. They pin today's behaviour, bugs included.
4. If you find a bug, write it down. Do not fix it inside the refactor; fix it before or after in its own commit, so the refactor stays provably neutral.
5. Tests that reach into internals will break on a pure refactor. Rewrite them against the public behaviour in a first, separate step.

## Small steps, always green

Work in steps small enough that the suite passes after each one:
- Make one change. Build. Run the relevant tests. Commit.
- If a step turns red and the cause is not obvious within a few minutes, revert it (`git checkout -- <files>` for your own uncommitted edits, or `git reset --hard HEAD` only when everything uncommitted is yours) and take a smaller step.
- For a wide change, use parallel change: add the new form, migrate callers in batches, then remove the old form. Each phase is releasable.

## One kind of change per commit

Do not mix in one commit:
- Renames or moves with logic edits.
- Formatting with anything else.
- Refactors with behaviour changes or bug fixes.
- Dependency upgrades with anything else.

A reviewer should be able to read a rename commit as "only names changed" and a move as "only locations changed". `git diff -M --stat` and `git show --color-moved` help confirm a move is a pure move.

## Renames

- Use the language server or IDE rename when available; it understands scope. Otherwise search exhaustively:
  ```sh
  rg -n --hidden -g '!node_modules' -g '!.git' '\bold_name\b'
  ```
- Search beyond code: string references, reflection, dependency injection keys, templates, SQL, config files, docs, tests, scripts, CI files.
- For exported names others consume, keep a deprecated alias that forwards to the new name, and remove it later.
- Renaming a file: use `git mv` and update every import path; run the type checker or build to catch misses.

## Extracting and inlining

- Extract function: move a coherent block, pass in what it reads, return what it produces. Avoid passing a large context object just to save parameters.
- Name the extracted piece for what it does, not how or where it is used.
- Extract module: move related functions together, then fix imports. Watch for import cycles; if one appears, the boundary is wrong.
- Inline when a wrapper adds a name but no meaning, or when an abstraction has a single caller and no prospect of a second.
- Do not introduce a generic abstraction for two similar call sites unless they change for the same reason. Duplication is cheaper than the wrong abstraction.

## Deleting dead code

Before deleting, prove it is unused:
- Search for every reference, including dynamic ones: string-based dispatch, reflection, plugin registries, routes declared in config, serialization by name, exported package API.
- Check whether external callers exist: public library exports, HTTP endpoints, CLI commands, scheduled jobs.
- Use tooling where present (`ts-prune`, `knip`, `vulture`, `deadcode`, compiler unused warnings).
- Delete in its own commit, so it is easy to revert. Do not comment code out; history keeps it.
- Remove the tests, fixtures, config and docs that only served the deleted code.

## Keep behaviour identical

Watch for changes that look structural but are not:
- Evaluation order and side effects when you reorder or extract expressions.
- Short-circuiting lost when conditions are split or combined.
- Exceptions: a different type, message or point of failure is a behaviour change if callers catch it.
- Default arguments, mutable defaults, and shared state captured by closures.
- Performance-sensitive paths: an extra query in a loop or a lost cache is a regression.
- Logging, metrics and event emission that other systems consume.

## When to stop

Stop when the stated goal is met and the suite is green. Also stop and report when:
- The next step requires changing the public surface or behaviour.
- Coverage is too weak to proceed safely and adding it is a larger task than the refactor.
- The diff has grown beyond what one reviewer can read in one sitting; split the rest into follow-ups.

## Before you call it done

- [ ] Goal stated; changes stay within scope.
- [ ] Baseline suite result recorded; characterization tests added where coverage was thin.
- [ ] Every commit builds and passes tests, and contains one kind of change.
- [ ] No behaviour change mixed in; bugs found are reported or fixed separately.
- [ ] Renames and deletions searched across code, config, strings, docs and scripts.
- [ ] Public surface unchanged, or deprecations added and stated.
- [ ] Full suite, type checker and linter pass at the end.
- [ ] Summary lists what moved, what was deleted and anything left for later.
