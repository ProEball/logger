# Logger

A self-hosted structured event logging service.

## Documentation

| Doc | For |
|---|---|
| [`docs/LAUNCH.md`](docs/LAUNCH.md) | **Going live the first time** — what to buy, in what order, and what breaks if you skip a step |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | **Running it** — deployments, updates, backups and restore, logs, health, certificates |
| [`docs/reference/`](docs/reference/README.md) | What the code does today — stack, architecture, HTTP API, roles, logging, security |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | Current state and the remaining gaps |

Running it in production is `cp .env.production.example .env`, fill it in, then
`docker compose up -d`. See [`docs/OPERATIONS.md`](docs/OPERATIONS.md) for the
full procedure. For local development see
[`docs/reference/stack.md`](docs/reference/stack.md#local-development-environment).

## Sending Events

### Prerequisites

Create a project and generate an API key at `/{org}/{project}/settings/api-keys`.

### Single Event

```bash
curl -X POST http://localhost/api/ingest \
  -H "Authorization: Bearer lgr_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "level": "error",
    "message": "Something went wrong",
    "error_type": "TypeError",
    "environment": "production",
    "attributes": { "user_id": "u_123", "request_ms": 42 }
  }'
```

Response `202`:
```json
{ "id": "uuid-of-the-event" }
```

### Batch Events

```bash
curl -X POST http://localhost/api/ingest/batch \
  -H "Authorization: Bearer lgr_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '[
    { "level": "info", "message": "User signed in" },
    { "level": "warn", "message": "Slow query", "attributes": { "ms": 1200 } }
  ]'
```

Response `202`:
```json
{ "accepted": 2, "errors": [] }
```

### Retrying safely

Both routes accept an optional `Idempotency-Key` header (1–128 characters). Send
the same key when retrying a request whose response you never saw, and the
repeat is discarded instead of stored twice:

```bash
curl -X POST http://localhost/api/ingest/batch   -H "Authorization: Bearer lgr_YOUR_API_KEY"   -H "Idempotency-Key: 018f3c9a-7b2e-7c3d-9e1f-2a4b6c8d0e1f"   -H "Content-Type: application/json"   -d '[{ "level": "info", "message": "User signed in" }]'
```

Without the header there is no deduplication, which is what every client gets by
default. The key identifies the *request*, so sending different events under a
key you already used discards them. See
[docs/reference/api.md](docs/reference/api.md#idempotency-key-optional-request-header).

### Event Field Reference

| Field | Required | Type | Description |
|---|---|---|---|
| level | yes | debug/info/warn/error/fatal | Log level |
| message | yes | string max 2048 | Human-readable message |
| timestamp | no | ISO 8601 string | Client time; coerced if >5min future; rejected if >30d past |
| source | no | string | Service or component name |
| environment | no | string | production, staging, etc. |
| release | no | string | App version / git SHA |
| user_id | no | string | Correlation ID (not a FK) |
| session_id | no | string | Session correlation |
| request_id | no | string | Request correlation |
| trace_id | no | string | Distributed trace ID |
| error_type | no | string | Exception class name |
| stack_trace | no | string max 32 KB | Stack trace |
| attributes | no | flat JSON object | Primitive values only: string/number/bool/null |
| context | no | free JSON object | Arbitrary nested data |

Server fills: `id`, `user_agent`, `ip`, `project_id`.

### Rate Limits

- 1000 events / 60 seconds per API key (rolling window)
- Batch counts as N events
- Exceeded: 429 with Retry-After header

### Response Codes

| Code | Meaning |
|---|---|
| 202 | Accepted |
| 207 | Partial batch (some events failed validation) |
| 400 | Validation error or timestamp out of retention |
| 401 | Invalid or revoked API key |
| 413 | Payload too large (single: 64 KB, batch: 5 MB / 500 events) |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

## Monitoring Endpoints

### Version

```
GET /api/version
```

Returns build metadata. Useful for CI/CD verification and support diagnostics.

```json
{
  "sha": "abc1234",
  "builtAt": "2026-05-09T12:00:00.000Z",
  "nodeVersion": "v22.0.0",
  "nextVersion": "16.2.4"
}
```

Set `NEXT_PUBLIC_BUILD_SHA` and `NEXT_PUBLIC_BUILD_TIME` at build time (e.g. in CI):

```bash
NEXT_PUBLIC_BUILD_SHA=$(git rev-parse --short HEAD) \
NEXT_PUBLIC_BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
npm run build
```

### Health

```
GET /api/health/ready
```

Returns `200` when all critical checks pass, `503` otherwise.

```json
{
  "status": "ok",
  "checks": {
    "db": "ok",
    "pgboss": "ok",
    "ingest": "ok",
    "clickhouse": "ok"
  }
}
```

| Check | Failure condition |
|---|---|
| `db` | Cannot reach PostgreSQL |
| `pgboss` | pg-boss schema unreachable (only when `WORKER_IN_PROCESS=true`) |
| `ingest` | No events received in the last hour — warning only (`X-Health-Warn` header), does not cause 503 |
| `clickhouse` | Cannot reach ClickHouse |

Use `/api/health/ready` as your container liveness/readiness probe.

## ~~Self-monitoring Alert (pg_partman Watchdog)~~

**Removed 2026-08-26.** There is no partition maintenance job: events live in
ClickHouse, which partitions monthly and creates partitions on insert. The
pattern itself is still worth knowing, and the app can be pointed at itself for
any recurring failure — emit an event with a dedicated `source` when something
fails, then create a rule whose condition is `source` equals that value with a
threshold of `≥ 1` in `1h`.
