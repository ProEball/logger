# 04. Events list + filters + detail

## Status
- [x] Done
- Started: 2026-05-08
- Completed: 2026-05-08
- Last touched: 2026-05-08
- Progress: 42 / 42 checklist items

## Goal

The core read flow. A dense paginated table of events with multi-field filters in a top toolbar (chip-based), full-text search on `message`, time range picker, and a right-side drawer for full event detail (attributes, context, stack trace). Filters live in the URL — every state is shareable. Auto-refresh is a user preference (Redux + DB).

## Prerequisites

- ✅ 03-ingest (need events in DB to display)

## Locked decisions

| ID | Question | Resolution |
|---|---|---|
| Q-D1 | Filter UI placement | Top toolbar, chip-based. Each active filter is a chip with `×` to remove. "Add filter" dropdown for new filters. Time range picker on the right. |
| Q-D2 | Filter persistence | URL query params only. Shareable links are a power feature. SSR sees filters via `searchParams`. |
| Q-D3 | Pagination | Keyset/cursor based. URL: `?before_ts=...&before_id=...`. UI: "← Newer" / "Older →" buttons. No total count. |
| Q-D4 | Detail view | Right drawer (520 px). URL `?event=<id>` makes the drawer state shareable. Full-page detail deferred. |
| Q-D5 | Stack trace | Collapsed by default with "View stack trace (N frames)" trigger. On expand: per-frame collapsibles with syntax highlight. Long lines: horizontal scroll, no wrap. |
| Q-D6 | Attributes / context | `attributes`: KeyValue list, alphabetized, hover-action "Filter by this". `context`: collapsible JSON tree like DevTools. |
| Q-D7 | Saved views | Not in MVP. URL filters are shareable; users bookmark in browser. |
| Q-D8 | Event export | Not in MVP. |
| Q-D9 | Timestamp display | Table: `MMM dd HH:mm:ss.SSS` in user's local TZ. Drawer: full local + UTC in tooltip/parens. Tooltip on hover anywhere shows relative ("2 min ago"). |
| Q-D10 | Message text search | Postgres full-text search via `to_tsvector` + GIN. UX hint: quotes for exact phrase. |
| Q-D11 | Auto-refresh state | `users.preferences.autoRefresh: 'off' \| '10s' \| '30s' \| '60s'`. Default `'off'`. Synced via Redux + `update-preferences.action.ts` (existing in feature 01). |

## Data model

No new tables. Reads from `events` (created in feature 03).

### `users.preferences` extension

The jsonb column gains a new key. No migration needed — extend the TypeScript type:

```ts
// core/db/schema/users.ts (or types file)
export type UserPreferences = {
    theme: 'dark' | 'light' | 'system';        // CC1, feature 01
    autoRefresh: 'off' | '10s' | '30s' | '60s'; // Q-D11, this feature
};
```

Default for new users: `{ theme: 'dark', autoRefresh: 'off' }`.

## Server-side artifacts

### Query
- `features/events/services/events-query.service.ts`
  - `listEvents(projectId, filters, cursor)` → returns `{ events, nextCursor }`. Builds dynamic Drizzle query.
  - `getEventById(projectId, id, ts)` — efficient lookup using composite PK; needs timestamp to hit the right partition.
  - `searchMessages(projectId, q)` helper using tsquery.

### Filter parsing
- `features/events/utils/parse-filters.ts` — `URLSearchParams` → typed `EventFilters`. Validates with Zod.
- `features/events/utils/serialize-filters.ts` — `EventFilters` → URLSearchParams. Round-trip safe.
- `features/events/utils/parse-cursor.ts` — `before_ts`, `before_id` → `Cursor`.

### Filter shape

```ts
type EventFilters = {
    range:       TimeRange;                          // { type: 'preset', value: '1h' } | { type: 'custom', from, to }
    levels?:     Array<'debug' | 'info' | 'warn' | 'error' | 'fatal'>;
    environments?: string[];
    sources?:    string[];
    releases?:   string[];
    errorTypes?: string[];
    userId?:     string;
    sessionId?:  string;
    requestId?:  string;
    traceId?:    string;
    message?:    string;                             // tsquery input
    attributes?: Array<{ key: string; value: string }>;  // ANDed
};
```

`TimeRange` presets: `15m`, `1h`, `6h`, `24h`, `7d`, custom.

