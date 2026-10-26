# Security

<p align="center"><img src="docs/images/ori/reading.svg" width="120" alt="Ori looking closely through a magnifying glass"></p>

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
is anything but Orbit's own page are refused, including pages on other local
ports: cookies are not tied to a port, so a dev server's page would otherwise
share the session (fixed in 0.3.0; before, any localhost origin was accepted).

**Pages Claude builds.** The live preview serves them from a separate,
read-only server on another port, under a random token per workspace, and
never outside the workspace folder. Being another origin, they can't call
Orbit's API. A page drawn while it is being written runs no scripts at all.
Dev servers are shown through a proxy that also binds to loopback, on its own
port, so they are another origin as well. The comment script Orbit adds to
previewed pages talks to Orbit only by `postMessage`, opens no connection and
can only switch comment mode and draw pins.

**Helpers.** A helper gets its parent's approval mode, never a looser one, and
passes the same gate. Folder limits are enforced by the gate for Orbit's file
tools; shell commands in a helper are judged like any other command, not
confined to its folders. Worktrees live inside the repository under
`.orbit/worktrees` and are removed when you discard the helper or delete its
workspace.

**Images on the whiteboard** are served from `~/.orbit/assets`, from your
screenshots, or from the workspace folder (images only, nothing outside it),
with a content policy that lets an SVG run nothing.

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

**Your phone and the relay.** Phones reach Orbit only through the relay, over
a session encrypted end to end with keys agreed when you scanned the pairing
code (X25519, HKDF-SHA256, AES-256-GCM, a counter per direction so frames
can't be replayed or reordered). The relay sees which room and how much, never
what. A phone has to be paired, with a one-time code that expires after ten
minutes, and can be removed in Settings, Your phone; a phone can't reach the
key, remote or plugin settings, or change the config. Alerts are sealed the same way, so
Firebase carries them without being able to read them. The relay token only
lets Orbit register with your relay; it gives no access to Orbit.

**Plugins.** A plugin never gets the API key: `ANTHROPIC_*` variables are
removed from its environment and model calls go through Orbit, counted in
your budget. Its permissions in `orbit-plugin.json` decide which of Orbit's
calls it may make, it starts switched off when installed, and its secrets
(settings of type `secret`) are encrypted like the key.

**MCP server tokens.** Values in a server's environment and headers are kept
in the encrypted store; `orbit.toml` only says they are there.

**AI-built widgets.** They run in a sandboxed frame with a content policy that
allows no network access and no access to Orbit's page.

## What Orbit does not protect against

- **MCP servers.** A server you add runs as you (a local command) or is a
  service you trust with the token you give it. Its tool calls pass the gate,
  but what the server does with them is up to the server. Tools it marks
  read-only skip the gate unless you set `trust_readonly = false` for it.
  Tokens for MCP servers are stored in `orbit.toml` in plain text.
- **Plugins.** A plugin runs as you, like any program you install; its
  permissions limit what it may ask Orbit for, not what it can do on your
  computer. Install only plugins you trust, and read what one asks for before
  switching it on.
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
  agent to your network, protected only by the session cookie. Don't: for
  your phone, use the relay, which needs nothing open on your network.
- **A lost or stolen phone.** It can reach Orbit until you remove it in
  Settings, Your phone. Use a screen lock.

## Supported versions

Only the latest release gets fixes.
