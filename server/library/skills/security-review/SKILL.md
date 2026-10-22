---
name: security-review
description: Use when reviewing code, a diff or a design for security problems such as injection, broken access control, secrets exposure, SSRF, XSS or CSRF, or when asked whether something is safe to ship.
---

# Security Review

Find issues an attacker can actually exploit, show how, and give a fix. A finding without a plausible attack path is a note, not a vulnerability.

## Map the system first

1. Identify entry points: HTTP routes, RPC handlers, CLI arguments, message consumers, file uploads, webhooks, scheduled jobs reading external data, environment and config.
2. Identify trust boundaries: where data crosses from a less trusted party (browser, other tenant, third-party API, uploaded file, another service) into code that acts on it.
3. Identify sensitive sinks: database queries, shell execution, filesystem paths, outbound HTTP, HTML rendering, deserializers, template engines, redirects, logging, crypto, permission checks.
4. Trace each untrusted input from entry to sink. Note where it is validated, encoded or authorized, and where it is not.

Prioritise code that handles authentication, money, personal data, file access and admin functions.

## Injection

All injection has one fix: keep data out of the code channel. Validation helps; it is not the fix.

- SQL: look for string concatenation or interpolation into queries, including ORDER BY, LIMIT, table and column names. Fix with parameterized queries; allowlist identifiers that cannot be parameterized.
  ```python
  bad:  db.execute(f"SELECT * FROM users WHERE email = '{email}'")
  good: db.execute("SELECT * FROM users WHERE email = %s", (email,))
  ```
- Shell: look for `system`, `exec`, `popen`, `subprocess(..., shell=True)`, backticks, `child_process.exec`. Fix by calling the program with an argument array and no shell, and put `--` before user-supplied arguments so a value starting with `-` is not read as an option.
- Path traversal: look for user input joined into a path. Fix by resolving the full path (realpath, following symlinks) and checking it is inside the allowed base directory; reject absolute paths and `..`; prefer generated IDs over user filenames.
- Also check: template injection, LDAP, XPath, NoSQL operator injection (`{"$gt": ""}`), header and log injection (CR/LF), unsafe deserialization (`pickle`, Java native, YAML full loaders) of untrusted data.

## Authentication and authorization

Broken access control is the most common serious finding. Check every handler, not just the obvious ones.

- Is there an authorization check on every route that reads or changes data, enforced on the server?
- Is the object looked up scoped to the caller? `GET /invoices/:id` must check that the invoice belongs to the caller's account (IDOR).
- Can a user set fields they should not, through mass assignment (`role`, `is_admin`, `owner_id`)?
- Are admin and internal endpoints reachable from outside?
- Passwords hashed with a slow, salted algorithm designed for passwords (argon2id, scrypt, bcrypt); never fast hashes. Check current OWASP guidance for parameters.
- Session tokens random, long, rotated on login, invalidated on logout, sent only in `Secure; HttpOnly` cookies with a `SameSite` attribute.
- Comparisons of secrets and tokens are constant time.
- JWTs: algorithm pinned on verify, signature verified, expiry checked, `none` rejected.
- Rate limiting on login, password reset and token endpoints.

## Secrets handling

- No secrets in source, tests, fixtures, client bundles, container images, or logs. Search: `rg -n -i 'api[_-]?key|secret|token|password|BEGIN .*PRIVATE KEY'`.
- Secrets come from environment or a secret store, are scoped to least privilege, and can be rotated.
- Error messages and logs do not echo credentials, tokens, full request bodies or personal data.
- Anything shipped to a browser or mobile app is public.

## SSRF

Any feature that fetches a URL the user influences (webhooks, link previews, imports, image proxies) can be aimed at internal services and cloud metadata endpoints.

- Prefer an allowlist of hosts; build the URL yourself from a validated host rather than accepting a full URL.
- If destinations must be arbitrary: resolve the name, reject every resolved address in loopback, private, link-local, unique-local and metadata ranges, then connect to that validated IP (prevents DNS rebinding).
- Disable automatic redirect following, or revalidate each hop.
- Restrict schemes to `https` (and `http` if required). Reject `file:`, `gopher:` and others.
- Network egress rules are the strongest control; recommend them.

## XSS and CSRF

- XSS: find every place untrusted data reaches HTML, attributes, URLs, inline scripts or styles. Look for `innerHTML`, `dangerouslySetInnerHTML`, `v-html`, `|safe`, `{{{ }}}`, `document.write`, and `href` from user data (blocks `javascript:` only if validated). Fix with context-aware output encoding from the framework, sanitize HTML that must be rendered with a maintained sanitizer, and recommend a strict Content Security Policy.
- CSRF: state-changing requests must not be GET. For cookie-authenticated endpoints, check for framework CSRF protection, synchronizer or signed double-submit tokens, or Fetch Metadata (`Sec-Fetch-Site`) checks with an Origin fallback. `SameSite` cookies are defense in depth, not the only control. XSS defeats CSRF defenses.
- CORS: `Access-Control-Allow-Origin` reflecting any origin together with credentials is a finding.

## Dependency and supply chain risk

- Run the ecosystem's audit (`npm audit`, `pip-audit`, `cargo audit`, `govulncheck`, `osv-scanner`) and check whether the vulnerable code path is actually reachable.
- Lockfile present and committed; CI installs from it exactly.
- New dependencies: maintained, widely used, name not a typo of a popular package, no install scripts doing unexpected things.
- CI: third-party actions pinned to a commit SHA, tokens with minimum permissions, no secrets exposed to builds from forks.

## Other checks worth a pass

Open redirects, file upload type and size limits, XML external entities, weak randomness for tokens, missing TLS verification (`verify=False`, `rejectUnauthorized: false`), verbose errors in production, debug endpoints left enabled.

## Report each finding

```
[High] IDOR in invoice download
Where: api/invoices.ts:42 (GET /invoices/:id/pdf)
Exploit: logged in as any user, request /invoices/1001/pdf, then 1002, ...;
  the handler loads by id without checking account_id, so you receive
  other customers' invoices.
Fix: load with WHERE id = ? AND account_id = ? from the session; return 404
  on miss. Add a test that a second account gets 404.
```

- Severity from impact and ease: Critical (remote, unauthenticated, data or code execution), High, Medium, Low, Info.
- Give file and line, the concrete exploit steps or request, and a specific fix. Include a test that would catch a regression.
- Separate confirmed findings from suspicions you could not verify, and say what would confirm them.
- Do not run exploits against systems you have not been asked to test.

## Before you call it done

- [ ] Entry points, trust boundaries and sinks listed.
- [ ] Every untrusted input traced to its sinks.
- [ ] Authorization checked on every handler, including object ownership.
- [ ] Injection, SSRF, XSS, CSRF, secrets and dependencies each reviewed.
- [ ] Each finding has location, severity, exploit scenario and fix.
- [ ] Suspected versus confirmed issues stated clearly; nothing exploited without permission.
