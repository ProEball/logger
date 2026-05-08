# Logger

A self-hosted structured event logging service.

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
