# 07. Polish

## Status
- [ ] Not started · [ ] In progress · [ ] Done
- Started: —
- Completed: —
- Last touched: 2026-05-01 (planning)
- Progress: 0 / 32 checklist items

## Goal

Bring the app from "functional MVP" to "production-quality". Adds error/loading/empty boundaries everywhere, accessibility pass, performance audit, unified toast system, slow-query logging, extended health checks, version endpoint, password-change session revocation. No new features — only hardening.

## Prerequisites

- ✅ Features 01–06 (most polish work touches existing screens)

## Locked decisions

| ID | Question | Resolution |
|---|---|---|
| Q-G1 | Polish scope | 8 must-have areas (this doc). Saved views, export, shortcuts, bulk actions, audit-log UI, project transfer — deferred to dedicated future features. |
| Q-G2 | Global error boundary | Plain "Something went wrong" + retry + home link. No user-side error reporting (we ARE the logger). |
| Q-G3 | 404 page | Custom but simple — title + back-to-dashboard CTA. No smart suggestions. |
| Q-G4 | Permission denied | Explicit 403 page with clear "ask your admin" copy. NOT masked as 404. |
| Q-G5 | Slow query detection | Drizzle middleware logs queries > 500ms via pino at WARN. No Prometheus in MVP. |
| Q-G6 | Form pattern consistency | Sweep features 01–06 for: submit-button loading, post-submit toast, inline field errors. Unify. |
| Q-G7 | Telemetry endpoints | `/api/version` (git SHA, build date) + `/api/health/ready` extended (DB, pg-boss, last ingest, migrations). |

## What's in scope (8 areas)

1. **Error / loading / not-found boundaries** for every route segment
2. **Empty states** audit + completion across all screens
3. **Loading skeletons** replacing any remaining spinners (except inside buttons)
4. **pg_partman maintenance verification** (alert if it stops running)
5. **Account security**: revoke other sessions on password change
6. **Accessibility pass**: keyboard nav, focus rings, contrast, aria-labels, SR-friendly toasts
7. **Performance pass**: bundle analysis, slow-query logging, N+1 audit
8. **Unified toast system** (replace any inline toast usage)

## What's out of scope (deferred)

- Saved filter views (events, alerts) — separate feature
- Export to JSON / CSV — separate feature
- Keyboard shortcuts — separate feature
- Bulk actions (multi-select + delete events, etc.) — separate feature
- Audit log UI — separate feature
- Project transfer between orgs — separate feature
- 2FA / TOTP — separate security feature
- Open registration toggle UI — separate feature
- Self-monitoring (logger watching its own logs) — separate idea

## Server-side artifacts

### Telemetry
- `app/api/version/route.ts` — returns `{ sha, builtAt, nodeVersion, nextVersion }` (env vars set at build time)
- Extend `app/api/health/ready/route.ts`:
  - DB ping (existing)
  - pg-boss connection alive
  - Last successful event ingest within 1h (warn header if not)
  - Latest applied Drizzle migration matches expected manifest

### Drizzle middleware
- `core/db/middleware/slow-query-logger.ts` — wraps Drizzle to time queries; logs at WARN if > 500ms

### Session revocation
- Update `update-password.action.ts` (feature 01) — after successful password change, revoke all sessions except the one performing the change

### pg_partman watchdog
- Update `partman-maintenance.job.ts` — if `run_maintenance()` errors, log at ERROR. Optional: insert into `events` table itself a `level=fatal` event with `source='partman-watchdog'` so the alert system can pick it up if a rule is configured.

## Client-side artifacts

```
shared/components/
  Toast/                          — central toast system
    Toaster.tsx                   — provider (renders queue), used in app/layout.tsx
    parts/
      ToastItem.tsx
    types.ts                      — ToastInput
  
  ErrorBoundary/
    GlobalErrorPage.tsx           — used by app/error.tsx
    NotFoundPage.tsx              — used by app/not-found.tsx
    ForbiddenPage.tsx             — for 403 cases (rendered by feature pages)
  
  Skeletons/
    TableSkeleton.tsx
    WidgetSkeleton.tsx
    CardSkeleton.tsx
    ListSkeleton.tsx
    PageSkeleton.tsx
```

### Hooks
- `shared/hooks/use-toast.ts` — `const { show } = useToast(); show({ kind: 'success', message: '...' })`

### Per-route boundaries

For each `app/<segment>/`:
- `error.tsx` — uses `GlobalErrorPage`
- `not-found.tsx` — uses `NotFoundPage`
- `loading.tsx` — uses appropriate skeleton if not already inline

### Accessibility utilities
- `shared/utils/aria.ts` — helpers for stable IDs, sr-only text
- All icon-only buttons get `aria-label` audited

### i18n strings
Add `errors.*`, `notFound.*`, `forbidden.*`, `version.*` namespaces.

## Implementation Checklist

### Telemetry
- [ ] 1. `/api/version/route.ts` — read env vars `NEXT_PUBLIC_BUILD_SHA`, `NEXT_PUBLIC_BUILD_TIME` (set during build).
- [ ] 2. Extend `/api/health/ready/route.ts` checks: pg-boss alive (`boss.getQueueSize()` returns), last ingest event within 1h (warn header), expected migrations match.
- [ ] 3. README section: monitoring endpoints summary.

### Slow query logging
- [ ] 4. Drizzle wrapper that times each statement; logs `{ sql, duration_ms, params_count }` at WARN if duration > 500ms.
- [ ] 5. Live check: write a deliberate slow query in a script (e.g. cross join), see warning in logs.

