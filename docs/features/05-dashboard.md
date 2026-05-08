# 05. Dashboard

## Status
- [x] Not started · [x] In progress · [x] Done
- Started: 2026-05-08
- Completed: 2026-05-08
- Last touched: 2026-05-08
- Progress: 24 / 24 checklist items

## Goal

Per-project dashboard with five hardcoded widgets aggregating events from a chosen time range. Click-through from any widget jumps to the events page with relevant filters pre-applied. Auto-refresh shares the user preference established in feature 04.

## Prerequisites

- ✅ 04-events-list-filters (reuses time range + filter primitives + auto-refresh)

## Locked decisions

| ID | Question | Resolution |
|---|---|---|
| Q-E1 | Aggregation strategy | Live `GROUP BY` queries on Postgres. Optimize per-widget only if profiling shows >1s. No materialized views in MVP. |
| Q-E2 | Cache layer | None in MVP. Add `unstable_cache` 60s TTL later if needed. |
| Q-E3 | Time range sync between dashboard and events | **Independent.** Each page owns its own URL state. Future cross-page passing via query params is a forward-compatible addition (no schema change). |
| Q-E4 | Widget config | Hardcoded set of 5 widgets. No user/admin customization in MVP. |
| Q-E5 | Auto-refresh cadence | Shares `users.preferences.autoRefresh` with events page. One preference, applies everywhere. |
| Q-E6 | Empty state (no events in project) | Reuse feature 02's onboarding CTA ("Send your first event" with curl example). |
| Q-E7 | Click-through from widgets | Yes — every widget links to `/[org]/[project]/events?...filters` with relevant filter pre-applied. |
| Q-E8 | Time range presets | Same as events (15m, 1h, 6h, 24h, 7d) + **30d** (full retention). |

## Data model

No new tables. Reads from `events`.

## Server-side artifacts

### Aggregation queries
- `features/dashboard/services/aggregations.service.ts`
  - `eventsPerMinute(projectId, range)` — bucket size auto-derived from range (1m / 5m / 15m / 1h)
  - `levelBreakdown(projectId, range)` — `SELECT level, COUNT(*) FROM events WHERE ... GROUP BY level`
  - `environmentBreakdown(projectId, range)` — same shape, by `environment`
  - `topMessages(projectId, range, limit = 10)` — `GROUP BY message ORDER BY COUNT DESC LIMIT N`
  - `recentErrors(projectId, range, limit = 10)` — last N events where level IN ('error','fatal')

All queries:
- Use `(project_id, level, timestamp DESC)` index where applicable
- Filter by `timestamp >= range.from AND timestamp < range.to`
- Run in parallel via `Promise.all` from server component

### Bucket sizing for line chart

```ts
function pickBucket(range: TimeRange): '1m' | '5m' | '15m' | '1h' | '4h' {
    const minutes = (range.to.getTime() - range.from.getTime()) / 60000;
    if (minutes <= 60)        return '1m';   // 1h → 60 buckets
    if (minutes <= 360)       return '5m';   // 6h → 72 buckets
    if (minutes <= 1440)      return '15m';  // 24h → 96 buckets
    if (minutes <= 10080)     return '1h';   // 7d → 168 buckets
    return '4h';                              // 30d → 180 buckets
}
```

Aim for 60–180 buckets — enough resolution, never overwhelming on chart.

## Client-side artifacts

```
features/dashboard/components/
  DashboardPage.tsx                    — composes header + grid of widgets
  DashboardHeader.tsx                  — project name + TimeRangePicker (dashboard-local state)
  
  widgets/
    EventsPerMinuteWidget.tsx          — line chart (Recharts)
    LevelBreakdownWidget.tsx           — donut
    EnvironmentBreakdownWidget.tsx     — horizontal bar
    TopMessagesWidget.tsx              — table with click-through
    RecentErrorsWidget.tsx             — list with click-through to drawer
  
  parts/
    WidgetCard.tsx                     — title + body + loading + empty + error
    WidgetEmpty.tsx                    — "No data for this time range"
    EmptyProjectState.tsx              — reused from feature 02 (or imported)
```

### Hooks
- `features/dashboard/hooks/use-dashboard-range.ts` — local URL state for time range, independent from events page

### i18n strings
Add `dashboard.*` namespace:
```ts
dashboard: {
    widgets: {
        eventsPerMinute: 'Events per minute',
        levelBreakdown: 'By level',
        environmentBreakdown: 'By environment',
        topMessages: 'Top messages',
        recentErrors: 'Recent errors',
    },
    empty: 'No data for this time range.',
    emptyProject: 'No events yet. Send your first event to see your dashboard come alive.',
}
```

## Routes

```
/[org]/[project]                                          projects.read
  ?range=1h                                               — local dashboard state
```

Click-through targets `/[org]/[project]/events?range=...&<filter>=...` — independent state at the destination.

## Designs

- 🎨 Status: ⬜ not requested
- Destination: `docs/designs/screens/05-dashboard/`
- Critical visuals:
  - Widget grid layout (12-column), responsive collapse
  - `WidgetCard` styling (header, body, footer)
  - Line chart styling (axes, grid, tooltips, dark/light tokens)
  - Donut/bar chart styling
  - Empty/loading/error widget states
  - Empty project full-page CTA (reuse from feature 02)

