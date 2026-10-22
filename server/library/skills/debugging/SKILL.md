---
name: debugging
description: Use when something fails, crashes, hangs or gives wrong results and the cause is not obvious: reproduce, narrow, form and test hypotheses one at a time, bisect, fix the root cause and add a regression test.
---

# Debugging

Work like an experimenter: observe, form one hypothesis, run one test that can disprove it, record the result. Never change code at random hoping the symptom goes away.

## 1. Read the actual error

- Read the full error message and the whole stack trace, top to bottom. Find the first frame in project code, not in the library.
- Read the log lines before the error; the first failure often causes the later ones. Look for the earliest anomaly, not the loudest.
- Copy exact text. Do not paraphrase error messages in your notes; search the codebase and dependency source for the exact string.
- Check exit codes and stderr, not just stdout: `cmd; echo "exit=$?"`.
- If there is no error, define the wrong behaviour precisely: input, expected output, actual output.

## 2. Reproduce

- Get a command that shows the failure every time. Write it down.
  ```
  npm test -- -t "parses empty header"
  pytest tests/test_dates.py::test_dst -x -vv
  curl -sS -X POST localhost:8080/api/orders -d @payload.json
  ```
- If it is intermittent, make it frequent: loop it (`for i in $(seq 50); do cmd || break; done`), add load, shrink timeouts, fix the random seed, run tests in random order or in isolation.
- Record the environment: versions of runtime and key dependencies, OS, config, env vars, data. "Works here, fails there" is a difference in one of these; diff them.
- You cannot claim a fix for a bug you cannot reproduce. If reproduction fails, add logging that will capture the next occurrence and say so.

## 3. Narrow

Shrink the search space before theorising.
- Minimise the input: cut the payload, file or test case in half repeatedly until the smallest version still fails.
- Minimise the code path: call the failing function directly from a small script or test, bypassing the UI and network.
- Find the boundary: the last point where data is correct and the first point where it is wrong. Log or assert at the midpoint and halve again.
- Check assumptions at boundaries: what is actually passed in, what is actually returned, which config file was actually loaded, which version of a module is actually imported (`node -p "require.resolve('pkg')"`, `python -c "import pkg; print(pkg.__file__, pkg.__version__)"`).

### Bisect when it used to work

If a known-good version exists, let git find the change:
```
git bisect start
git bisect bad HEAD
git bisect good v1.4.0
git bisect run ./repro.sh   # exit 0 = good, 1 to 127 = bad, 125 = skip (cannot test)
git bisect reset
```
Make `repro.sh` deterministic and fast. The same halving works on dependency versions, config changes and data: revert half, test, repeat.

## 4. Hypothesise and test one thing at a time

- Write the hypothesis as a falsifiable statement: "The cache returns a stale user because the key omits tenant ID." Then name the observation that would prove it wrong.
- Change one variable per experiment. If you change two things and it works, you do not know why.
- Prefer observation over modification: add a log line, a breakpoint or an assertion before editing logic.
- Use the debugger when state is complex: `node --inspect-brk`, `python -m pdb` or `breakpoint()`, `dlv debug`, `gdb`/`lldb`. Inspect actual values; do not infer them.
- Revert every experimental change that did not help before trying the next one. Keep the tree clean between experiments (`git stash` or `git diff` to check).
- If three hypotheses fail, step back: re-read the error, question the assumption you have not tested, and check the environment again.

## 5. Keep a log of what you ruled out

Keep short notes as you go:
```
symptom: POST /orders returns 500 only for EUR orders
repro: ./repro.sh (fails 10/10)
ruled out: DB connection (other queries fine), payload size (minimal payload fails), currency table (rows present)
hypothesis: rounding in toMinorUnits() throws for 3-decimal rates -> testing with rate 1.085
```
This prevents retesting the same idea and is what you report if you must stop before the root cause.

## Common causes to check

- Off-by-one, null or undefined, empty collection, wrong type coercion.
- Time zones, DST, locale, encoding (UTF-8 vs Latin-1, BOM, line endings).
- Caching at any layer: build cache, browser, CDN, memoisation, stale compiled output. Clean build and retry.
- Wrong file or wrong version actually running: stale process, old container, path shadowing, duplicate dependency.
- Async ordering: missing `await`, race between handlers, unhandled rejection, timers.
- Environment: missing env var, different config file, permissions, ports in use, disk full.
- State leaking between tests: shared fixtures, global singletons, test order.

## 6. Fix the root cause

- Fix where the wrong value originates, not where it is noticed. A null check at the crash site that hides bad upstream data is a second bug.
- Ask whether the same mistake exists elsewhere: search for the pattern and fix or report the siblings.
- Keep the fix minimal and separate from refactoring.

## 7. Prove it

- Write a regression test that fails before the fix and passes after. Run it both ways to confirm.
- Run the original reproduction command; for intermittent bugs, run the loop enough times to be convincing.
- Run the full relevant test suite to check nothing else broke.
- Remove temporary logging, breakpoints and debug flags.

## Report

State: the symptom, the root cause (with file and line), why it happened, the fix, the regression test, and what was ruled out. If unresolved, state the reproduction, what was ruled out, the current best hypothesis and the next experiment.

## Before you call it done

- [ ] The failure was reproduced with a written-down command.
- [ ] The root cause is identified and explained, not just the symptom suppressed.
- [ ] A regression test fails without the fix and passes with it.
- [ ] The original reproduction now passes, repeatedly if the bug was intermittent.
- [ ] Full relevant test suite passes.
- [ ] Experimental changes and debug output are removed.
- [ ] Notes record what was ruled out.
