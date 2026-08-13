# Logger

A self-hosted structured event logging service.

## Documentation

| Doc | For |
|---|---|
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | **Deploying and running it** — first deployment, updates, backups and restore, logs, health, certificates |
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
    "migrations": "ok"
  }
}
```

| Check | Failure condition |
|---|---|
| `db` | Cannot reach PostgreSQL |
| `pgboss` | pg-boss schema unreachable (only when `WORKER_IN_PROCESS=true`) |
| `ingest` | No events received in the last hour — warning only (`X-Health-Warn` header), does not cause 503 |
| `migrations` | Applied migration count < expected — likely a failed deploy |

Use `/api/health/ready` as your container liveness/readiness probe.

## Self-monitoring Alert (pg_partman Watchdog)

The partition maintenance job logs at `ERROR` if `run_maintenance()` fails. To get notified via the alert system, create a rule in any project that monitors a dedicated log stream from your app server:

1. Open a project → **Alerts** → **New rule**
2. **Condition**: `source` equals `partman-watchdog`, threshold `≥ 1` in `1h`
3. **Channel**: your webhook endpoint
4. **Name**: "Partition maintenance failure"

> Requires your app to emit a log event with `source=partman-watchdog` when maintenance fails. This is an optional enhancement — the ERROR-level pino log is always written regardless.
