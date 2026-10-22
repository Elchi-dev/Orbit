# Security

Orbit gives a language model a shell on your computer. This page says what
stands between the two, what does not, and how to report a problem.

## Reporting

Please do not open a public issue for a security problem. Use GitHub's private
vulnerability reporting on this repository (Security, Report a vulnerability)
with the version (`orbit --version`), your system and the steps. You get an
answer within a week.

## What Orbit protects against

**Other websites driving your agent.** The server listens on `127.0.0.1` only.
Opening the page sets a random session cookie (`HttpOnly`, `SameSite=Strict`);
every API call and the WebSocket require it. Requests whose `Host` is not
localhost are refused, which stops DNS rebinding, and requests whose `Origin`
is another site are refused.

**Actions you did not want.** Every action passes the gate
([docs/PERMISSIONS.md](docs/PERMISSIONS.md)): read-only detection, your rules,
then you or the judge. The judge fails closed: an error or a timeout means
Orbit asks you.

**Instructions hidden in files and web pages** (prompt injection). File
contents, command output and fetched pages are data. Claude's system prompt
says so, and the judge sees them inside an untrusted block, together with your
actual goal, and is told to refuse actions that look like they came from that
content. This lowers the risk; no model-based check removes it. Rules and
Manual mode are the hard limits.

**Rules being stretched.** A rule wildcard never crosses a shell operator, so
an allow rule for one command cannot be extended with `;`, `&&`, `|` or `$()`.

**Leaking the key.** The API key is encrypted on disk (AES-256-GCM, master key
in `~/.orbit/master.key`, mode 0600), is sent only to the Anthropic API and
never to the browser, and is never logged.

**Mission webhooks.** `POST /hook/<token>` starts a mission without the
session cookie; the 20-character random token in the path is the key, and the
server still only listens on loopback and checks the `Host`. A mission runs
unattended, so it can only do what your rules (or the judge) allow, and it
never waits for an answer. Delete the mission to retire its token.

**Opening files in your editor.** The server only opens paths inside the
workspace's folder, starts the editor's own command as an argument list (never
through a shell), and only editors from the catalog.

**AI-built widgets.** They run in a sandboxed frame with a content policy that
allows no network access and no access to Orbit's page.

## What Orbit does not protect against

- **MCP servers.** A server you add runs as you (a local command) or is a
  service you trust with the token you give it. Its tool calls pass the gate,
  but what the server does with them is up to the server. Tools it marks
  read-only skip the gate unless you set `trust_readonly = false` for it.
  Tokens for MCP servers are stored in `orbit.toml` in plain text.
- **Project instruction files.** `AGENTS.md`, `CLAUDE.md` and editor rules in a
  workspace folder go into Claude's instructions. A repository you cloned from
  someone else can say anything there; switch it off in Settings, Integrations,
  for folders you don't trust. The gate still applies.

- **Anything you allow.** Orbit runs as you. An allowed command can do what
  you can do. If you need isolation, run Orbit inside a VM or a container.
- **Shell commands are not journaled.** Undo covers Orbit's own file tools
  only. `rm`, `sed -i` and builds change files directly.
- **Other local users and programs.** Anyone who can read your home folder can
  read `~/.orbit`, including the master key next to the encrypted API key.
- **A judge that is wrong.** It is a model. Use rules for anything that must
  never happen (`deny git push --force*`) and Manual or Rules mode where a
  mistake would be expensive.
- **Binding to another address.** Setting `host = "0.0.0.0"` exposes the
  agent to your network, protected only by the session cookie. Don't, until
  the phone companion ships with pairing.

## Supported versions

Only the latest release gets fixes.