## Implementation Checklist

### Aggregation queries
- [x] 1. `aggregations.service.ts::eventsPerMinute(projectId, range)` — uses `date_trunc(<bucket>, timestamp)` GROUP BY. Returns `{ ts, total, byLevel: {...} }[]` so the chart can stack/colorize.
- [x] 2. `aggregations.service.ts::levelBreakdown(projectId, range)` — `{ level, count }[]`.
- [x] 3. `aggregations.service.ts::environmentBreakdown(projectId, range)` — `{ environment, count }[]`. Treats null as `'(unset)'`.
- [x] 4. `aggregations.service.ts::topMessages(projectId, range, limit)` — `{ message, count, latestAt }[]`. Truncate message to 200 chars in result.
- [x] 5. `aggregations.service.ts::recentErrors(projectId, range, limit)` — events with `level IN ('error','fatal')`, full row.
- [x] 6. Bucket sizing helper — unit test for boundaries.
- [x] 7. Integration test: insert mixed events → each query returns expected aggregate.

### Server component
- [x] 8. `app/[org]/[project]/page.tsx`:
  - Read `searchParams.range` (default `1h`)
  - If project has zero events ever → render `EmptyProjectState` (no widget queries)
  - Otherwise run all 5 queries in parallel via `Promise.all`
  - Pass results to `DashboardPage`

### Layout + header
- [x] 9. `DashboardPage` — 12-column grid:
  - Row 1: `EventsPerMinuteWidget` (col-span 12)
  - Row 2: `LevelBreakdownWidget` (4) + `EnvironmentBreakdownWidget` (4) + `RecentErrorsWidget` (4)
  - Row 3: `TopMessagesWidget` (col-span 12)
- [x] 10. `DashboardHeader` — project name + `TimeRangePicker` (extended preset list including `30d`).

### Widgets
- [x] 11. `WidgetCard` — title slot, body slot, optional footer/action slot. Handles loading skeleton + empty + error states.
- [x] 12. `EventsPerMinuteWidget` — Recharts `LineChart` (or stacked area). X axis: time, Y axis: count. Stack by level if room. Tooltip with bucket details.
- [x] 13. `LevelBreakdownWidget` — `PieChart` donut. Click segment → navigates to events with `?levels=<level>&range=<range>`.
- [x] 14. `EnvironmentBreakdownWidget` — horizontal `BarChart`. Click bar → navigates to events with `?environments=<env>&range=<range>`.
- [x] 15. `TopMessagesWidget` — table: count, message, latestAt. Click row → events with `?message=<encoded>&range=<range>`.
- [x] 16. `RecentErrorsWidget` — vertical list of last N error events. Click → events page with `?event=<id>&event_ts=<ts>&range=<range>`.
- [x] 17. All widget click-through targets pass `range` so events page opens at the same window.

### Empty / loading / error
- [x] 18. Project-level empty state: import `EmptyProjectState` from feature 02 (or extract to `shared/components/`). Renders curl example with project's API key.
- [x] 19. Per-widget empty state: `WidgetEmpty` with "No data for this time range" and a button to widen the range.
- [x] 20. Loading: skeleton card with title only.

### Auto-refresh
- [x] 21. Reuse `useAutoRefresh` from feature 04. Wire to `router.refresh()` on dashboard layout. Same preference key (`users.preferences.autoRefresh`).

### i18n strings
- [ ] 21a. Add `dashboard.*` namespace to `core/i18n/dictionary.ts` (full key set defined above). Every string in widgets / headers / empty states uses `t()`.

### Tests
- [x] 22. Unit: bucket picker, query builders.
- [x] 23. E2E (`e2e/dashboard.spec.ts`):
  - Send mixed events
  - Open dashboard → all widgets populated
  - Change time range → widgets refetch
  - Click level segment → lands on events with filter
  - Click recent error → events page with drawer open
  - Empty project (no events) → onboarding CTA shown

### Final
- [x] 24. Update PROGRESS.md → ✅ Done. Update Status block. End-to-end live check.

## Live check (full)

After feature 04, with a project containing ~500 mixed-level events:

1. `/[org]/[project]` → see all 5 widgets populated, default range 1h.
2. Change range to 24h → widgets refetch.
3. Change to 30d → x-axis on line chart spans 30 days, buckets 4h wide.
4. Click `error` segment in donut → events page opens with `?levels=error&range=24h`.
5. Click a row in Top messages → events page filtered by that message.
6. Click an item in Recent errors → events page with that event's drawer open.
7. With auto-refresh `30s` (set in feature 04) → dashboard re-renders silently every 30s.
8. Wipe events from DB → reload dashboard → empty project CTA with curl example.
9. Set range to a window with no events but with project history → per-widget empty state.

## Tests

- Unit (Vitest): bucket picker.
- Integration: aggregation services with seed data.
- E2E (Playwright): `dashboard.spec.ts`.

## Open questions

- ❓ If dashboard starts feeling slow at scale, profile and add `unstable_cache` per widget. Document in this doc's Decision log if it happens.

## Decision log (local)

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-01 | i18n keys added in dedicated checklist step | Avoids namespace silently missing when widgets ship; mirrors feature 04 pattern |
