# 06. Alerts

## Status
- [x] Not started · [x] In progress · [x] Done
- Started: 2026-05-09
- Completed: 2026-05-09
- Last touched: 2026-05-09
- Progress: 38 / 38 checklist items

## Goal

Threshold-based alert rules per project. A rule defines a filter (same shape as events filter), a condition (`count >= N within last M minutes`), and one or more webhook channels. A global tick evaluates all enabled rules every minute. State machine prevents notification spam: notify only on `ok ↔ firing` transitions. Failed webhooks retry with exponential backoff.

## Prerequisites

- ✅ 04-events-list-filters (reuses filter shape)
- ✅ 02-projects-api-keys (project context)

## Locked decisions

| ID | Question | Resolution |
|---|---|---|
| Q-F1 | Evaluation pattern | Global tick worker, runs every minute via pg-boss schedule. Iterates all enabled rules. |
| Q-F2 | Cooldown | State machine `ok ↔ firing`. Notify only on transition. `notify_on_resolve` toggle (default `true`). |
| Q-F3 | Webhook channel UI | URL (required) + custom headers (optional). No payload templating in MVP. Standard JSON format documented. |
| Q-F4 | Test fire button | Yes — sends a test payload (with `"test": true` flag) without writing to history. |
| Q-F5 | History UI | Tab on the rule page (`Configuration` / `History`). |
| Q-F6 | Disabled state | List filter "show disabled" off by default. Page header has Enable/Disable toggle. Disabled rules skipped by evaluator. |
| Q-F7 | Retry on delivery failure | 3 attempts on 5xx/timeout, backoff 30s / 2m / 5m via pg-boss retry policy. 4xx fails immediately (config error). |
| Q-F8 | Sample events in payload | 3 latest matching events (no stack trace) + URL pointing to filtered events page. |
| Q-F9 | Permissions | `alerts.manage` (already in registry). Default: Admin yes, Member no. |

## Data model

```ts
alert_rules
  id                    uuid pk
  project_id            uuid not null fk → projects.id ON DELETE CASCADE
  name                  text not null                          -- "High error rate"
  description           text
  filter                jsonb not null                         -- EventFilters shape from feature 04
  condition             jsonb not null                         -- { type: 'threshold', count: N, windowMinutes: M }
  channels              jsonb not null                         -- [{ type: 'webhook', url, headers? }]
  state                 text default 'ok'                      -- 'ok' | 'firing'
  state_changed_at      timestamptz
  last_evaluated_at     timestamptz
  last_match_count      int                                    -- the count from last evaluation, for UI
  enabled               boolean default true
  notify_on_resolve     boolean default true
  created_by            uuid fk → users.id ON DELETE SET NULL
  created_at, updated_at
  version               int default 1                          -- bumped on every UPDATE; used for optimistic concurrency in evaluator
  
  INDEX (project_id) WHERE enabled = true

alert_notifications
  id                    uuid pk
  alert_rule_id         uuid not null fk → alert_rules.id ON DELETE CASCADE
  triggered_at          timestamptz not null
  state                 text not null                          -- 'firing' | 'resolved'
  payload               jsonb                                  -- exact JSON sent
  channel_type          text                                   -- 'webhook' (others later)
  channel_target        text                                   -- URL for webhook
  delivery_status       text default 'pending'                 -- 'pending' | 'delivered' | 'failed' | 'retrying'
  delivery_attempts     int default 0
  delivery_last_error   text
  delivery_http_status  int
  delivered_at          timestamptz
  
  INDEX (alert_rule_id, triggered_at DESC)
```

### Migration split

- `0008_alerts.sql` — both tables.

## Server-side artifacts

### Services
- `features/alerts/services/alert-rules.service.ts` — CRUD with permission guards
- `features/alerts/services/alert-evaluator.service.ts` — `evaluateAllEnabled()` and `evaluateOne(rule)` with state transition logic
- `features/alerts/services/alert-dispatcher.service.ts` — sends webhook for a notification, handles retry classification
- `features/alerts/utils/build-payload.ts` — assembles webhook JSON from rule + match data + sample events

