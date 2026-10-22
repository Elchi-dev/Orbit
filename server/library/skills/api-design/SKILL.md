---
name: api-design
description: Use when asked to design, review or extend an HTTP/JSON API: endpoints, request and response shapes, errors, pagination, versioning, auth, rate limits, or its reference documentation.
---

# API Design

Design for the client developer who will read your docs once, then rely on the API behaving the same way everywhere. Consistency beats cleverness. When extending an existing API, follow its conventions even where you would choose differently.

## 1. Resources and naming

- Name resources as nouns, not actions: `/invoices`, `/invoices/{id}`, `/customers/{id}/invoices`.
- Plural collection names. Lowercase, hyphenated paths: `/payment-methods`.
- Nest at most one level; beyond that, use a filter: `/invoices?customer_id=cus_123`.
- IDs are opaque strings. A type prefix (`inv_`, `cus_`) helps debugging. Never expose sequential database IDs if enumeration is a concern.
- Pick one JSON field case (`snake_case` or `camelCase`) and use it everywhere, including errors and query params.
- Timestamps in RFC 3339 / ISO 8601 UTC: `"2026-10-23T14:05:00Z"`. Money as integer minor units plus currency: `{"amount": 1999, "currency": "EUR"}`.
- For operations that do not fit CRUD, use a sub-resource action: `POST /invoices/{id}/send`. Keep these rare.

## 2. Methods and status codes

| Method | Use | Idempotent | Success |
| --- | --- | --- | --- |
| GET | Read | Yes | 200 |
| POST | Create, or run an action | No | 201 + `Location` header, or 200 / 202 |
| PUT | Replace whole resource | Yes | 200 or 204 |
| PATCH | Partial update | Not guaranteed | 200 |
| DELETE | Remove | Yes | 204 (or 200 with body) |

Status codes to use:

- `400` malformed request or validation failure. `422` if you separate syntax errors from semantic ones; pick one convention.
- `401` missing or invalid credentials. `403` authenticated but not allowed. `404` not found (also for resources the caller may not know exist).
- `409` conflict (duplicate, version mismatch). `412` failed `If-Match` precondition.
- `429` rate limited, with `Retry-After`.
- `500` unexpected server error, `503` temporarily unavailable, with `Retry-After` when known.
- `202` accepted for async work, returning a job resource the client can poll.

Never return `200` with an error in the body.

## 3. Errors with one shape

Use Problem Details (RFC 9457, `application/problem+json`) or one equivalent shape for every error:

```json
{
  "type": "https://api.example.com/errors/validation",
  "title": "Invalid request",
  "status": 422,
  "detail": "2 fields failed validation.",
  "instance": "/invoices",
  "request_id": "req_8f2c",
  "errors": [
    { "field": "due_date", "code": "in_past", "message": "Must be today or later." }
  ]
}
```

- A stable machine-readable `type` or `code`; clients branch on it, never on `message`.
- Field-level errors point at the field path.
- Include a request ID in every response (body and header) for support.
- Never leak stack traces, SQL, or internal hostnames.

## 4. Pagination, filtering, sorting

- Paginate every list endpoint from day one. Adding it later is a breaking change.
- Prefer cursor pagination: `GET /invoices?limit=50&cursor=abc`, response `{"data": [...], "next_cursor": "def"}` (`null` at the end). Offset pagination is acceptable for small, stable, admin-style lists.
- Default and maximum `limit` documented (for example 20 and 100).
- Cursors are opaque; sort order must be stable (tie-break on ID).
- Filters as query params with exact names: `?status=paid&created_after=2026-01-01T00:00:00Z`.
- Sorting: `?sort=-created_at` (minus for descending). Allow only indexed fields.

## 5. Idempotency and concurrency

- Accept an `Idempotency-Key` header on POST (and PATCH where retries matter). Store key, request fingerprint, and response for a documented window (often 24 hours).
- Same key, same body: return the stored response. Same key, different body: `422` or `409`. Same key still in flight: `409`.
- For lost updates, return an `ETag` and require `If-Match` on writes where concurrent edits are plausible.

## 6. Versioning and change

- Additive changes are non-breaking: new endpoints, new optional fields, new enum values (only if clients were told to tolerate unknown values).
- Breaking: removing or renaming fields, changing types or meaning, new required inputs, changed defaults, stricter validation.
- Version in the path (`/v1/`) for simplicity, or a header/date-based version if the API already does that. Do not mix.
- Deprecate before removing: announce, add a `Deprecation` and `Sunset` header, give a date, and keep the old behavior until then.

## 7. Auth and security

- HTTPS only. Reject plain HTTP rather than redirecting API calls.
- Server-to-server: API keys or OAuth 2.0 client credentials in the `Authorization` header, never in query strings. User-delegated: OAuth 2.0 authorization code with PKCE.
- Scope keys to least privilege; support rotation (two active keys at once).
- Check authorization per object on every request, not just per route. Return `404` rather than `403` when revealing existence would leak information.
- Validate and bound every input: size limits, enum checks, max array lengths.

## 8. Rate limits

- Limit per key (and per IP for unauthenticated routes). Return `429` with `Retry-After`.
- Expose remaining quota in response headers. Follow the IETF RateLimit header fields if the stack supports them, or the API's existing `X-RateLimit-*` convention; document whichever you use.
- Document the limits and tell clients to back off exponentially with jitter.

## 9. Document with examples

For every endpoint document: method and path, purpose in one line, auth and scopes, path/query/body params (type, required, default, constraints), a full example request (`curl`) and response, every error `type` it can return, and pagination or idempotency behavior.

Write or update an OpenAPI description alongside the design. Keep examples real: they should run against a test environment.

## Before you call it done

- [ ] Resource names are plural nouns, paths and fields follow one casing convention.
- [ ] Every method/status pair matches the table; no `200` errors.
- [ ] All errors share one shape with a stable code and request ID.
- [ ] Every list endpoint paginates with documented defaults and limits.
- [ ] POST endpoints that create or charge accept an idempotency key.
- [ ] The change is classified as breaking or non-breaking, and breaking changes are versioned or deprecated with a date.
- [ ] Auth is in headers, per-object authorization is checked, inputs are bounded.
- [ ] Rate limit responses include `429` and `Retry-After`.
- [ ] Each endpoint has a working request and response example and an OpenAPI entry.
