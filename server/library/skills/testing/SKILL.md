---
name: testing
description: Use when writing, fixing or reviewing automated tests, adding coverage for a bug or feature, choosing between unit, integration and end-to-end tests, or chasing a flaky test.
---

# Testing

A test exists to protect a behaviour someone relies on. Write each test so that it fails when that behaviour breaks and passes through any refactor that keeps it.

## Start by running what exists

1. Find the test command: look in `package.json` scripts, `Makefile`, `pyproject.toml`, `Cargo.toml`, `go.mod`, CI config (`.github/workflows/*.yml`), and the README. Use the command CI uses.
2. Run the full suite before you change anything. Record which tests pass, fail or skip. You need this baseline to tell your breakage from existing breakage.
3. If the suite is already red, say so and do not "fix" unrelated failures silently. Note them and carry on.
4. Learn the local conventions: file layout, naming, assertion style, fixture helpers, how mocks are done. Follow them even if you would choose differently.

## Decide what to test

Test observable behaviour through the public interface: return values, state visible to callers, emitted events, HTTP responses, files written, errors raised. Do not test private helpers, call order of internal functions, or the exact shape of intermediate data.

For each unit of behaviour, cover:
- The main success path with realistic input.
- Boundaries: empty, one, many, zero, negative, maximum, off-by-one edges.
- Invalid input and the error the caller should see (type and message that callers depend on, not the full text).
- State transitions: what changes, and what must not change.
- Every bug you fix: write a test that fails on the old code first, then fix.

Skip tests that only restate the implementation (asserting a mock was called with what the code obviously passes it), trivial getters, and framework behaviour you do not own.

## Name tests after what they protect

The name states the behaviour and the condition, so a failure reads as a bug report.

```
bad:  test_parse, test_user_2, it("works")
good: test_parse_rejects_dates_before_1970
good: it("returns 404 when the project belongs to another user")
good: TestTransfer_FailsWithoutFunds_LeavesBothBalancesUnchanged
```

One behaviour per test. Several asserts are fine when they describe one outcome. Structure the body as arrange, act, assert, with a blank line between the parts.

## Pick the level

| Level | Use for | Cost |
| --- | --- | --- |
| Unit | Pure logic, parsing, calculations, branching rules | Milliseconds, precise failures |
| Integration | Your code against a real database, filesystem, queue or HTTP layer | Seconds, catches wiring and query bugs |
| End-to-end | A few critical user journeys through the deployed shape of the system | Slow, brittle, highest confidence |

Decision rules:
- Default to the lowest level that can observe the behaviour.
- If the risk is in a SQL query, a migration, a serializer or a config binding, use an integration test with the real dependency (a container, an in-memory or temp-dir instance). A mock would only test your assumption about the dependency.
- Mock at boundaries you do not control (third-party APIs, clocks, randomness, network). Do not mock your own modules to make a test easy; that couples the test to structure.
- Keep end-to-end tests few and focused on journeys whose failure would be an outage: sign in, checkout, save and reload.

## Fixtures and test data

- Build data with small factories or builders that set sane defaults, and override only the fields the test cares about. The visible overrides tell the reader what matters.
- Each test creates what it needs and does not depend on another test having run. Order must not matter.
- Use temp directories (`tmp_path`, `t.TempDir()`, `mkdtemp`) and unique names, never shared paths in the repo or home directory.
- Wrap database tests in a transaction that rolls back, or truncate between tests. Do not rely on a pre-seeded shared database.
- Keep fixtures close to the tests that use them. A global fixture file that every test imports becomes a hidden dependency web.
- Golden or snapshot files: review every snapshot change by reading the diff. Never update snapshots in bulk to make a run green.

## Control time, randomness and concurrency

- Inject the clock, or use the framework's fake timers. Never `sleep` to wait for something; wait on a condition with a timeout.
- Seed random generators and print the seed on failure.
- Fix the timezone and locale in the test environment or in the test.
- For async code, await the actual completion signal (promise, channel, callback). Polling with a deadline is acceptable when there is no signal.

## Flaky tests

A test that passes and fails on the same code is a bug, either in the test or in the product. Treat it as one.

1. Reproduce: run it in a loop (`for i in $(seq 50); do <cmd> || break; done`), run it alone, run it in random order, run it in parallel. Most frameworks have flags for repeat, shuffle and seed.
2. Classify the cause: shared state or order dependence, timing and `sleep`, real network or external service, unseeded randomness, time of day or timezone, resource leaks (ports, files, connections), concurrency in the code under test.
3. Fix the cause. Adding retries or longer timeouts hides the problem and may hide a real race in production code.
4. If you cannot fix it now, quarantine it explicitly (skip with a reason and an issue reference) rather than leaving it to fail randomly. Report that you did so.

## When the test is wrong versus the code

When a test fails after your change, decide before editing anything:
- The test encoded the old, intended behaviour and you broke it: fix the code.
- The requirement really changed: update the test and say so in your summary.
- The test was coupled to internals that you legitimately changed: rewrite it against the behaviour.

Never weaken an assertion, delete a test, or add a skip just to get green.

## Running the suite

- While iterating, run the narrowest set: one file or one test name (`pytest path::test`, `go test -run Name ./pkg`, `npx vitest run file`, `cargo test name`).
- Before you finish, run the full suite plus the linter and type checker the project uses.
- Confirm a new test can fail: break the code briefly or check it failed before the fix. A test that has never failed has not been shown to test anything.
- Read failure output fully. The first failure is usually the cause; later ones are often fallout.

## Before you call it done

- [ ] Baseline suite result recorded before your change.
- [ ] Each new test is named after the behaviour it protects.
- [ ] Each bug fix has a test that failed before the fix.
- [ ] Tests use the lowest level that observes the behaviour; real dependencies where the risk lives.
- [ ] No `sleep`, no unseeded randomness, no shared mutable state, no network to third parties.
- [ ] Tests pass alone, together and in random order.
- [ ] Full suite, linter and type checker pass, or pre-existing failures are reported as such.
- [ ] No assertions weakened, no tests skipped or deleted without saying why.