### Background jobs (pg-boss)
- `features/alerts/jobs/alert-evaluation.job.ts` — cron `* * * * *` (every minute), calls `evaluateAllEnabled()`
- `features/alerts/jobs/alert-delivery.job.ts` — single notification dispatch with retry policy:
  - `retryLimit: 3`
  - `retryDelay: [30, 120, 300]` seconds — pg-boss supports `retryDelay` per job
  - `retryBackoff: false` (we control delays explicitly)

### Server actions
```
features/alerts/actions/
  create-alert-rule.action.ts        — assertPermission('alerts.manage')
  update-alert-rule.action.ts        — assertPermission('alerts.manage')
  delete-alert-rule.action.ts        — assertPermission('alerts.manage')
  toggle-alert-rule.action.ts        — set enabled true/false
  test-alert-rule.action.ts          — fire a test webhook with `test: true`, no history row
```

### Webhook payload (standard format)

```json
{
  "rule_id": "uuid",
  "rule_name": "High error rate",
  "project_id": "uuid",
  "project_slug": "api-server",
  "organization_slug": "acme",
  "state": "firing",
  "previous_state": "ok",
  "triggered_at": "2026-05-01T12:34:56.789Z",
  "condition": {
    "type": "threshold",
    "count": 12,
    "threshold": 10,
    "windowMinutes": 5
  },
  "filter": { /* the EventFilters json */ },
  "sample_events": [
    {
      "id": "uuid",
      "timestamp": "2026-05-01T12:33:10.123Z",
      "level": "error",
      "message": "Database connection timeout",
      "error_type": "ConnectionTimeoutError",
      "source": "api"
    }
    /* up to 3 */
  ],
  "events_url": "https://logger.example.com/acme/api-server/events?range=15m&levels=error",
  "test": false
}
```

For test fires: same shape with `"test": true` and a fixed sample.

## Client-side artifacts

```
features/alerts/components/
  AlertsList.tsx                       — list view with "Show disabled" toggle
  AlertRow.tsx                         — name, state badge, last triggered, enable toggle
  AlertStateBadge.tsx                  — ok / firing / disabled
  
  AlertRuleEditor.tsx                  — main editor page composition
  AlertRuleEditorTabs.tsx              — Configuration | History
  
  configuration/
    NameDescriptionFields.tsx
    FilterBuilder.tsx                  — reuses event filter components from feature 04
    ConditionEditor.tsx                — `count >= N within last M minutes` form
    ChannelsEditor.tsx                 — list of channels with add/remove
    WebhookChannelForm.tsx             — URL + headers list
    NotificationOptions.tsx            — `notify_on_resolve` toggle
    TestFireButton.tsx                 — server action call, shows toast result
    EnableToggle.tsx
    SaveBar.tsx                        — sticky bottom on edit
  
  history/
    AlertHistoryTable.tsx
    AlertNotificationRow.tsx           — timestamp, state, delivery status, retry count
    DeliveryStatusBadge.tsx
```

### Hooks
- `features/alerts/hooks/use-alert-rule.ts` — reads rule via server-fetched data + Redux for optimistic updates
- `features/alerts/hooks/use-alert-history.ts` — paginated history

### i18n strings
Add `alerts.*` namespace:
```ts
alerts: {
    title: 'Alerts',
    empty: 'No alerts yet.',
    states: {
        ok: 'OK',
        firing: 'Firing',
        disabled: 'Disabled',
    },
    actions: {
        create: 'Create alert',
        edit: 'Edit',
        delete: 'Delete',
        enable: 'Enable',
        disable: 'Disable',
        testFire: 'Send test notification',
    },
    editor: {
        nameLabel: 'Alert name',
        filterTitle: 'Match events where...',
        conditionTitle: 'Trigger when...',
        countLabel: 'count is at least',
        windowLabel: 'within the last',
        minutes: 'minutes',
        channelsTitle: 'Notify via',
        addChannel: 'Add channel',
        webhookUrl: 'Webhook URL',
        addHeader: 'Add header',
        notifyOnResolve: 'Also notify when resolved',
    },
    history: {
        timestamp: 'Time',
        state: 'State',
        delivery: 'Delivery',
        attempts: 'Attempts',
    },
    delivery: {
        pending: 'Pending',
        delivered: 'Delivered',
        failed: 'Failed',
        retrying: 'Retrying',
    },
}
```

