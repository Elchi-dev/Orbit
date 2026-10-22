---
name: shell-scripts
description: Use when writing, fixing or reviewing a shell script (bash or POSIX sh), such as an install, build, deploy, backup or cleanup script, or a one-off command that deletes or moves files.
---

# Shell Scripts

Write scripts that fail loudly, quote everything, clean up after themselves, and can be run twice safely.

## Choose the shell deliberately

- Use `#!/usr/bin/env bash` when you need arrays, `[[ ]]`, `pipefail` or `local`. Use `#!/bin/sh` only if you write strictly POSIX and test with `dash`.
- macOS ships an old bash and BSD tools. If the script must run there, avoid newer bash features (associative arrays, `mapfile`, `${var,,}`) or require a newer bash explicitly, and avoid GNU-only flags (`sed -i ''` versus `sed -i`, `date -d`, `readlink -f`, `grep -P`).
- If logic needs data structures, JSON or real error handling, write it in a proper language instead.

## Header

```bash
#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'   # optional; only if you rely on it, and know it changes word splitting

usage() { echo "usage: ${0##*/} [-n] <target-dir>" >&2; exit 2; }
die()   { echo "${0##*/}: $*" >&2; exit 1; }
```

## Know the limits of set -euo pipefail

It is a safety net, not error handling. It does not trigger in these cases:
- Commands in `if`, `while`, `until` conditions, or left of `&&` / `||`. A function called in those positions runs with `-e` disabled for its whole body.
- `local x=$(cmd)` and `export x=$(cmd)`: the builtin's status masks the failure. Declare first, then assign: `local x; x=$(cmd)`.
- Command substitution in bash does not inherit `-e` unless `shopt -s inherit_errexit`.
- `((i++))` returns 1 when the result is 0 and kills the script. Use `i=$((i + 1))`.
- `pipefail` makes `cmd | head -1` fail when `cmd` gets SIGPIPE. Handle that pipeline explicitly.
- `grep` returns 1 on no match. Write `grep pattern file || true` when no match is fine.
- `set -u` fails on unset optional variables. Use `${VAR:-}` or `${VAR:-default}`.

Check important commands explicitly: `cmd || die "cmd failed"`.

## Quoting

- Quote every expansion: `"$var"`, `"$@"`, `"$(cmd)"`, `"${arr[@]}"`. Unquoted expansions split on whitespace and expand globs.
- Use `"$@"` to pass arguments through, never `$*` or `$@` unquoted.
- Use `[[ ]]` in bash; in POSIX `[ ]` quote both sides: `[ "$a" = "$b" ]`.
- Put `--` before filename arguments that might start with `-`: `rm -- "$f"`, `grep -- "$pat" "$f"`.
- Use `printf '%s\n' "$x"` instead of `echo "$x"` for arbitrary data.

## Arrays for argument lists

```bash
args=(--archive --delete)
[[ $dry_run == 1 ]] && args+=(--dry-run)
rsync "${args[@]}" -- "$src/" "$dest/"
```

Never build commands in a string and run them with `eval` or unquoted expansion. Read lines safely with `while IFS= read -r line; do ...; done < file`. Iterate files with globs (`for f in "$dir"/*.log; do [[ -e $f ]] || continue; ...`) or `find ... -print0 | xargs -0`, never `for f in $(ls)`.

## Temp files and cleanup

```bash
tmp=$(mktemp -d) || die "mktemp failed"
trap 'rm -rf -- "$tmp"' EXIT
```

- Always `mktemp`; never fixed names like `/tmp/out.txt` (races, symlink attacks, collisions).
- Set the `EXIT` trap right after creating the resource. It also runs on `set -e` exits. Add `INT TERM` handling if you need to kill child processes.
- Write output to a temp file in the same directory, then `mv` into place, so readers never see a half-written file.

## Never rm -rf with an unchecked variable

```bash
: "${target:?target is required}"
[[ -d $target ]] || die "not a directory: $target"
case $target in /|/home|/home/*/|"$HOME"|.|..) die "refusing to delete $target";; esac
rm -rf -- "${target:?}/build"
```

- `${var:?}` aborts if the variable is empty or unset, so `rm -rf "${dir:?}/"*` cannot become `rm -rf /*`.
- `cd "$dir" || exit 1` before deleting relative paths; a failed `cd` followed by `rm -rf *` deletes the wrong directory.
- Prefer deleting specific known paths over globs. Print what will be deleted in dry-run mode.

## Idempotence and dry runs

- Running the script twice must be safe: `mkdir -p`, `ln -sfn`, `cp` only if changed, check before appending to a file (`grep -qxF "$line" "$f" || printf '%s\n' "$line" >> "$f"`), `CREATE ... IF NOT EXISTS`.
- Detect existing state and skip with a message rather than failing or duplicating.
- For destructive or remote-changing scripts, add `-n`/`--dry-run` that prints actions without performing them:
  ```bash
  run() { if [[ $dry_run == 1 ]]; then printf 'would run:'; printf ' %q' "$@"; echo; else "$@"; fi; }
  run rm -- "$file"
  ```
- Parse options with `getopts` (or a simple `while [[ $# -gt 0 ]]; case ...` loop for long options). Validate required arguments and exit 2 with usage on error.

## Output and exit codes

- Messages and errors to stderr; data to stdout so the script composes in pipelines.
- Exit 0 on success, non-zero on failure, 2 for usage errors.
- Do not hide errors with `2>/dev/null` or `|| true` unless that specific failure is expected.
- Never put secrets on the command line (visible in `ps`) or echo them; read from environment or a file with restricted permissions. Avoid `set -x` around secrets.

## Check it

```bash
shellcheck script.sh            # fix warnings; disable a rule only with a comment saying why
bash -n script.sh               # syntax check
shfmt -d script.sh              # formatting, if the project uses it
```

Run it once with `--dry-run`, once for real in a scratch directory, and once more to confirm idempotence. Test with paths containing spaces and with empty or missing arguments.

## Before you call it done

- [ ] Shebang matches the features used; portability target known.
- [ ] `set -euo pipefail` with its gaps handled explicitly.
- [ ] Every expansion quoted; arrays for argument lists; no `eval`.
- [ ] Temp files from `mktemp` with an `EXIT` trap.
- [ ] Every `rm -rf` guarded with `${var:?}` and a path sanity check.
- [ ] Safe to run twice; dry-run mode for destructive actions.
- [ ] Errors to stderr, meaningful exit codes, no secrets in arguments or logs.
- [ ] `shellcheck` clean; tested with spaces in paths and missing arguments.
