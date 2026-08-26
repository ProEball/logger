# Security

## Authentication

- **better-auth**, email/password only (`core/auth/config.ts`) — no OAuth/social providers, no 2FA, no magic links, no passkeys configured.
- **Password hashing**: not customized — relies entirely on better-auth's default (scrypt-based) hashing. The hashed password lives in `accounts.password`, not on the `users` table.
- **Sessions**: 30-day expiry (`expiresIn: 60*60*24*30`), `updateAge: 0` — meaning sessions roll/extend on every request rather than only re-issuing after a staleness threshold.
- **Password change revokes other sessions**: `changePasswordAction` (`features/auth/actions/change-password.action.ts`) calls better-auth's `changePassword` for the credential update, then makes a **separate** call to `auth.api.revokeOtherSessions` to delete every session for that user except the one making the request — verified end-to-end by `e2e/auth.spec.ts`. (Not implemented via `changePassword`'s own `revokeOtherSessions` body flag, which deletes *all* sessions including the current one and mints a replacement — that session/cookie rotation was unreliable inside a Next.js Server Action response; fixed 2026-08-13.)
- **CSRF**: no custom configuration — relies on better-auth's default same-site cookie behavior. No `trustedOrigins` are configured.
- **No rate limiting on auth endpoints** (`/api/auth/*`, including login and password-reset-request) — the only rate limiter in the codebase covers the ingest API. Brute-forcing login or spamming password-reset requests is not throttled at the application level.
- **Password reset flow is not wired to real email delivery.** `sendResetPassword` in `core/auth/config.ts` currently just logs the reset URL via `logger.info({ email, resetUrl }, "[PASSWORD_RESET]")` — the live reset token ends up in the app's stdout/log stream instead of an inbox. This is a production gap: anyone with log access can reset any user's password, and there is currently no real email provider wired up. Flag this before treating password reset as production-ready.
- Login failures return a generic `"Invalid email or password."` (no user-enumeration signal); password-reset requests always return success regardless of whether the email exists (also no enumeration signal) — those two flows are enumeration-safe even though they're not rate-limited.

## API key security (ingest authentication)

- **Format**: `lgr_<base64url(32 random bytes)>` — 256 bits of entropy from Node's `crypto.randomBytes`, URL-safe unpadded base64.
- **Storage**: unsalted **SHA-256** hex digest (`key_hash` column), plus a 4-character `key_prefix` stored separately for UI display (e.g. `lgr_ab12...`) so users can recognize a key without ever seeing it again. This is a deliberate, reasonable tradeoff: SHA-256 is fast (unlike a password KDF), but the 256-bit random secret it's hashing makes offline brute-force infeasible regardless — this is not the same threat model as a user-chosen password.
- **Reveal**: the plaintext key is returned **exactly once**, at creation time, and never persisted or logged again. There is no "reveal again" feature.
- **Verification**: the presented key is re-hashed and looked up by equality against the `key_hash` column (indexed), scoped to non-revoked keys on non-soft-deleted projects. This is a DB-index lookup, not an application-level string comparison, so classic timing side-channel concerns about `===` don't apply the same way.
- **Revocation**: soft (`revoked_at` timestamp) — revoked keys are simply excluded from the auth lookup. Hard delete is only permitted on an already-revoked key.
- **Auth failure messages are deliberately generic**: "Invalid or revoked API key." for both "key doesn't exist" and "key was revoked" — avoids giving an attacker an oracle to distinguish the two.
- **`last_used_at` tracking** is debounced in-memory (only writes to the DB if ≥60s have passed since the last write for that key) and best-effort (write failures are silently swallowed) — note this debounce state is per-process, so under multiple app replicas each instance debounces independently.

## Rate limiting

- Applies **only** to the ingest endpoints (`/api/ingest`, `/api/ingest/batch`) — nothing else in the app is rate-limited.
- **Per-API-key**, not per-IP or per-project. Default limit `1000` events/60s (`RATE_LIMIT_PER_MIN` env var), overridable per key via the UI (1–100,000/min, `api_keys.rate_limit_per_min` column).
- Implementation is a **fixed-window counter** (despite being named `RollingWindowLimiter`): each key's window fully resets every 60 seconds rather than sliding continuously, so a burst straddling a window boundary can momentarily exceed the nominal per-minute rate — a known, minor imprecision, not a hard limit violation.
- Batch requests consume **N units** (N = number of events in the array) against the same budget as a single request.
- **⚠️ Not multi-instance safe.** The limiter is a plain in-memory `Map`, explicitly documented in the code as requiring a Redis-backed replacement before any multi-replica deployment. If you scale the app horizontally without addressing this, each replica enforces its own independent limit — the effective aggregate rate limit becomes `configured_limit × replica_count`.
- Exceeding the limit returns `429` with a `Retry-After` header (see [api.md](api.md)).

