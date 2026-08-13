# Logging Model: Events, Filtering, Dashboard, Alerts

This is the product's core domain: what a "log" (called an **event** throughout the code) looks like, how it's typed, how it's queried, and what's built on top of it (dashboard, alerts).

## The `events` table

See [architecture.md](architecture.md#events-partitioning) for partitioning/retention mechanics. Full column list:

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | no | server-generated |
| `project_id` | uuid | no | FK → `projects.id`, `ON DELETE RESTRICT` |
| `timestamp` | timestamptz | no | **partition key** |
| `level` | text | no | `debug｜info｜warn｜error｜fatal` (enforced by Zod at ingest — no DB check constraint) |
| `message` | text | no | |
| `source` | text | yes | |
| `environment` | text | yes | |
| `release` | text | yes | |
| `user_id` | text | yes | correlation id, not a real FK |
| `session_id` | text | yes | |
| `request_id` | text | yes | |
| `trace_id` | text | yes | |
| `error_type` | text | yes | |
| `stack_trace` | text | yes | |
| `attributes` | jsonb | default `{}` | flat map, primitive values only |
| `context` | jsonb | default `{}` | free-form nested JSON |
| `user_agent` | text | yes | server-filled from the request, never client-supplied |
| `ip` | text | yes | server-filled from `x-forwarded-for` (first hop), never client-supplied |

Indexes: `(project_id, timestamp)`, `(project_id, level, timestamp)`, `(project_id, error_type, timestamp) WHERE error_type IS NOT NULL`, plus `GIN` on `attributes` and `GIN` on `to_tsvector('simple', message)` (full-text search) — the two GIN indexes exist only in the raw SQL migration, not in the Drizzle schema file.

For the ingest-time validation rules (required fields, size limits, timestamp policy), see [api.md](api.md#event-schema) — that's the authoritative contract for what an event can contain when it arrives.

## Attribute type enforcement

`attributes` is a flat `key → string|number|boolean|null` map. To keep it queryable with `attributes @> '{"key":"value"}'::jsonb` containment filters (used by both the events-list filter UI and alert conditions), the app enforces that **each attribute key has one consistent value type per project**, first-write-wins:

1. `attribute_key_types` (see [architecture.md](architecture.md#attribute-type-registry)) records the first JSON type ever seen for `(project_id, key)`. `null` values never establish or violate a key's type.
2. On every ingest call, incoming events' attribute values are compared against the registered type for their key. A mismatch is an **attribute type conflict**.
3. **Single-event ingest**: any conflict rejects the whole event (`400`, see [api.md](api.md)).
4. **Batch ingest**: conflicting events are filtered out individually; the rest of the batch is still inserted (partial success, `207`).

Example: if the first event ever ingested for a project sends `attributes: { "http_status": 200 }` (number), a later event sending `attributes: { "http_status": "200" }` (string) for the same project will be rejected as a type conflict — rename the key or fix the client instead of relying on implicit coercion.

## Events list: filtering, search, pagination

Filter shape (`EventFilters`, shared between the events-list UI and alert rule conditions):

```ts
{
  range: "15m" | "1h" | "6h" | "24h" | "7d" | "30d" | { from: string; to: string };
  levels?: EventLevel[];
  environments?: string[];
  sources?: string[];
  releases?: string[];
  errorTypes?: string[];
  userId?: string;        // exact match, single value
  sessionId?: string;
  requestId?: string;
  traceId?: string;
  message?: string;       // full-text search
  attributes?: { key: string; value: string }[];  // ANDed
}
```

- **Multi-select filters** (levels, environments, sources, releases, errorTypes) → SQL `IN (...)`.
- **Correlation filters** (userId/sessionId/requestId/traceId) → exact equality, one value at a time.
- **Full-text message search** → `to_tsvector('simple', message) @@ websearch_to_tsquery('simple', $q)`, supports `websearch_to_tsquery` syntax (quoted phrases, `-exclude`).
- **Attribute filters** → `attributes @> '{"key":"value"}'::jsonb`, one clause per filter, ANDed — narrows further with each added filter.
- Filter state lives entirely in the URL and never throws on malformed input (invalid values are silently dropped), so stale/malformed share links still render something sensible.
- **Facet counts**: for each of levels/environments/sources/releases/errorTypes, the UI shows a per-option count scoped by *every other* active filter (but not that field's own filter, so unchecking a box doesn't zero out its own option list). Text facets cap at the top 20 options; `NULL` values are shown as `"(unset)"`.

**Pagination** is cursor-based (keyset, not offset): page size 50, `WHERE (timestamp, id) < (cursor_ts, cursor_id) ORDER BY timestamp DESC, id DESC`, fetching 51 rows to detect `hasMore`. Changing any filter resets the cursor. There is no total count shown — only "50" or "50+".

## Dashboard

Per-project metrics (`features/dashboard/services/aggregations.service.ts`, raw SQL aggregation queries scoped by `project_id` + time range):

- **KPI row**: Events/min (rate + sparkline), Errors (error+fatal count), Fatal (fatal-only count), Firing alerts (count + up to 3 rule names).
- **Events-per-minute chart**: stacked area, colored by level, only rendering levels actually present in the data.
- **Level breakdown**: counts per level, click-through to the events list pre-filtered by that level.
- **Recent errors**: latest error/fatal events.
- **Top sources** / **Top messages**: grouped counts (messages truncated to 200 chars for grouping; each group shows `latestAt` and the statistical mode of its levels).

### Bucket sizing

Chart resolution adapts to the selected time range (`pickBucket()`):

| Range | Bucket width |
|---|---|
| ≤ 1h | 1 minute |
| ≤ 24h | 1 hour |
| ≤ 7d | 12 hours |
| else (30d) | 1 day |

Bucketing uses epoch-floor arithmetic (`to_timestamp(floor(extract(epoch from timestamp)/secs)*secs)`) rather than `date_trunc`, because `date_trunc` can't express a 12-hour bucket width directly.

> **Doc drift note**: the original design doc (`docs/features/05-dashboard.md`) specifies a 5-tier bucket scheme (`1m/5m/15m/1h/4h`) — the shipped implementation uses only 4 tiers as shown above. If you're consulting the feature doc for bucket behavior, trust this table instead.

### Zero-fill

The aggregation query only returns buckets that had at least one event (sparse result set). `fillBuckets()` walks every bucket boundary across the full requested range and inserts `{ total: 0 }` entries for any missing bucket, so charts show a continuous line/area that visibly drops to zero during quiet periods instead of just stopping short.

## Alerts

An **alert rule** (`alert_rules`, scoped to one project) consists of:
- **`filter`** — the exact same `EventFilters` shape used by the events list (minus pagination).
- **`condition`** — `{ type: "threshold", count: <positive int>, windowMinutes: 1–1440 }`: fire if at least `count` matching events occur within the trailing `windowMinutes`.
- **`channels`** — array (≥1) of webhook channels: `{ type: "webhook", url, headers?: [{key, value}] }`. Webhook is currently the **only** channel type implemented. `url` is additionally checked by an SSRF guard at save time *and* at every delivery — see [Delivery](#delivery).
- **`notifyOnResolve`** — whether transitioning back to `ok` also sends a notification (default `true`).

### Evaluation (every minute, via the `alert-evaluation` pg-boss job)

For every enabled rule (across all projects, evaluated in parallel batches of 10, one rule's failure doesn't block others):
1. Count matching events in `[now - windowMinutes, now)` using the same filter-building logic as the events list.
2. `newState = matchCount >= condition.count ? "firing" : "ok"`.
3. If unchanged, just bump `last_evaluated_at`/`last_match_count` (guarded by an optimistic-concurrency `version` check so a concurrent rule edit isn't silently overwritten).
4. If the state **transitions**, update `state`/`state_changed_at`/`version`, and — only if the new state is `firing`, or it's `ok` **and** `notifyOnResolve` is true — insert an `alert_notifications` row and enqueue one `alert-delivery` job per webhook channel.

### Delivery

`alert-delivery` job: POSTs the JSON payload to the webhook URL with a 5-second timeout.

Before the request goes out, `assertPublicWebhookTarget()` re-validates the target — scheme, credentials, IP literals, and a fresh DNS resolution checked against private/reserved ranges. This runs on **every** delivery, not just at rule-creation time, because a hostname that resolved publicly when the rule was saved can be repointed inward later. See [security.md](security.md#outbound-request-safety-ssrf) for the full ranges and the `ALLOW_PRIVATE_WEBHOOK_TARGETS` opt-out.

Response classification:

| Outcome | Result | Retried? |
|---|---|---|
| 2xx | delivered | — |
| 3xx | failed — `"Webhook redirected; refusing to follow"` | **No** |
| 4xx | failed | **No** — permanent config error |
| 5xx, network error, timeout | failed | **Yes** — pg-boss `retryLimit: 3, retryDelay: 30s, retryBackoff: true` |
| SSRF guard rejection | failed, no request ever sent | **No** |

The fetch sets **`redirect: "manual"`**, which is why 3xx surfaces as a failure rather than silently resolving: auto-following would re-enter the request with a `Location` the SSRF guard never vetted.

Webhook payload shape (`build-payload.ts`):
```json
{
  "rule_id": "...", "rule_name": "...", "project_id": "...",
  "state": "firing", "previous_state": "ok",
  "triggered_at": "...",
  "condition": { "type": "threshold", "count": 5, "windowMinutes": 10 },
  "filter": { ... },
  "sample_events": [ /* up to 3 */ ],
  "events_url": "https://.../events?levels=error&range=...",
  "test": false
}
```
`events_url` is built from the validated **`APP_URL`**. Until 2026-08-13 it read a `NEXT_PUBLIC_APP_URL` that was defined nowhere, so every webhook ever sent carried a `http://localhost:3000/...` link — see [stack.md](stack.md#environment-variables).
`sample_events` only re-applies the rule's `levels` filter when picking sample rows — not the full filter (environments/sources/attributes/etc. are ignored for sample selection, though they *are* applied when computing the actual match count for the threshold). Test-fire requests (from the "Test" button in the UI) use a hardcoded fake event instead of querying the DB.

### Rule mutation side effects

- Editing a rule's `filter`, `condition`, or `channels` resets `state` back to `"ok"` (avoids a stale "firing" reading against a condition that no longer applies) and bumps `version`.
- Disabling a currently-firing rule also resets its state to `"ok"`, so re-enabling it later doesn't produce a spurious "resolved" notification.

> **Doc drift notes** (`docs/features/06-alerts.md` vs. actual code): the doc describes `alert_notifications.state` as `firing｜resolved`; the code actually uses `firing｜ok` (mirroring `alert_rules.state`). The doc describes an explicit 3-step retry delay array with backoff disabled; the code uses a single 30s base delay with pg-boss's built-in exponential backoff enabled.