## Routes

```
/[org]/[project]/alerts                            alerts.read
  ?showDisabled=1                                  — query toggle
/[org]/[project]/alerts/new                        alerts.manage
/[org]/[project]/alerts/[id]                       alerts.read
  ?tab=configuration | history                     — default configuration
```

## Designs

- 🎨 Status: ⬜ not requested
- Destination: `docs/designs/screens/06-alerts/`
- Critical visuals:
  - Alerts list (with state badges)
  - **Rule editor** — composition of filter builder + condition + channels (most complex form in the product)
  - **FilterBuilder** consistency with events page filters
  - Webhook channel form with header pairs
  - Test fire result toast (success / failure variants)
  - History tab with delivery status badges
  - Retry indicator (which attempt is this)

## Implementation Checklist

### Schema
- [x] 1. Drizzle schema: `alert_rules`, `alert_notifications`. Generate migration 0008.
- [x] 2. Apply migration. Verify in `db:studio`.

### Filter / condition reuse
- [x] 3. Extract `EventFilters` Zod schema from feature 04 to a shared spot (`features/events/utils/event-schema.ts` or `shared/`). Both ingest filter validation and alert rules import.
- [x] 4. `condition` Zod schema: `z.object({ type: z.literal('threshold'), count: z.number().int().positive(), windowMinutes: z.number().int().min(1).max(1440) })`.
- [x] 5. `channels` Zod: array of webhook variants, `min(1)`.

### Services
- [x] 6. `alert-rules.service.ts`: CRUD with project scoping; `listEnabled()` returns rules where `enabled=true` AND project's `deleted_at IS NULL` (JOIN). Every UPDATE bumps `version` (`SET version = version + 1`).
- [x] 7. `alert-evaluator.service.ts::evaluateOne(rule)`:
  - Capture `rule.version` at read time.
  - Compute window: `[now - windowMinutes, now]`
  - Run count query: `SELECT COUNT(*) FROM events WHERE project_id=? AND timestamp >= ? AND timestamp < ? AND <filter clauses>`
  - Determine new state: `ok` if `count < threshold`, `firing` if `>=`
  - Compare with `rule.state`:
    - no transition → update `last_evaluated_at`, `last_match_count` with `WHERE id=? AND version=?`
    - transition → update state + `state_changed_at` + enqueue notification job(s) (skip resolved if `notify_on_resolve = false`), all with `WHERE id=? AND version=?`
  - **Optimistic concurrency**: if `UPDATE ... WHERE id=? AND version=?` reports 0 rows changed, the user edited the rule mid-evaluation. Skip — next tick will pick up the new version. Don't enqueue notifications based on stale filter/condition.
- [x] 8. `alert-evaluator.service.ts::evaluateAllEnabled()`:
  - Fetch all enabled rules (already filtered for live projects by step 6)
  - Process in parallel with concurrency cap (e.g. 10)
  - Catch per-rule errors so one bad rule doesn't kill the tick
- [x] 9. `build-payload.ts`: assemble payload shape (see above). Fetch 3 sample events using same query as evaluator. Build `events_url` from filter + project context.
- [x] 10. `alert-dispatcher.service.ts::deliver(notification)`:
  - POST to URL with custom headers, JSON body, 5s timeout
  - Classify response: 2xx → delivered; 4xx → failed (no retry); 5xx / timeout / network → retry
  - Update `alert_notifications` row accordingly
  - On retry → throw, pg-boss handles backoff
