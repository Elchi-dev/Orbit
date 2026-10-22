---
name: code-review
description: Use when reviewing a diff, pull request, branch or existing codebase: finding real defects in order of severity, verifying them by running code, and writing findings with concrete failure scenarios.
---

# Code Review

The goal is to find what will break, leak, corrupt or mislead, and to say so precisely. A review with three proven bugs beats one with thirty style remarks.

## Set up

1. Establish scope: which commits, files or modules. For a branch: `git diff --stat main...HEAD`, then `git log --oneline main..HEAD`.
2. Read the description, linked issue and tests first to learn what the change claims to do. Review against that intent.
3. Read the full diff, then the surrounding code of every changed function. Bugs often live in what the change did not touch: other callers, the other branch of a condition, the matching cleanup.
4. Find the callers of changed functions (`grep -rn "functionName(" src/`) and check each still works with the new behaviour.
5. Install and run the project's own checks: build, type check, linter, tests. Note what fails before you start forming opinions.

## What to look for, in order of severity

1. Security: injection (SQL, shell, path traversal, HTML or template), missing authentication or authorisation checks, secrets in code or logs, unsafe deserialisation, SSRF, insecure defaults, user input reaching `eval`, `exec` or a shell.
2. Data loss and corruption: missing transactions, partial writes, races on shared state, wrong migrations, destructive operations without guards, lost updates, incorrect cache invalidation.
3. Correctness: logic errors, off-by-one, wrong conditions, unhandled null or empty, wrong units or time zones, integer overflow, floating point money, error paths that swallow or mis-handle failures, promises not awaited, resources not closed.
4. Concurrency and lifecycle: shared mutable state, re-entrancy, retries without idempotency, timeouts missing, event listeners and subscriptions not removed.
5. Contract and compatibility: public API or schema changes that break callers, changed defaults, config or env vars renamed without migration.
6. Performance with real consequence: N+1 queries, unbounded loops or memory over user-controlled size, blocking calls on hot paths, missing pagination.
7. Tests: does a test fail if the change is reverted? Are edge cases and error paths covered? Do tests assert behaviour, not implementation details? Are any tests skipped or weakened?
8. Design and maintainability: unnecessary complexity, duplication of existing helpers, misleading names, dead code, comments that contradict the code.

Stop going deeper on lower categories while higher ones have unresolved findings.

## Verify, do not speculate

A finding you have not checked is a question, not a finding.
- Reproduce suspected bugs: write a small failing test or a script that calls the function with the problematic input, and run it.
  ```
  node -e "const {parse} = require('./dist/parse'); console.log(parse(''))"
  python -c "from app.dates import to_utc; print(to_utc('2026-03-29T02:30', 'Europe/Berlin'))"
  ```
- Check claims in the description: if it says "handles empty input", try empty input.
- Before saying "this is never called" or "this is unused", search for it, including dynamic access and config.
- Before saying "this library does X", read its docs or source for the version in the lockfile.
- If you cannot verify (needs production data, external service), say so and label the finding as unverified with what would confirm it.

## Writing findings

Each finding has:
- Severity: blocker, major, minor, or nit.
- Location: `path/to/file.ts:142` (and the function name).
- What happens: the concrete failure scenario. Input or sequence of events, then the wrong result. "If two requests update the same order concurrently, the second `save()` overwrites the first's `status`, because the read and write are not in a transaction."
- Evidence: the test, command or output that shows it, or the exact lines that prove it.
- Fix: a specific suggestion, with a short code snippet if it helps. Offer it, do not rewrite the change.

Example:
```
[major] src/billing/invoice.ts:88 computeTotal()
A fixed discount is subtracted after tax, so a 100.00 item with 20% tax and a 10.00 voucher
totals 110.00; docs/billing.md says discounts apply to the subtotal, giving 108.00.
Verified: added test `applies voucher before tax`, fails with expected 108.00, received 110.00.
Fix: subtract the discount from the subtotal before calling applyTax().
```
Keep findings factual; if the expected behaviour is a policy question, ask it explicitly rather than asserting.

Order findings by severity. Start the review with a two or three line summary: overall verdict (approve, approve with fixes, request changes), the most important issue, and what you verified by running.

## What not to do

- Do not nitpick formatting that a formatter or linter handles. If the project has no formatter, mention it once.
- Do not demand personal style preferences, renames for taste, or rewrites of code the change did not touch.
- Do not pad the review with praise or with generic advice ("consider adding more tests").
- Do not report the same pattern ten times; report it once and list the locations.
- Do not mark something a bug because it is unfamiliar. Check first.
- Do not block on nits. Label them `nit:` so the author can ignore them.
- Do not change the code under review unless asked; the deliverable is the review.

## Reviewing a whole codebase

- Start with the entry points, request handlers, auth, data access and anything that touches files, shell or network.
- Run the test suite and note coverage gaps in risky areas.
- Search for known hazard patterns: `eval(`, `exec(`, `shell=True`, `innerHTML`, `dangerouslySetInnerHTML`, string-built SQL, `TODO`, `FIXME`, `catch {}` or `except: pass`, hardcoded credentials.
- Check dependency health with the ecosystem's audit tool (`npm audit`, `pip-audit`, `cargo audit`) and report only issues that are reachable.

## Before you call it done

- [ ] Full diff read, plus callers and surrounding code of every changed function.
- [ ] Build, type check, lint and tests run; results stated.
- [ ] Security, data integrity and correctness checked before anything else.
- [ ] Every blocker and major finding verified by a test, script or exact code citation, or marked unverified.
- [ ] Each finding has severity, file and line, failure scenario and a fix.
- [ ] No style nits that tooling covers; nits labelled as nits.
- [ ] Summary with verdict at the top.
