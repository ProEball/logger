# 03. Ingest

## Status
- [ ] Not started · [ ] In progress · [ ] Done
- Started: —
- Completed: —
- Last touched: 2026-04-30 (planning)
- Progress: 0 / 36 checklist items

## Goal

Accept JSON events from external projects via authenticated HTTP endpoints. Validate, enrich (server timestamp/IP/user-agent), apply rate limit, write to the partitioned `events` table. End state: `curl POST /api/ingest` with a valid API key writes a row that's queryable.

## Prerequisites

- ✅ 02-projects-api-keys (need API keys to authenticate ingest)

## Locked decisions

| ID | Question | Resolution |
|---|---|---|
| Q-C1 | Event JSON schema | Hybrid: fixed common fields + `attributes` (flat map) + `context` (free JSON). Full Zod schema below. |
| Q-C2 | Required vs optional | Only `level` and `message` required. Server enriches `timestamp`, `user_agent`, `ip`, `project_id`, `id`. |
| Q-C3 | pg_partman setup | Daily partitions on `timestamp`. Retention 30 days. Premake 7 days. `run_maintenance()` hourly via pg-boss. Postgres image switched to a custom build with `pg_partman` extension. |
| Q-C4 | Batch size | 500 events per request. 5 MB body cap. |
| Q-C5 | Rate limiting | In-memory rolling-window counter. 1000 events / 60s per API key. Returns 429 + `Retry-After`. |
| Q-C6 | Response codes | Single → 202 + `{ id }`. Batch → 202 + `{ accepted, errors: [] }` (or 207 if mixed, 400 if all fail). Auth → 401. Rate → 429. Body → 413. Validation → 400. |
| Q-C7 | Timestamp source | Client-provided with sanity guards: future > +5min → server now(); past > -30d → reject. Otherwise use as-is. |
| Q-C8 | Abuse handling | Single body 64 KB. Batch body 5 MB. Stack trace 32 KB. Silent-drop on validation failure (400 to client + WARN log). |
| Q-C9 | Sync vs queued write | Sync insert (multi-row for batch). In-memory buffer is a soft-evolution path if ingest starts lagging. |

## Data model

```ts
events                                          PARTITION BY RANGE (timestamp) — daily
  id              uuid not null
  project_id      uuid not null fk → projects.id ON DELETE RESTRICT
  timestamp       timestamptz not null
  level           text not null              -- 'debug'|'info'|'warn'|'error'|'fatal'
  message         text not null
  source          text
  environment     text
  release         text
  user_id         text                       -- correlation, not FK
  session_id      text
  request_id      text
  trace_id        text
  error_type      text
  stack_trace     text
  attributes      jsonb default '{}'::jsonb  -- flat map; primitive values
  context         jsonb default '{}'::jsonb  -- free-form nested
  user_agent      text                       -- server-filled
  ip              inet                       -- server-filled
  
  PRIMARY KEY (project_id, timestamp, id)    -- partitioned tables require partition key in PK
  INDEX (project_id, timestamp DESC)
  INDEX (project_id, level, timestamp DESC)
  INDEX (project_id, error_type, timestamp DESC) WHERE error_type IS NOT NULL
  GIN INDEX on attributes
  GIN INDEX on to_tsvector('simple', message)
```

### Partman setup