### Boundary files
- [ ] 6. `app/error.tsx` (root) — uses `GlobalErrorPage`. Contains "Try again" button (resets via `reset` prop).
- [ ] 7. `app/not-found.tsx` (root) — uses `NotFoundPage`.
- [ ] 8. Per-segment `error.tsx` for: `app/[org]`, `app/[org]/[project]`, `app/[org]/[project]/events`, `app/[org]/[project]/alerts`, `app/[org]/settings`. Provides scoped retry without losing layout.
- [ ] 9. Per-segment `not-found.tsx` for the same segments — preserves nav context.
- [ ] 10. Per-segment `loading.tsx` for events page, dashboard, projects list, alerts list, members. Use appropriate skeletons.

### 403 / permission denied
- [ ] 11. `ForbiddenPage` component — title, body explaining who to ask, "Go back" button.
- [ ] 12. Server actions throw `ForbiddenError` (already in feature 01 from `assertPermission`). Action results render toast + redirect to current page (not 403 page) — UX preservation.
- [ ] 13. Server components: when permission check fails inline → render `ForbiddenPage`. Not redirect (URL stays so user can copy and ask admin).

### Empty states audit
- [ ] 14. Sweep all list / grid screens. Verify each has an empty state with appropriate copy + CTA when applicable. Document any missing in this doc's Decision log.
- [ ] 15. Add `EmptyMembers` for `/[org]/team` if missing (only owner = empty otherwise list).

### Loading skeletons
- [ ] 16. Sweep features 01–06 for `<Spinner />` usage. Replace with skeleton variants except inside buttons (button spinner OK).
- [ ] 17. `TableSkeleton`, `WidgetSkeleton`, `CardSkeleton`, `ListSkeleton`, `PageSkeleton` components — use design-system tokens.
- [ ] 18. Verify Suspense boundaries use skeletons.

### Toast system
- [ ] 19. `Toaster` provider added to `app/layout.tsx` once. Singleton via Redux slice or a ref store (pick simpler — Redux fits since we have it).
- [ ] 20. `useToast()` hook exposing `show({ kind, message, durationMs? })`.
- [ ] 21. Sweep features 01–06 for any inline toast/notification implementations. Migrate to central system.
- [ ] 22. ARIA: toasts have `role="status"` (info) or `role="alert"` (error). Live region.

### Account security
- [ ] 23. Update `update-password.action.ts` — after successful password change, run `DELETE FROM sessions WHERE user_id = ? AND id != ?` (current session). Toast confirms "Other sessions signed out".
- [ ] 24. E2E test for this in `auth.spec.ts`.

### pg_partman watchdog
- [ ] 25. `partman-maintenance.job.ts` — wrap call in try/catch. On error: log at ERROR with full diagnostics. Optionally insert a synthetic event with `source='partman-watchdog', level='fatal'` so an alert rule can fire on it.
- [ ] 26. Document recommended alert rule in README ("Setup self-monitoring alert: filter `source='partman-watchdog'`, threshold 1 in 1h").

### Accessibility pass
- [ ] 27. Keyboard nav check on every primary screen (events page, dashboard, alert editor, settings). All interactive elements reachable, focus visible.
- [ ] 28. Contrast audit on dark and light themes — all text ≥ 4.5:1 (AA), large text ≥ 3:1. Use a checker tool.
- [ ] 29. Aria labels for icon-only buttons (close, edit, delete, kebab, etc.).
- [ ] 30. Toast live region announcement verified with VoiceOver / NVDA.

### Performance pass
- [ ] 31. `next build` → review bundle analyzer output. Lazy-load any 100kb+ widget/component (drawer detail, alert editor, charts).
- [ ] 32. Run `EXPLAIN ANALYZE` on top 10 events queries from logs (use grep on production-like data) — fix any with seq scan that should hit index.

### Form consistency sweep
- [ ] 33. Audit forms in features 01–06:
  - Submit button shows loading (disabled + small spinner)
  - On success → toast + appropriate redirect / refresh
  - On error → toast (if generic) AND/OR inline (if field-specific)
- [ ] 34. Document any deviations or update individual feature checklist.

### Final
- [ ] 35. Update PROGRESS.md → ✅ Done.
- [ ] 36. Update Status block.
- [ ] 37. End-to-end live check.

> **Note**: total checklist count is 37 (not 32 — I miscounted upfront). Status block updated to reflect.

## Live check (full)

Hard to script end-to-end since polish touches everything. Spot-check:

1. Navigate to a non-existent route under `/[org]/projects/zzz` → custom 404 with back-to-dashboard.
2. Force an error in a server component (temporary throw) → custom error page with retry.
3. Sign in as `Viewer` and visit `/[org]/settings/roles` → 403 page with explanation.
4. Toggle theme to light → contrast checker passes.
5. Tab through the events page — focus moves predictably, all controls reachable.
6. `curl /api/version` → JSON with sha, build time.
7. `curl /api/health/ready` → all checks pass.
8. Stop pg-boss connection (kill connection in db) → `/api/health/ready` returns 503 within 30s.
9. Manually invoke `update-password` → other sessions revoked.
10. Run a deliberate slow query → WARN appears in logs.
11. Open events page on slow connection → skeleton appears, no spinner.
12. Submit a form successfully → toast appears top-right, dismissable.

## Tests

- E2E (`e2e/error-boundaries.spec.ts`) — error/404/403 pages render correctly.
- E2E updates to existing specs as needed (toasts, session revocation).
- Unit: slow-query logger threshold logic, version endpoint.

## Open questions

None outstanding.

## Decision log (local)

(Empty — populated during implementation.)