- [x] 11. Unit tests:
  - Evaluator: state transitions, no transition, threshold edge cases, disabled rule skipped
  - Dispatcher: 2xx/4xx/5xx classification, header injection, timeout
  - Payload builder: shape, sample events count, URL assembly

### Background jobs
- [x] 12. `alert-evaluation.job.ts`: pg-boss schedule cron `* * * * *`. Worker invokes `evaluateAllEnabled()`.
  - **Singleton execution**: register with `singletonKey: 'alert-evaluation'` (or wrap handler with `pg_advisory_xact_lock(<fixed-int>)`). Two worker replicas during a rolling restart must NOT both evaluate — duplicate notifications would result. Feature 08 also enforces `replicas: 1` on the worker service as a backstop.
- [x] 13. `alert-delivery.job.ts`: handler invokes dispatcher; pg-boss config: `retryLimit: 3`, `retryDelay: 30` (we'll use `retryBackoff: true` if explicit pattern unavailable, otherwise enqueue with explicit `startAfter` per attempt). Delivery jobs do NOT need singleton — pg-boss already guarantees a single job is consumed once across workers.
- [x] 14. Wire jobs into worker startup (worker container in feature 08; for dev — same Next.js process behind `WORKER_IN_PROCESS=true` env flag, shared with feature 03's partman job).
- [x] 15. Integration test: insert rule with low threshold → ingest events → wait one tick (or trigger evaluator manually) → assert notification row + outbound HTTP call (mock). Plus: edit rule mid-tick (simulate by bumping `version` between evaluator's read and write) → assert no notification enqueued.

### Server actions
- [x] 16. `create-alert-rule.action.ts` — Zod validate, `assertPermission('alerts.manage')`, insert with `version=1`.
- [x] 17. `update-alert-rule.action.ts` — same. On condition/filter change, reset state to `ok` (so a stale `firing` doesn't auto-resolve before next eval). Always bumps `version`.
- [x] 18. `delete-alert-rule.action.ts` — relies on `ON DELETE CASCADE` to clean up `alert_notifications` (FK declared in schema).
- [x] 19. `toggle-alert-rule.action.ts` — flips `enabled`. When disabling a `firing` rule, also reset state to `ok` (so re-enabling later doesn't fire spurious resolve). Bumps `version`.
- [x] 20. `test-alert-rule.action.ts` — builds payload with `test: true`, calls dispatcher synchronously, returns `{ ok, status, error? }`. Does NOT write `alert_notifications`. Does NOT bump `version`.

### Alerts list
- [x] 21. `app/[org]/[project]/alerts/page.tsx` — server component. List enabled by default; URL `?showDisabled=1` includes disabled.
- [x] 22. `AlertRow` columns: name, state badge, last triggered, channels summary, enable toggle, kebab menu (Edit / Delete / Test fire).
- [x] 23. Empty state with "Create alert" CTA (hidden if no `alerts.manage`).

### Rule editor
- [x] 24. `app/[org]/[project]/alerts/new/page.tsx` and `app/[org]/[project]/alerts/[id]/page.tsx` — render `AlertRuleEditor`.
- [x] 25. `AlertRuleEditor`:
  - Tabs Configuration / History (only on edit mode; new alerts have no history)
  - Sticky `SaveBar` with Save + Cancel + (on edit) Test fire + Enable toggle
- [x] 26. `FilterBuilder` — wraps event filter primitives from feature 04 into a controlled form. Output: `EventFilters` JSON.
- [x] 27. `ConditionEditor` — number input for count, number input for windowMinutes (range 1–1440 = 24h max).
- [x] 28. `ChannelsEditor` — list with add/remove. Each channel = `WebhookChannelForm`.
- [x] 29. `WebhookChannelForm` — URL input (Zod URL validation), headers as key/value pair list (add/remove).
- [x] 30. `NotificationOptions` — checkbox `notify_on_resolve`.
- [x] 31. `TestFireButton` — calls action, shows toast `"Test sent — got 200 OK"` or error.
- [x] 32. Form validation prevents save if any field invalid (gform-react validators).

### History tab
- [x] 33. `AlertHistoryTable` — paginated (offset for simplicity here; not high volume).
- [x] 34. `AlertNotificationRow` — timestamp (relative + absolute), state badge (firing/resolved), delivery badge (pending/delivered/failed/retrying), attempts count, expandable error detail on failed rows.

### i18n strings
- [x] 34a. Add `alerts.*` namespace to `core/i18n/dictionary.ts` (full key set defined above). Use `t()` everywhere — including delivery status badges, validation messages, confirm dialogs.

### Tests
- [x] 35. E2E (`e2e/alerts.spec.ts`):
  - Create rule with low threshold (`count >= 1 within 5m`) on `level=error`
  - Test fire → mock webhook receives test payload with `test: true`
  - Ingest one error event → wait/trigger evaluator → mock webhook receives firing payload with `test: false`
  - Wait 5 minutes (mock clock or fake) → no new events match → resolve fires → mock receives resolved payload
  - Disable rule → ingest events → no notifications
  - History tab shows all three rows (test fire NOT shown — it doesn't write history)

### Final
- [x] 36. Update PROGRESS.md → ✅ Done.
- [x] 37. Update Status block.
- [x] 38. End-to-end live check.

## Live check (full)

Standing up a real webhook endpoint (use `webhook.site` or local `nc -l 9000`):

1. Create rule "Errors > 0" with filter `level=error`, condition `count >= 1 within 5m`, channel `webhook` to your test URL.
2. Click Test Fire → endpoint receives JSON with `"test": true`. Toast `Test sent: 200 OK`.
3. Ingest one error event → wait up to 60s → endpoint receives `state: 'firing', previous_state: 'ok'` payload with that event in `sample_events`.
4. Stop ingesting errors. Wait > 5 min. Next evaluation → endpoint receives `state: 'ok', previous_state: 'firing'` payload.
5. Open `/alerts/[id]?tab=history` → see two rows: firing + resolved, both delivered, attempts 1.
6. Modify rule URL to a 500-returning endpoint. Trigger another firing → row shows status `retrying` → after 30s + 2m + 5m → final status `failed` with attempts 3.
7. Modify URL to a 400-returning endpoint. Trigger firing → row shows `failed` immediately, attempts 1.
8. Toggle Disable → ingest more errors → no new notifications. Re-enable → state remains `ok` (no spurious resolve).

## Tests

- Unit (Vitest): evaluator state transitions, dispatcher classification, payload builder.
- Integration: full evaluator + dispatcher cycle with mocked HTTP server.
- E2E (Playwright): `alerts.spec.ts` — full lifecycle.

## Open questions

- ❓ Concurrency cap on evaluator (10 default) — may need tuning if many rules. Document in this doc's Decision log if changed during implementation.
- ❓ Webhook URL validation: do we ban localhost / private IPs to avoid SSRF attacks? Internal tool — probably acceptable risk, but flag for security review pre-prod.

## Decision log (local)

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-01 | Optimistic concurrency on `alert_rules` via `version` column | Evaluator may run while user edits the rule; without check, evaluator overwrites edits and may notify on stale filter |
| 2026-05-01 | Evaluator schedule uses pg-boss singletonKey | Multi-replica worker (rolling restart) must not double-evaluate — that would send duplicate notifications |
| 2026-05-01 | `alert_rules → projects ON DELETE CASCADE`, `alert_notifications → alert_rules ON DELETE CASCADE` | Deleting a project / rule cleans up dependents at the DB level; no app-layer cascade code needed |
| 2026-05-01 | Evaluator's `listEnabled` JOIN-filters soft-deleted projects | Soft-deleted projects must not generate alerts; centralized at the query level |
| 2026-05-01 | i18n keys added in dedicated checklist step | Mirrors features 04/05 pattern |