### Routes (server components)
- `app/[org]/[project]/events/page.tsx` — server component. Reads `searchParams`, queries via service, renders table + drawer if `?event=<id>`.

## Client-side artifacts

```
features/events/components/
  EventsPage.tsx                — composes filter bar + table + drawer
  EventsTable.tsx               — virtualized? Probably not — keyset pagination caps page size
  EventRow.tsx
  EventTimestamp.tsx            — local time + tooltip
  LevelBadge.tsx                — uses CC1 theme tokens
  
  filters/
    FilterBar.tsx               — top toolbar
    FilterChip.tsx
    AddFilterDropdown.tsx
    LevelFilter.tsx
    EnvironmentFilter.tsx
    SourceFilter.tsx
    ReleaseFilter.tsx
    ErrorTypeFilter.tsx
    CorrelationFilter.tsx       — user_id / session_id / request_id / trace_id
    AttributeFilter.tsx
    MessageFilter.tsx           — search input with debounce
    TimeRangePicker.tsx         — preset list + custom range
  
  detail/
    EventDrawer.tsx             — controlled by ?event= URL param
    EventDetailHeader.tsx       — level badge, message, timestamp, copy-as-JSON
    EventDetailTabs.tsx         — Details / Attributes / Context / Stack trace
    AttributesList.tsx          — KeyValue with "Filter by" actions
    ContextTree.tsx             — JSON tree, collapsible
    StackTraceViewer.tsx        — collapsed by default, frame-level toggle
    StackFrame.tsx
  
  pagination/
    PaginationControls.tsx      — Newer / Older buttons + page indicator
  
  auto-refresh/
    AutoRefreshControl.tsx      — bound to user.preferences.autoRefresh; calls update-preferences action

features/events/hooks/
  use-event-filters.ts          — reads/writes URL params via Next router
  use-events.ts                 — TanStack Query for fetching with cursor
  use-auto-refresh.ts           — interval based on user.preferences
```

### Redux
- Existing `core/store/slices/user.ts` (from feature 01) already holds `preferences`. No new slice.
- Add helper selector: `selectAutoRefresh = (s) => s.user.preferences.autoRefresh`.

### Strings
Add `events.*` namespace to `core/i18n/dictionary.ts`:
```ts
events: {
    title: 'Events',
    empty: 'No events match your filters.',
    filters: {
        addFilter: 'Add filter',
        level: 'Level',
        environment: 'Environment',
        // ...
    },
    pagination: {
        newer: 'Newer',
        older: 'Older',
    },
    autoRefresh: {
        label: 'Auto-refresh',
        off: 'Off',
        seconds: '{{n}}s',
    },
    detail: {
        details: 'Details',
        attributes: 'Attributes',
        context: 'Context',
        stackTrace: 'Stack trace',
        copyAsJson: 'Copy as JSON',
        viewStackTrace: 'View stack trace ({{frames}} frames)',
    },
}
```

## Routes

```
/[org]/[project]/events                                   events.read
  ?range=1h
  &levels=error,fatal
  &environments=prod
  &message=timeout
  &attribute.user_email=john@example.com
  &before_ts=...&before_id=...                            — cursor
  &event=<id>                                             — drawer open
```

All filter state in URL. Reload-safe, share-safe.

## Designs

- 🎨 Status: ⬜ not requested
- Destination: `docs/designs/screens/04-events/`
- Critical visuals (highest design impact in the product):
  - **Filter bar** with chips — chip styling, "Add filter" dropdown, time range picker integration
  - **Events table row** — density, level badge, message ellipsis, timestamp format, hover state
  - **Event drawer** — header, tabs, content area scrolling, close affordances
  - **Stack trace viewer** — collapsed/expanded states, syntax highlight, frame chevrons
  - **Attributes list** with hover "Filter by" action
  - **JSON tree** for context
  - **Empty state** — "No events match your filters" with "Clear filters" CTA
  - **Loading state** — skeleton rows
  - **Auto-refresh control** — placement (toolbar? near pagination?)

## Implementation Checklist

