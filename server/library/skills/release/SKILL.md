---
name: release
description: Use when asked to ship, cut, tag or publish a new release of a project: choosing the version, writing the changelog and release notes, building, publishing and verifying it.
---

# Release

A release is done when a user can install the published artifact and it works, not when the tag exists. Work through the steps in order. Stop and report if any check fails; do not paper over it.

## 1. Learn how this project releases

Before changing anything, read:

- `CONTRIBUTING.md`, `RELEASING.md`, `docs/` for a documented process. If one exists, follow it over this skill.
- CI workflows (`.github/workflows/`, `.gitlab-ci.yml`) for jobs triggered by tags or releases. Many projects publish automatically on tag push; you must know before you push.
- The package manifest(s) for where the version lives: `package.json`, `pyproject.toml`, `Cargo.toml`, a `VERSION` file, a constant in source. There may be several.
- Recent tags (`git tag --sort=-creatordate | head`) for the tag format (`v1.4.0` or `1.4.0`).
- The existing `CHANGELOG.md` format.

Confirm with the user before any step that is public and hard to undo: pushing a tag, publishing to a registry, creating a public release.

## 2. Decide the version

List the changes since the last tag:

```sh
git log --oneline <last-tag>..HEAD
git diff --stat <last-tag>..HEAD
```

Apply Semantic Versioning (MAJOR.MINOR.PATCH) to the public API, which includes CLI flags, config keys, file formats, and documented behavior:

- **MAJOR**: any backward-incompatible change. Removed or renamed options, changed defaults that alter behavior, dropped platform or runtime support.
- **MINOR**: new backward-compatible functionality, or a deprecation.
- **PATCH**: backward-compatible bug fixes only.
- `0.y.z`: initial development, anything may change; by convention breaking changes bump MINOR. Once people rely on it in production, it should be `1.0.0`.
- Pre-releases: `2.0.0-rc.1`, `2.0.0-beta.2`. They sort before `2.0.0`.
- Never reuse or move a published version. A mistake gets a new version.

When unsure whether a change is breaking, treat it as breaking or ask.

## 3. Write the changelog for users

Follow the Keep a Changelog shape:

```markdown
## [1.5.0] - 2026-10-23

### Added
- `--dry-run` flag for `sync` shows what would change without writing.

### Changed
- `sync` now skips hidden files by default. Pass `--include-hidden` for the old behavior.

### Deprecated
- `legacy_mode` config key; it will be removed in 2.0.0.

### Fixed
- Crash when the config file was empty (#412).

### Security
- Updated the YAML parser to fix an unsafe-load issue.
```

- Sections: Added, Changed, Deprecated, Removed, Fixed, Security. Omit empty ones.
- Newest release first. Keep an `## [Unreleased]` section at the top if the project uses one, and move its entries into the new version.
- Dates in ISO format, `YYYY-MM-DD`.
- Write what changed for the user and what they must do, not the commit message. "Fix race in worker pool" becomes "Fixed jobs occasionally running twice under heavy load."
- Every breaking change states the migration step.
- Do not dump the git log. Leave out refactors, CI tweaks, and internal changes unless they affect users.
- Update compare links at the bottom if the file has them.

## 4. Bump, test, build

1. Update the version in every place it lives. Search for the old version string to catch stragglers: `grep -rn "1.4.2" --exclude-dir=node_modules --exclude-dir=.git`.
2. Update lockfiles if the version is recorded there.
3. Run the full test suite, linters, and type checks locally. All green, no skipped failures.
4. Build the release artifacts exactly as CI does (same command, clean checkout or clean build directory).
5. Inspect the artifact: list package contents (`npm pack --dry-run`, `tar tzf`, `unzip -l`, `python -m build` then check the wheel). Confirm no secrets, no stray large files, and that required files are present.
6. Commit as `Release 1.5.0` (or the project's convention).

## 5. Tag and publish

- Create an annotated tag on the release commit: `git tag -a v1.5.0 -m "v1.5.0"`. Sign it if the project signs tags.
- Push the commit, then the tag. Watch the CI release job to completion.
- If publishing manually, publish the exact artifact you inspected.
- Create the release on the hosting platform with release notes.

Release notes are the changelog entry plus, at the top, two or three lines on the highlights and any action required: "Breaking: `sync` skips hidden files by default. See Changed." Include upgrade instructions and checksums if the project publishes binaries.

## 6. Install from the published artifact and smoke test

In a clean environment (fresh directory, temp virtualenv, container), not your working tree:

```sh
npm install -g acme-cli@1.5.0   # or pip install acme==1.5.0, or download the binary
acme --version                  # prints 1.5.0
acme init demo && acme sync --dry-run
```

- Check the version string matches.
- Run the main path a new user would take, plus one thing that changed in this release.
- For binaries, verify on each platform you can reach and check the published checksums.
- Confirm docs or install instructions that reference the version are correct.

## 7. Rollback plan

Know this before you publish:

- **Registry packages**: most registries forbid reusing a version. The fix is a new patch release. Deprecate or yank the bad version (`npm deprecate`, PyPI yank, `cargo yank`) so new installs avoid it.
- **Tags and releases**: if the tag is pushed but nothing was published, you may delete it (local and remote) with the user's approval. Once published, leave it and ship a fix.
- **Deployed services**: identify the previous version and the exact command to redeploy it, and any data migration that cannot be reversed.
- Write the plan down in your summary: what you would run and what users would see.

## Before you call it done

- [ ] You followed the project's own release process where one exists.
- [ ] The version follows semver given the actual changes; breaking changes bump MAJOR (or MINOR in 0.x).
- [ ] The version is updated everywhere; no old version string remains.
- [ ] The changelog is written for users, dated, and gives migration steps.
- [ ] Tests, lint, type checks, and build passed from a clean state.
- [ ] Artifact contents were inspected before publishing.
- [ ] Public, irreversible steps were confirmed with the user.
- [ ] You installed the published artifact in a clean environment and the smoke test passed.
- [ ] Release notes lead with highlights and required actions.
- [ ] The rollback plan is written down.
