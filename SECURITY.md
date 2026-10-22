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

**AI-built widgets.** They run in a sandboxed frame with a content policy that
allows no network access and no access to Orbit's page.

## What Orbit does not protect against

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