### Filter parsing infrastructure
- [x] 1. `features/events/utils/parse-filters.ts` — Zod schema for `EventFilters`. Coerces array params (`levels=error,fatal` → `['error','fatal']`). On invalid input: **strip the offending key, keep valid ones, log WARN**. Never 400 the page render — a stale or malformed share link should still load with usable defaults.
- [x] 2. `serialize-filters.ts` — round-trip safe.
- [x] 3. `parse-cursor.ts`. Cursor is parsed independently of filters; an invalid cursor resets to "first page" (drop `before_ts`, `before_id`).
- [x] 4. Unit test: parse → serialize → parse equals identity for all branches. Plus: invalid level value drops only the level filter, other filters survive.

### Query service
- [x] 5. `events-query.service.ts::listEvents(projectId, filters, cursor)`:
  - Build Drizzle query with conditional WHERE clauses
  - **JOIN projects + filter `projects.deleted_at IS NULL`** — soft-deleted projects must not leak events through API. The route layer (`[project]/layout.tsx`) already 404s, but defense in depth.
  - For `message`: `to_tsvector('simple', message) @@ websearch_to_tsquery('simple', $q)`
  - For `attributes`: `attributes @> '{"key":"value"}'::jsonb`
  - Cursor: `WHERE (timestamp, id) < (:before_ts, :before_id) ORDER BY timestamp DESC, id DESC LIMIT 51`
  - Return up to 50 events + a `hasMore` flag (51st row signals more)
- [x] 6. `getEventById(projectId, id, ts)` — composite-PK lookup; require `ts` in URL too for partition pruning (drawer URL will include `&event_ts=`).
- [x] 7. Integration test: insert 100 events via ingest → filter by level → cursor pagination → all reachable. Plus: soft-delete the project → query returns empty.

### Server component
- [x] 8. `app/[org]/[project]/events/page.tsx`:
  - Read `searchParams`, parse filters
  - Call query service
  - Render `EventsPage` component with results
  - If `?event=<id>` present → also fetch single event for drawer

### Filter bar
- [x] 9. `FilterBar` — composition of chips for active filters + `AddFilterDropdown` + `TimeRangePicker`
- [x] 10. `useEventFilters` hook — wraps `useSearchParams` + `useRouter`. Provides `filters`, `setFilter(key, value)`, `removeFilter(key)`, `clearAll()`.
  - **Cursor reset on filter change**: every `setFilter` / `removeFilter` / `clearAll` / `setRange` MUST also strip `before_ts` and `before_id` from the URL. Otherwise a stale cursor (pointing to events that no longer match) yields confusing empty pages. Centralize this in the hook, not at call sites.
- [x] 11. Each filter component (`LevelFilter`, `EnvironmentFilter`, etc.) — popover with multi-select. On apply → updates URL.
- [x] 12. `MessageFilter` — debounced 300 ms input.
- [x] 13. `AttributeFilter` — `key` + `value` inputs. Multiple active = ANDed.
- [x] 14. `TimeRangePicker` — preset list (15m, 1h, 6h, 24h, 7d) + "Custom" opens datetime range inputs. Custom range inputs are interpreted in the user's local TZ; converted to UTC before serializing into the URL (URL stores ISO UTC strings — share-safe across TZs).
- [x] 15. Live check: every filter type updates URL → page re-fetches → results filter correctly. Switching filter while on page 5 (cursor set) → page resets to first page automatically.

### Events table
- [x] 16. `EventsTable` — Table component (from design system), sticky header, dense rows.
- [x] 17. `EventRow` — cells: timestamp, level badge, message (truncate), source, environment, chevron.
- [x] 18. `EventTimestamp` — `Intl.DateTimeFormat` to user TZ; tooltip with full + UTC + relative.
- [x] 19. Click row → updates URL with `?event=<id>&event_ts=<ts>` (drawer opens).
- [x] 20. Empty state when query returns nothing: copy + "Clear filters" CTA.
- [x] 21. Loading skeleton while fetching.

### Pagination
- [x] 22. `PaginationControls` — "Newer" disabled if first page; "Older" disabled if `hasMore=false`.
- [x] 23. URL update strategy: "Older" sets `before_ts/before_id` from last row; "Newer" pops them from history (router back).
- [x] 24. Live check: navigate Older across multiple pages → Newer back.