The migration is hand-edited (Drizzle DSL doesn't model partitioning) — must be **idempotent** so repeat applies and dev `db:push` don't blow up:

```sql
CREATE EXTENSION IF NOT EXISTS pg_partman;

-- Skip create_parent if already configured (re-runs would fail with "table already configured")
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM partman.part_config WHERE parent_table = 'public.events') THEN
        PERFORM partman.create_parent(
            p_parent_table := 'public.events',
            p_control      := 'timestamp',
            p_type         := 'native',
            p_interval     := 'daily',
            p_premake      := 7
        );
    END IF;
END $$;

UPDATE partman.part_config
SET retention                  = '30 days',
    retention_keep_table       = false,
    retention_keep_index       = false,
    infinite_time_partitions   = true
WHERE parent_table = 'public.events';
```

`run_maintenance()` runs hourly from a pg-boss schedule. It:
- Creates next premake partitions
- Drops partitions older than 30 days

**Note on FK to partitioned table**: Postgres allows FK FROM a partitioned table (events → projects ✅) but does NOT allow FK TO a partitioned table. No feature in this plan needs the inverse direction.

### Migration split

- `0007_events_partitioned.sql` — base table + partman setup + indexes (parent table only; partman generates child partitions)

## Server-side artifacts

### Schema and validation
- `features/ingest/utils/event-schema.ts` — Zod schema (single + batch wrapper)
- `features/ingest/utils/sanitize-timestamp.ts` — Q-C7 sanity logic
- `features/ingest/utils/enrich-event.ts` — fills server-side fields (id, timestamp, user_agent, ip, project_id)

### Auth and limits
- `features/ingest/services/api-key-auth.service.ts` — extracts `Authorization: Bearer <key>`, validates via `api-keys.service.ts` (feature 02), returns active project + key
- `features/ingest/services/rate-limit.service.ts` — in-memory Map<apiKeyId, { count, windowStart }>. 1000 / 60s. Returns `{ allowed, retryAfter }`.
- Updates `api_keys.last_used_at` (debounced — write only every 60s per key, in-memory tracking)

### Ingest service
- `features/ingest/services/ingest.service.ts`
  - `ingestSingle(rawEvent, ctx)` → 202 / errors
  - `ingestBatch(rawEvents[], ctx)` → 202 / 207 / 400
  - Uses Drizzle `db.insert(events).values(rows)` for multi-row insert in batch

### Route handlers
```
app/api/ingest/route.ts             POST single
app/api/ingest/batch/route.ts       POST batch

Both:
  - export const runtime = 'nodejs'
  - export const dynamic = 'force-dynamic'
  - CORS: Access-Control-Allow-Origin: * (CC6)
  - Body limits enforced via NextResponse if Content-Length exceeds caps
```

### Background jobs
- `features/ingest/jobs/partman-maintenance.job.ts` — pg-boss schedule, runs hourly, calls `SELECT partman.run_maintenance()`

## Routes (no UI)

```
POST /api/ingest                — auth via API key
POST /api/ingest/batch          — auth via API key
OPTIONS /api/ingest             — CORS preflight (204)
OPTIONS /api/ingest/batch       — CORS preflight (204)
```

## Designs

- 🎨 Status: ⬜ N/A — server-only feature.
- Documentation deliverable: small section in README about how to send events (curl example) — written as part of this feature.

## Implementation Checklist

### Postgres image
- [ ] 1. Create `db/Dockerfile` based on `postgres:16` that installs `pg_partman` extension (apt-get install postgresql-16-partman or build from source).
- [ ] 2. Update `docker-compose.dev.yml` to build from `./db` instead of using image directly.
- [ ] 3. Add init script `db/init/01-extensions.sql`: `CREATE EXTENSION IF NOT EXISTS pg_partman;`
- [ ] 4. Live check: `docker compose down -v && docker compose up -d` → `psql -c "SELECT extname FROM pg_extension WHERE extname='pg_partman'"` returns row.

### Schema + partitioning
- [ ] 5. Drizzle schema for `events` (parent table). Use raw SQL for `PARTITION BY RANGE` since Drizzle DSL doesn't support it.
- [ ] 6. Generate migration 0007. Edit it to include partman calls (`CREATE EXTENSION`, `create_parent`, `UPDATE partman.part_config`).
- [ ] 7. Apply migration. Verify via `\d+ events` that table is partitioned and child partitions exist (today + 7 future days).
- [ ] 8. Index creation: composite indexes via raw SQL in same migration (Drizzle handles them on parent, partman propagates to children).
- [ ] 9. Live check: insert a row manually with `psql`, query it back. Insert event with timestamp 8 days in future → goes to (auto-created or future-premade) partition.

### Event schema (Zod)
- [ ] 10. `features/ingest/utils/event-schema.ts`: full Zod schema as defined in this doc.
- [ ] 11. `batchEventSchema = z.array(eventSchema).min(1).max(500)`.
- [ ] 12. Unit test: valid minimal event passes; missing level/message rejected; oversize stack trace rejected; unknown fields stripped (use `.strict()`? Decide — recommend `.passthrough()` is dangerous, use default which strips unknown silently).
- [ ] 13. Decision: use `.strip()` (default) — unknown fields ignored. Document that clients should use `attributes`/`context` for non-standard data.

### Timestamp sanitization
- [ ] 14. `sanitize-timestamp.ts`: input ISO string or undefined → output Date.
  - undefined → now()
  - parsed > now + 5 min → now() + log warn
  - parsed < now - 30 days → throw `EventTimestampOutOfRetentionError`
  - else → parsed
- [ ] 15. Unit test for each branch.

### Enrichment
- [ ] 16. `enrich-event.ts`: takes Zod-parsed event + request context + project_id. Adds: `id` (uuid), `timestamp` (sanitized), `user_agent` (from headers, override client value), `ip` (from `x-forwarded-for` first hop / connection.remoteAddress), `project_id`.
- [ ] 17. Unit test.

### Rate limiter
- [ ] 18. `rate-limit.service.ts`: `RollingWindowLimiter` class with `take(apiKeyId, count = 1)` returning `{ allowed, retryAfterSeconds }`. Module-level singleton instance. Cleanup interval (`setInterval` every 5 min purging stale Map entries) is started lazily on first `take()` call — NOT at module import time, so test runs / build steps don't leak timers.
- [ ] 19. Configurable: `RATE_LIMIT_PER_MIN` env var, default 1000.
- [ ] 20. Unit test: 1000 single requests pass; 1001st fails; after 60s window resets. Cleanup timer is lazy (asserted by spying on `setInterval`).
- [ ] 21. Note in code AND in this doc: NOT multi-instance safe. Multi-replica deployment requires Redis-backed limiter (see feature 08 open questions).

### API key auth
- [ ] 22. `api-key-auth.service.ts`: parse `Authorization: Bearer <key>` (or 401), call `lookupByPlainKey` from feature 02, return project + key (or 401 if revoked / not found).
- [ ] 23. `last_used_at` debounced update: in-memory `Map<apiKeyId, lastWriteTimestamp>`. If > 60s since last write → enqueue background update via pg-boss.
- [ ] 24. Unit test for parsing edge cases (no header, wrong scheme, empty token).

### Single endpoint
- [ ] 25. `app/api/ingest/route.ts`:
  - OPTIONS handler returns 204 with CORS headers.
  - POST: read Content-Length, reject 413 if > 64 KB.
  - Parse JSON, parse Zod, sanitize, enrich.
  - Auth + rate-limit (in this order; auth gates rate-limit).
  - Insert via `db.insert(events).values(row)`.
  - Return 202 + `{ id }`.
- [ ] 26. Error mapping: ZodError → 400 with field details; AuthError → 401; RateLimitError → 429 + Retry-After; DBError → 500 + log.

### Batch endpoint
- [ ] 27. `app/api/ingest/batch/route.ts`:
  - Reject 413 if body > 5 MB or events > 500.
  - Validate each event individually; collect errors with index.
  - If all valid → multi-row insert, 202 + `{ accepted: N, errors: [] }`.
  - If some valid → insert valid ones, return 207 + `{ accepted, errors: [{ index, message }] }`.
  - If none valid → 400 + `{ accepted: 0, errors }`.

### Partman maintenance
- [ ] 28. `partman-maintenance.job.ts`: pg-boss schedule, cron `0 * * * *` (hourly), executes `SELECT partman.run_maintenance(p_analyze := false)`.
  - **Singleton execution**: register the schedule with `singletonKey: 'partman-maintenance'` and `useSingletonQueue: true` (or wrap the handler with a `pg_advisory_xact_lock(<fixed-int>)`). Without this, two worker replicas during a rolling restart would both run maintenance — partman tolerates it but each call is ~seconds and we want predictable load.
- [ ] 29. Wire job registration into worker startup (worker container, see feature 08; for dev — start in same Next.js process behind env flag `WORKER_IN_PROCESS=true`). Only ONE Next.js dev server should set this flag at a time, and prod uses the dedicated worker container with `replicas: 1` (feature 08).
- [ ] 30. Live check: manually insert event with timestamp 31 days ago → run maintenance → row gone (partition dropped).

### Tests
- [ ] 31. E2E (`e2e/ingest.spec.ts`):
  - With valid API key, POST /api/ingest single → 202, row exists.
  - POST batch of 100 events → 202, all rows exist.
  - Revoked API key → 401.
  - Wrong key format → 401.
  - Body > 64 KB → 413.
  - 1001 rapid requests in 60s → 429 with Retry-After.
  - Future timestamp (10 min ahead) → coerced to server now.
  - Past timestamp (40 days) → 400.
  - Malformed JSON → 400.
- [ ] 32. Integration test: insert event → query via Drizzle returns the same shape.
- [ ] 33. Update `last_used_at` is reflected after debounce window.

### Documentation
- [ ] 34. README section "Sending events":
  - curl example (single)
  - curl example (batch)
  - Field reference table
  - Rate limits
  - Response codes
- [ ] 35. Document how to obtain an API key (link to feature 02 settings page).

### Final
- [ ] 36. Update PROGRESS.md row → ✅ Done. Update Status block. End-to-end live check.

## Live check (full)

Using API key from feature 02 live check:

1. `curl -X POST http://localhost:3000/api/ingest \
     -H "Authorization: Bearer lgr_..." \
     -H "Content-Type: application/json" \
     -d '{"level":"info","message":"hello"}'`
   → 202 + `{ "id": "<uuid>" }`.
2. Query: `psql -c "SELECT id, level, message FROM events WHERE project_id = '...'"` → row present.
3. Send batch of 50 events → 202 + `{ accepted: 50 }`. All rows present.
4. Send batch where event #5 has invalid level → 207. 49 rows present.
5. Spam 1001 single requests in <60s → last one returns 429 with `Retry-After: <s>`.
6. Revoke key in UI → next request 401.
7. Send event with `timestamp` 31 days in past → 400 with retention error.
8. Run `SELECT partman.run_maintenance()` → see expected number of child partitions.
9. CORS: `curl -X OPTIONS http://localhost:3000/api/ingest -H "Origin: https://example.com"` returns 204 with `Access-Control-Allow-Origin: *`.

## Tests

- Unit (Vitest): event schema, timestamp sanitization, enrichment, rate limiter window logic, api-key auth parsing.
- Integration: ingest service round-trip with real DB.
- E2E (Playwright): all the curl scenarios above scripted.

## Open questions

- ❓ When we add multi-instance deployment (worker scaling), rate limiter needs Redis. Soft evolution, document in feature 08 or separate task.

## Decision log (local)

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-01 | partman migration is idempotent (`DO $$ ... IF NOT EXISTS ... $$`) | Drizzle migrate may re-run during dev; second `create_parent` would fail otherwise |
| 2026-05-01 | `events.project_id ON DELETE RESTRICT` | Soft-delete is the intended path; hard-delete a project with live events should be blocked. Cascade would silently destroy data |
| 2026-05-01 | partman + pg-boss schedule use singletonKey | Multi-replica worker (rolling restart) must not double-run hourly maintenance |
| 2026-05-01 | Rate limiter cleanup timer started lazily on first `take()` | Avoids stray `setInterval` during tests / builds / cold module loads |
| 2026-05-01 | Worker dev mode behind `WORKER_IN_PROCESS=true` | Explicit opt-in prevents two `next dev` instances from both running schedules |