## Headers / CORS / transport security

Implemented 2026-08-13. Static headers live in `next.config.ts`'s `headers()` and apply to `/(.*)`; the per-request CSP is set in `proxy.ts`.

| Header | Value | Notes |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | |
| `X-Frame-Options` | `DENY` | Redundant with CSP `frame-ancestors 'none'`, kept for agents honouring only this |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | |
| `X-DNS-Prefetch-Control` | `off` | |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), interest-cohort=()` | |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | **Production only** — gated on `NODE_ENV === "production"` so a dev server never emits it. Note the gate is evaluated when `next build` runs (`headers()` is resolved into the routes manifest), and `next build` sets `NODE_ENV=production` itself — so the header is baked into the image, not decided at container start |

### Content-Security-Policy (nonce-based)

`proxy.ts` mints a fresh base64 nonce per request, builds the CSP, sets it on **both** the outgoing response and the forwarded request headers (plus `x-nonce`). Next.js parses the `nonce-{value}` out of the request CSP during SSR and stamps it onto every framework/page script tag it emits, so nothing threads the nonce through the component tree by hand.

```
default-src 'self'; script-src 'self' 'nonce-<per-request>' 'strict-dynamic' [+ 'unsafe-eval' in dev];
style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self';
object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';
[+ upgrade-insecure-requests outside dev]
```

Three consequences worth understanding before touching this:

- **`style-src` uses `'unsafe-inline'`, not the nonce — deliberately, and it cannot be tightened as-is.** Per the CSP spec, a nonce in `style-src` makes the browser *ignore* `'unsafe-inline'`, and nonces never apply to inline `style` **attributes**. Recharts renders its SVG with inline style attributes, so nonce-ing styles would blank every chart on the dashboard. Scripts remain under full `nonce` + `strict-dynamic`.
- **The whole app is now dynamically rendered.** A nonce requires SSR per request. The root layout reads `headers()` to obtain the nonce, which opts the entire route tree into dynamic rendering — `next build` reports no `○ (Static)` routes at all. Acceptable for a self-hosted app; relevant if CDN caching is ever considered.
- **The root layout's inline theme script carries `suppressHydrationWarning`, and that is load-bearing.** Per the CSP spec browsers *hide* the nonce attribute once the document is parsed (reading it back from the DOM yields `""`), so React's hydration check compares its real nonce against `""` and reports a mismatch on every page load. The script itself executes correctly. It is a raw `<script>` rather than `next/script` — `beforeInteractive` buys nothing for an inline snippet already first in `<body>`.

### CORS

Hand-rolled, applied **only** to the two ingest routes: `Access-Control-Allow-Origin: *`, methods `POST, OPTIONS`, headers `Content-Type, Authorization, Idempotency-Key`. Intentional and low-risk for those specific routes (bearer-token auth, no cookies involved, so wildcard CORS doesn't expose session-based CSRF). No other route defines a CORS policy.

`Idempotency-Key` was added 2026-08-26 with the ClickHouse write path. It is not a credential and grants nothing: the value is scoped to the authenticated project before it is used (`${projectId}:${key}`), so one project's key cannot suppress another's events, and a key longer than 128 characters is ignored rather than truncated — truncation would map two distinct keys onto one and discard a batch that was never a repeat. See [api.md](api.md#idempotency-key-optional-request-header).

### The reverse proxy must not add security headers

TLS/HTTPS termination is handled by the `proxy` service (Caddy, automatic Let's Encrypt) — implemented 2026-08-13, see [misc.md](misc.md#deployment). The app remains the **single** source of security headers, and the `Caddyfile` carries a long comment at the point of temptation saying so.

The reason is specific to the nonce. A browser enforces **every** `Content-Security-Policy` header it receives, and a resource must satisfy all of them — a second policy intersects with the first rather than replacing it. The proxy cannot know a request's nonce, because it is generated inside the app after Caddy has already forwarded the request. So any policy written in Caddy necessarily blocks the nonced **inline** scripts Next uses to ship the RSC payload and boot the client. The failure mode is a page that renders but is completely inert — easy to misdiagnose as a hydration bug.

The same reasoning in milder form applies to the rest of the set: duplicated headers resolve to whichever value the browser takes first, so the app's real policy quietly stops being the one in effect.

Verified against the running stack on 2026-08-13: exactly one `Content-Security-Policy` header reaches the client, with a different nonce per request, and the rendered `<script>` tags carry the matching value. Caddy adds only `Via: 1.1 Caddy`.

## ClickHouse queries: parameter binding is now a rule, not a library guarantee

Since 2026-08-26 **every** read and write of an event goes to ClickHouse: the events list, the drawer, the facet counts, both dashboards' aggregations, the alert evaluator's match count and the sample events in an alert webhook. **There is no Drizzle dialect for ClickHouse**, so all of that is raw SQL — the escaping Drizzle used to do on the largest table in the system stops happening for free.

`@clickhouse/client` supplies `query_params`: a query names a placeholder as `{name:Type}` and passes the value separately, and the type is declared server-side. **Every user-supplied value goes through it. No exceptions, no string interpolation, not even for a value that "is obviously a UUID".** A `project_id` interpolated into a query string is a tenant-isolation bypass, not a syntax error.

Three things make this less fragile than it sounds:

- **The write path builds no SQL at all.** `insertEvents` hands the client an array of objects and a table name; the values never enter a query string. The only SQL literal on the ingest path is the table name, which is a module constant.
- **Binding goes through one class**, `ParamBag` in `core/clickhouse/params.ts`. A caller that cannot name a `{p:Type}` placeholder for a value has to stop and think about it, which is the point. Split out of the filter compiler in Phase 4, when the dashboard aggregations became a second thing that builds ClickHouse SQL by hand.
- **The filter compiler is one module** — `core/clickhouse/filter-compiler.ts`, shipped 2026-08-26 — not a query builder spread across features, so "does this emit a bound parameter" is a question about a single file with unit tests. The events read path, the alert evaluator's count **and its webhook's sample events** all call it; none builds a clause of its own. The last of those was still Postgres until Phase 4, and while it was, it applied a *narrower* filter than the count beside it — a rule filtering on `source` counted one set of events and illustrated itself with another.
- **The aggregations interpolate exactly one kind of thing**, and it is never caller data: level names, from a `const` tuple in the module or from `EVENT_LEVELS`. `level` is an `Enum8`, so literals let ClickHouse resolve the names to byte values at parse time. Everything else in `event-aggregations.service.ts` — project ids, range boundaries, environment names, bucket widths, limits, even the `(unset)` label — goes through the bag.
- **Even the attribute *keys* are bound.** This was the one place a string from a URL looked like it would have to be spliced into the query, because it names a column path rather than a value. It does not: `getSubcolumn(attributes, {k:String})` takes the path as a parameter, which was checked against a real server before the compiler was written (`lab/clickhouse/probe-query-shapes.mjs`). `filter-compiler.test.ts` asserts that a hostile key never reaches the SQL text.

What this replaces is worth stating plainly, because part of it is a **loss**: the `events → projects` foreign key does not exist in ClickHouse and cannot. Tenant isolation rests on the Postgres authorization path resolving `project_id` **before** any ClickHouse query is built.

> **Corrected 2026-08-26.** This section previously said the
> `innerJoin(projects) WHERE deleted_at IS NULL` defence in depth was lost with
> the join. It was not. `listEvents`, `getEventById` and `getFacetCounts` each
> issue that check as a separate Postgres primary-key lookup, run
> **concurrently** with the ClickHouse query so it costs no latency; if the
> project is soft-deleted the ClickHouse result is discarded and the caller sees
> an empty page. The foreign key is genuinely gone; the soft-delete check is
> not. Asserted in `events-query.service.itest.ts`, which writes rows under a
> deleted project and checks the reads come back empty.

> **Scope note added 2026-08-26 (Phase 4).** That soft-delete check covers the
> three **events-page** reads. The dashboard aggregations do not perform it and
> never did — under Postgres they scoped by a `project_id` list with no join
> either. It is not a regression, and it is not a hole today: both dashboard
> routes resolve their scope through `getProjectBySlug` /
> `listProjectsForOrg`, which filter `deleted_at IS NULL` before any id reaches
> the service. Worth stating because the defence-in-depth is uneven, and a
> reader who saw the paragraph above could reasonably assume it is not.

## Outbound request safety (SSRF)

The alert dispatcher POSTs to a **user-supplied URL**, which without a guard turns any member holding `alerts.manage` into an SSRF primitive against the host's own network and cloud metadata endpoints. Guarded in two layers as of 2026-08-13:

1. **Syntactic, isomorphic** (`features/alerts/utils/webhook-url.ts`) — wired into `webhookChannelSchema` via `superRefine`, so it runs in the alert-editor form *and* on the server. Rejects non-`http(s)` schemes, embedded credentials (`user:pass@`), and IP literals in private/reserved ranges: IPv4 `0/8`, `10/8`, `100.64/10` (CGNAT), `127/8`, `169.254/16` (**cloud metadata**), `172.16/12`, `192.0.0/24`, `192.168/16`, `198.18/15`, `224/4`+; IPv6 `::`, `::1`, `fc00::/7`, `fe80::/10`, and IPv4-mapped `::ffff:x.x.x.x` judged by the embedded v4 address. Also rejects bare `localhost` / `*.localhost`. Contains **no `node:` imports** — it is reachable from the client bundle.
2. **DNS-resolving, server-only** (`features/alerts/services/webhook-target-guard.service.ts`) — `assertPublicWebhookTarget()` runs immediately before **every** delivery, not just at rule-creation time, because a hostname that was public yesterday can be repointed inward today. Resolves the host with `dns.lookup(host, {all: true})` and rejects if **any** returned address is private. A resolution failure is itself a rejection.

Additionally, `deliverWebhook` sets **`redirect: "manual"`** and classifies any 3xx as a permanent (non-retried) failure — following a redirect would re-enter the request with a `Location` the guard never vetted, the classic bypass.

Both layers are skipped when `ALLOW_PRIVATE_WEBHOOK_TARGETS=true`. A guard rejection is classified `shouldRetry: false` (permanent config error), so it does not consume pg-boss retries.

## Access control (authorization)

Covered in depth in [users-roles.md](users-roles.md). Summary of the security-relevant mechanics:
- `proxy.ts` is a coarse **authentication** gate only (redirect unauthenticated requests to `/login`) — it has zero awareness of organizations, roles, or permissions, and explicitly **excludes `api/*` from its matcher**. Every API route and Server Action is individually responsible for its own authorization.
- Fine-grained authorization is enforced per-page and per-Server-Action via `getMembership()` + `assertPermission()`/`assertOwner()`, never centralized in middleware. This means adding a new mutating action without remembering to call `assertPermission` is a real risk — there's no framework-level backstop that would catch a missing check.
- The owner flag unconditionally bypasses all permission checks, including permissions (`org.delete`, `roles.manage`) that no role can ever hold — by design, but worth knowing when reasoning about worst-case blast radius of a compromised owner account.

### Cached reads and the scope in the cache key

Added 2026-08-20 with `features/overview/services/overview-cache.service.ts`, which holds overview query results in process for 30 seconds and serves them to every reader of an organization. Extended 2026-08-21 to the project dashboard (`features/dashboard/services/dashboard-cache.service.ts`), where the scope in the key is a single project id rather than a list. Both build their keys with the same `shared/utils/query-cache-key.ts`.

**A shared cache turns its key into an authorization boundary.** Anything the key omits is a dimension along which one reader can be served another reader's answer, and it fails *silently* — there is no error, just the wrong rows. The key therefore includes the full `projectIds` scope alongside the range preset and every filter; `shared/utils/query-cache-key.test.ts` asserts the separation for disjoint scopes, for a subset against its superset, and for an empty scope; `overview-cache.service.test.ts` and `dashboard-cache.service.test.ts` each assert it end to end by checking that a differing scope actually reaches the database again.

On the **project dashboard** the scope is not theoretical even today: two projects are two different answers, and a key that omitted the project id would serve one project's messages, sources and error counts under another project's URL. `dashboard-cache.service.test.ts` asserts that a differing project id reaches the database again.

On the **org overview** it remains defence in depth: `listProjectsForOrg()` is not permission-filtered, so all members of an organization share one scope and there is no visibility difference to leak. It is in the key because the day per-project visibility is introduced, a key without it would not fail loudly — it would start cross-serving projects.

Two related details:

- Keys are built with `JSON.stringify`, not by joining on a separator. Environment names arrive from the ingest API as arbitrary strings, so a value may contain the separator: joined on `|`, the single environment `a|b` and the filter pair `["a","b"]` collapse to one key, which is a filter bypass rather than a cosmetic collision. Covered by tests over `| , : " [ ]`.
- The cache is per process and unauthenticated by nature — it stores whatever the query returned. It is **not** a substitute for the per-page `getMembership()` check, which still runs on every request before any cached value is read.

## Environment variable validation

As of 2026-08-13, **8** variables are schema-validated and fail the app at boot if invalid: `DATABASE_URL`, `AUTH_SECRET`, `APP_URL`, `NODE_ENV`, `LOG_LEVEL`, `WORKER_IN_PROCESS`, `RATE_LIMIT_PER_MIN`, `ALLOW_PRIVATE_WEBHOOK_TARGETS` (see [stack.md](stack.md#environment-variables)). Operational tuning config is now covered alongside secret-bearing config; only build metadata (`NEXT_PUBLIC_BUILD_*`) and the test-only `E2E_MODE` remain raw `process.env` reads.

`AUTH_SECRET` is `z.string().min(32)` — previously `min(1)`, which would have accepted a one-character session-signing key.

## Known limitations summary (for a threat model / hardening pass)

| Gap | Impact | Where |
|---|---|---|
| Password reset emails only logged, not sent | Anyone with log access can hijack password resets; not production-ready as-is | `core/auth/config.ts` |
| No rate limiting on `/api/auth/*` | Login/reset endpoints are brute-forceable | better-auth config |
| Ingest rate limiter is single-instance, in-memory | Ineffective aggregate limit under horizontal scaling | `features/ingest/services/rate-limit.service.ts` |
| `style-src` requires `'unsafe-inline'` | Inline-style injection is not blocked by CSP; scripts *are* fully covered by nonce + `strict-dynamic` | `proxy.ts` — forced by Recharts, see above |
| ~~No TLS terminator yet~~ | **Closed 2026-08-13.** The `proxy` service (Caddy, automatic Let's Encrypt) terminates TLS in the production stack | `Caddyfile`, `docker-compose.yml` |
| Secrets live in a single `.env` on the host | Anything that can read the file gets `AUTH_SECRET`, the database password, and the offsite-backup credentials. Mitigated only by `chmod 600`; no secret manager, no rotation procedure | `.env.production.example`, compose `env_file:` |
| Backups are not encrypted at rest | `pg_dump` output goes to a Docker volume and, if offsite is enabled, to the bucket as-is. Bucket-side encryption is the only protection | `scripts/backup.sh` |
| Postgres superuser is the app's database user | The app connects as the same role that owns the schema; no least-privilege split between schema-creation and runtime credentials | `docker-compose.yml`, `DATABASE_URL` |
| ClickHouse user is the app's user, with no split either | Same shape as the row above, and the same single credential creates the schema and serves queries. ClickHouse also has **no row-level security and no foreign key** to `projects`, so tenant isolation rests on the Postgres authorization path resolving `project_id` before any ClickHouse query is built. The soft-delete check survived as a concurrent Postgres lookup on the events page (see above); the referential integrity did not | `docker-compose.yml`, `CLICKHOUSE_*` |
| **Nothing expires events, since 2026-08-26** | pg_partman dropped partitions past 30 days; it went with the Postgres `events` table. The ClickHouse table carries `retention_days` with a default of 30 and **no TTL clause**, so the store grows without bound until Phase 6 wires it up. Not a confidentiality gap — an availability and a data-minimisation one | `core/clickhouse/schema.sql`, `09-clickhouse.md` §9 |
| **A project can be hard-deleted while it still has events** | `ON DELETE RESTRICT` on the old Postgres foreign key made that impossible; ClickHouse has no foreign key. Nothing in the product does it — `deleteProjectAction` soft-deletes, and that is the only delete path in the UI — so this is a lost guardrail rather than a live defect. A direct `DELETE FROM projects` would now orphan its events instead of failing | `features/projects/actions/delete-project.action.ts` |
| `last_used_at` debounce is per-process | Cosmetic only (staleness of a display timestamp), not a security issue | `features/ingest/services/api-key-auth.service.ts` |
| No FK-level DB constraint on `attributeKeyTypes.type` values | App-level-only enforcement of the 3 allowed type strings | `core/db/schema/attributeKeyTypes.ts` |

**Closed 2026-08-13:** absent security headers / CSP (now nonce-based, see above); webhook SSRF (now guarded in two layers plus redirect refusal); `AUTH_SECRET` accepting a 1-character value; unvalidated operational env vars.

None of the remaining gaps are exploited by anything else in the codebase today — they're gaps to close before treating this as internet-exposed production infrastructure beyond its current "internal, invite-only" scope.