### Drawer + detail
- [x] 25. `EventDrawer` — controlled by `?event=` URL param. Closing → router replace with param removed.
- [x] 26. `EventDetailHeader` — large level badge, message, timestamp (full), Copy as JSON button.
- [x] 27. `EventDetailTabs` — Details / Attributes / Context / Stack trace. URL: `?event=...&tab=attributes`.
- [x] 28. `AttributesList` — KeyValue rendering, sorted alphabetically, hover-row "Filter by" button (adds `attribute.<key>=<value>` to URL and closes drawer).
- [x] 29. `ContextTree` — recursive JSON tree, collapsible nodes, primitive values inline.
- [x] 30. `StackTraceViewer` — collapsed initially with frame count. On expand: parse stack into frames (heuristic for V8 / Python / Java formats; document supported formats).
- [x] 31. `StackFrame` — file:line, function name, optional code preview placeholder.
- [x] 32. Live check: open drawer, switch tabs (URL persists), click "Filter by" attribute, drawer closes & filter applies.

### Auto-refresh
- [x] 33. `AutoRefreshControl` — segmented control: Off / 10s / 30s / 60s. Reads from Redux `user.preferences.autoRefresh`. On change calls `update-preferences.action.ts` (feature 01).
- [x] 34. `useAutoRefresh()` hook — `setInterval` calling `router.refresh()` (or query refetch) at the chosen interval. Pause when tab not visible (use `document.visibilityState`).
- [x] 35. Place control in events page toolbar near pagination.
- [x] 36. Live check: set 10s → wait → table reloads silently → switch to off → reloads stop. Hide tab → no requests.

### i18n strings
- [x] 37. Add `events.*` namespace to `core/i18n/dictionary.ts` (full key set defined above). Use `t()` everywhere — no string literals in JSX.

### Tests
- [x] 38. Unit: filter parse/serialize round-trip, timestamp formatter, stack trace frame parser.
- [x] 39. Integration: query service with various filter combinations.
- [x] 40. E2E (`e2e/events.spec.ts`):
  - Send events via ingest
  - Open events page → see them
  - Apply level filter → URL updates → only error/fatal shown
  - Apply attribute filter via row hover → only matching shown
  - Open drawer → switch tabs → close
  - Pagination Older / Newer
  - Auto-refresh: set 10s → mock time → assert refetch happened

### Final
- [x] 41. Update PROGRESS.md → ✅ Done. Update Status block.
- [x] 42. End-to-end live check.

## Live check (full)

After feature 03, with a project containing ~500 mixed-level events:

1. `/[org]/[project]/events` → table shows last ~50 events, sorted DESC by timestamp.
2. Click "Add filter" → "Level" → check `error`, `fatal` → URL gets `?levels=error,fatal` → table filters.
3. Click an event row → drawer opens → URL gets `?event=<id>&event_ts=<ts>`.
4. In drawer → switch to Attributes tab → URL `&tab=attributes` → see KeyValue list.
5. Hover an attribute → click "Filter by" → drawer closes → URL contains `&attribute.<k>=<v>` → table re-filters.
6. Click "Older" → cursor URL → next 50 events.
7. Click "Newer" → back to first page.
8. Search box → type "timeout" → after 300 ms debounce → results match.
9. Set time range to "Last 6 hours" → URL updates → events outside range disappear.
10. Auto-refresh control → set "30s" → preference saved (verify by reloading; setting persists). Hide tab → no requests; show tab → request fires.
11. Stack trace: click an error event with stack → drawer Stack trace tab → click "View stack trace" → frames expand. Click individual frame → expanded.

## Tests

- Unit (Vitest): filter parser, timestamp formatter, stack trace parser.
- Integration: events query service with filter matrix.
- E2E (Playwright): `events.spec.ts`.

## Open questions

- ❓ Stack trace parser — which formats to support in MVP? Suggest: V8 (Node, Chrome), Python, Java. Document unsupported formats fall back to raw monospace block. Decide during implementation.

## Decision log (local)

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-01 | Filter parser strips invalid keys instead of 400ing the page | Stale share links / typos shouldn't break the screen; users see what we could parse + log warns server-side |
| 2026-05-01 | `useEventFilters` resets cursor on every filter change | Stale cursor against new filter set yields confusing empty results; centralize so call sites can't forget |
| 2026-05-01 | events query JOINs projects + filters `deleted_at IS NULL` | Defense in depth; route layer already 404s for soft-deleted projects but the query is the canonical boundary |
| 2026-05-01 | Custom time range converted local→UTC before URL serialize | Share links must be TZ-independent |
