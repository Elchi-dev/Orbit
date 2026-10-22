---
name: git-workflow
description: Use when committing, branching, rebasing, merging or resolving conflicts in a git repository, or when cleaning up history before sharing work.
---

# Git Workflow

Leave history that a reviewer can read and a bisect can trust: each commit is one logical change, builds, and passes tests.

## Look before you act

Run these before any commit, rebase or push:

```sh
git status
git branch --show-current
git log --oneline -10
git remote -v
git stash list
```

Know which branch you are on, whether it tracks a remote, and whether there is uncommitted work that is not yours. Never discard or overwrite changes you did not make (`git checkout -- .`, `git reset --hard`, `git clean -fd`) without the user's say-so.

## Branches

- Do not commit directly to `main`, `master` or a release branch unless the user asks. Create a branch: `git switch -c fix/login-timeout`.
- Name branches by intent: `fix/...`, `feat/...`, `refactor/...`, `chore/...`, or the project's own convention if it has one.
- Start from an up-to-date base: `git fetch origin && git switch -c <name> origin/main`.
- Keep a branch to one topic. Unrelated fixes go on their own branch.

## Commits in steps that each build

- Stage deliberately. Use `git add -p` or name paths. Avoid `git add -A` and `git add .` unless you have reviewed `git status` and every file belongs.
- One logical change per commit: a rename, then the behaviour change that uses it, then the test update. Not "misc fixes".
- Each commit must build and pass tests on its own. If an intermediate step would break the build, combine it with the step that fixes it.
- Formatting and whitespace changes go in a separate commit from logic changes.
- Generated files and lockfiles go in the same commit as the change that produced them.

## Commit messages

```
Reject uploads larger than the configured limit

The handler buffered the whole body before checking size, so a large
upload could exhaust memory. Check Content-Length first and stream with
a hard cap for chunked requests.

Fixes #482
```

- Subject: imperative mood ("Add", "Fix", "Remove", not "Added" or "Fixes"), about 50 characters, at most 72, no trailing period, capitalised unless the project's convention says otherwise.
- Blank line, then a body wrapped at about 72 columns.
- The body explains why and any non-obvious consequence. The diff already shows what.
- Reference issues and breaking changes in the form the project uses. If the repo uses Conventional Commits (`feat:`, `fix(scope):`), follow it; check `git log` to see.
- Write the message to a file or use `-F -` with a heredoc for multi-line messages so quoting does not mangle it.

## Check the diff before committing

```sh
git diff --staged
git diff --staged --stat
```

Read every hunk. Look for:
- Debug output, commented-out code, stray `TODO`s you added, editor files, `.DS_Store`.
- Files you did not mean to touch, including mode changes and line-ending churn.
- Secrets: API keys, tokens, passwords, private keys, `.env` files, connection strings with credentials, cloud credential files.

## Never commit secrets

- Put secrets in environment variables or a secret store; commit a `.env.example` with placeholder values.
- Ensure `.gitignore` covers `.env`, key files and local config before the first commit.
- Scan before pushing when a tool is available (`gitleaks`, `git-secrets`, `trufflehog`), or at least `git diff --staged | grep -iE 'secret|token|password|api[_-]?key|BEGIN .*PRIVATE'`.
- If a secret was committed: treat it as leaked the moment it reached any remote or shared machine. Tell the user it must be revoked and rotated first. Removing it from history (`git filter-repo`) is cleanup, not remediation, and rewrites published history, so coordinate it.

## Rebasing your own work

Rewriting history is fine while the commits are only yours and unpublished, or on a personal branch nobody else builds on.

- Update a feature branch: `git fetch origin && git rebase origin/main`.
- Tidy before review: `git commit --fixup=<sha>` then `git rebase --autosquash origin/main`. Interactive rebase needs an editor; in a non-interactive shell set `GIT_SEQUENCE_EDITOR=:` to accept the autosquash plan.
- After rebasing a branch you already pushed, use `git push --force-with-lease` (add `--force-if-includes` when your git supports it). Never plain `--force`.
- Run the tests again after every rebase. A clean rebase can still produce broken code.

## Never rewrite published shared history

Do not rebase, amend, reset or force-push `main`, release branches, tags, or any branch others have pulled. To undo a published commit, use `git revert <sha>`, which adds a new commit. If the user asks you to rewrite shared history, state the consequence (everyone must reset their clones) and get explicit confirmation.

## Resolving conflicts

1. `git status` lists conflicted files. Open each and find every `<<<<<<<` block.
2. Understand both sides. `git log --merge -p <file>` or `git diff <base>...<other> -- <file>` shows why each side changed. Setting `merge.conflictStyle=zdiff3` shows the common ancestor too.
3. Produce the code that keeps both intents. Taking one side wholesale (`--ours`/`--theirs`) is right only when you know the other side's change is obsolete.
4. Check for semantic conflicts that git did not flag: a function renamed on one side and called by its old name on the other.
5. Remove all markers (`git diff --check` and `grep -rn '^<<<<<<<\|^>>>>>>>' .`), build, run tests, then `git add` and `git rebase --continue` or `git commit`.
6. If it goes wrong, `git rebase --abort` or `git merge --abort` returns to the start. `git reflog` recovers lost commits.

## Merge or rebase into the base

Follow the project's policy (check contributing docs and recent `git log --graph`). Squash merges suit branches with messy history; rebase or merge commits suit branches whose commits each stand alone.

## Before you call it done

- [ ] On the intended branch, not the default branch unless asked.
- [ ] `git diff --staged` read in full; no secrets, debug code or stray files.
- [ ] Each commit is one logical change and builds; tests pass at the tip.
- [ ] Messages have an imperative subject and a body that says why.
- [ ] No published shared history rewritten; any force push used `--force-with-lease`.
- [ ] Conflicts resolved with both intents kept, no markers left, tests rerun.
- [ ] `git status` is clean or the remaining changes are explained.
