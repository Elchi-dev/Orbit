"""/standup: Claude writes your standup from what you committed.

A Python plugin with one tool (it reads the git log) and one command (it asks
Claude to use the tool and write the standup)."""

import subprocess

from orbit_plugin import plugin


@plugin.tool("Commits in the workspace's git repository since a date, with the files they changed", read_only=True, since="string?")
def commits_since(ctx, since=None):
    since = since or plugin.settings.get("since") or "yesterday"
    args = ["git", "log", f"--since={since}", "--no-merges", "--stat", "--format=%n%h %ad %an%n%s%n%b", "--date=short"]
    author = (plugin.settings.get("author") or "").strip()
    if author:
        args.append(f"--author={author}")
    try:
        out = subprocess.run(args, cwd=ctx.cwd, capture_output=True, text=True, timeout=20)
    except FileNotFoundError:
        return {"content": "git is not installed.", "is_error": True}
    if out.returncode != 0:
        return {"content": out.stderr.strip() or "Not a git repository.", "is_error": True}
    return out.stdout.strip()[:20000] or f"No commits since {since}."


@plugin.command("Write my standup from the commits since yesterday")
def standup(args, workspace):
    if not workspace:
        return "Open a workspace with a git repository first."
    extra = f" Also mention: {args}." if args else ""
    return {
        "reply": "Asking Claude for your standup.",
        "send": "Use the standup__commits_since tool, then write my standup: three short sections, "
        "Yesterday, Today, Blockers, in plain words a teammate understands, grouped by what changed "
        "rather than by commit." + extra,
    }


plugin.start()
