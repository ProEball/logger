# 00. Foundation

## Status
- [ ] Not started · [ ] In progress · [ ] Done
- Started: —
- Completed: —
- Last touched: —
- Progress: 0 / 49 checklist items

## Goal

Prepare the project so any feature can be built on top: install all dependencies, scaffold the FDD folder structure, configure tooling (Drizzle, SCSS, Redux, Vitest, Playwright), wire a local Postgres via docker-compose, add health endpoints. Standalone deliverable — at the end of this phase, `npm run dev` works and `/api/health/ready` returns 200 with DB connected.

## Prerequisites

None. This is the first phase.

## Locked decisions

From PLAN.md §2:
- Postgres 16 (local via docker-compose during dev)
- Drizzle ORM with `drizzle-kit` migrations
- better-auth (installed in foundation, configured in feature 01)
- pg-boss (installed in foundation, used in feature 06)
- pino → stdout for logging
- Recharts for charts (installed but not used yet)
- Redux Toolkit for global state (user, theme, lang)
- SCSS modules, no Tailwind, no CSS-in-JS
- Zod for validation everywhere
- gform-react for forms
- Vitest + RTL + Playwright for tests
- TypeScript strict mode
- 4-space indent, semicolons required (project rule)
- `@/` alias mapped to project root

## Data model

No business tables yet. Foundation creates only an empty migration baseline so feature 01 can layer on top.

## Server-side artifacts

- `core/db/client.ts` — Postgres client + Drizzle instance
- `core/db/schema/` — empty barrel for now
- `core/env/index.ts` — Zod-validated env (via `@t3-oss/env-nextjs`)
- `core/i18n/dictionary.ts` — English dictionary (typed, nested)
- `core/i18n/t.ts` — typed `t(key)` lookup with `NestedKeys<T>`
- `core/theme/cookie.ts` — read/write theme cookie (`logger_theme`)
- `shared/services/logger.ts` — pino instance
- `app/api/health/route.ts` — liveness
- `app/api/health/ready/route.ts` — readiness (DB ping)

## Client-side artifacts

- `core/store/index.ts` — Redux Toolkit configureStore
- `core/store/Provider.tsx` — client-side Provider component
- `core/store/slices/theme.ts` — theme slice (`'dark' | 'light' | 'system'`, default `'dark'`)
- `core/theme/ThemeProvider.tsx` — resolves `system` → actual, sets `data-theme` on `<html>`
- `app/layout.tsx` — wires Redux Provider, ThemeProvider, no-flash inline script
- `app/styles/_tokens.scss` — placeholder (real tokens come from design-system output)
- `app/styles/_themes.scss` — `[data-theme="dark"]` + `[data-theme="light"]` blocks defining custom properties
- `app/globals.scss` — base reset

## Routes

```
GET /api/health        public — liveness
GET /api/health/ready  public — readiness (returns 503 if DB unreachable)
```

No UI routes yet beyond the default Next.js scaffold page.

## Designs

Not applicable for foundation. Design system + screen designs come in feature 01+.

## Implementation Checklist

### Dependencies
- [ ] 1. Install runtime deps:
  ```
  npm i drizzle-orm postgres better-auth pg-boss pino zod @reduxjs/toolkit react-redux @t3-oss/env-nextjs sass recharts
  ```
- [ ] 2. Install dev deps:
  ```
  npm i -D drizzle-kit pino-pretty vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom @vitejs/plugin-react @playwright/test
  ```
- [ ] 3. Add `gform-react` (project rule) — `npm i gform-react`
- [ ] 4. Verify `package.json` lockfile updated, no peer-dep warnings

### Folder structure
- [ ] 5. Create empty folders with `.gitkeep`:
  - `core/db/schema/`
  - `core/store/`
  - `core/auth/` (placeholder)
  - `core/env/`
  - `shared/components/`
  - `shared/services/`
  - `shared/hooks/`
  - `shared/utils/`
  - `shared/permissions/`
  - `features/`
  - `e2e/`
- [ ] 6. Update `tsconfig.json` paths: `"@/*": ["./*"]`
- [ ] 7. Verify TS picks up `@/` imports — write a quick `import { x } from '@/core/env'` test (will fail until step 14, that's fine)

### Env handling
- [ ] 8. Create `.env.example` with: `DATABASE_URL`, `NODE_ENV`
- [ ] 9. Create local `.env.local` (gitignored already) with dev values pointing to local Postgres
- [ ] 10. Create `core/env/index.ts` using `@t3-oss/env-nextjs` with Zod schema for both server-only (`DATABASE_URL`) and shared vars
- [ ] 11. Document env var conventions in this doc's Decision log if anything non-obvious comes up

### Database — local dev
- [ ] 12. Create `docker-compose.dev.yml` with single postgres:16 service, ports `5432:5432`, named volume
- [ ] 13. Document `docker compose -f docker-compose.dev.yml up -d` in README
- [ ] 14. Live check: `psql $DATABASE_URL -c 'SELECT 1'` returns 1

### Drizzle
- [ ] 15. Create `drizzle.config.ts` with output dir `./core/db/migrations` and schema dir `./core/db/schema`
- [ ] 16. Create `core/db/client.ts` exporting `db` (Drizzle instance) and `pgClient` (raw postgres client)
- [ ] 17. Add npm scripts: `db:generate`, `db:migrate`, `db:push`, `db:studio`
- [ ] 18. Generate empty initial migration to verify pipeline works
- [ ] 19. Run `npm run db:migrate` — succeeds with no tables created

### Logger
- [ ] 20. Create `shared/services/logger.ts` exporting a pino instance, JSON in prod, pretty in dev
- [ ] 21. Quick verification: import + `logger.info('boot')` in a route — appears in stdout

### Redux
- [ ] 22. Create `core/store/index.ts` with `configureStore` and empty rootReducer
- [ ] 23. Create `core/store/Provider.tsx` (`'use client'`) wrapping children with `<Provider store={store}>`
- [ ] 24. Wire Provider in `app/layout.tsx`
- [ ] 25. Verify HMR works — modify a placeholder slice, no errors

### SCSS
- [ ] 26. Convert `app/globals.css` → `app/globals.scss`, add base reset
- [ ] 27. Create `app/styles/_tokens.scss` with placeholder CSS custom properties (will be replaced by design-system output)
- [ ] 28. Create `app/styles/_themes.scss` with `[data-theme="dark"] { ... }` and `[data-theme="light"] { ... }` blocks (placeholder values; design system fills these later)
- [ ] 29. Verify SCSS modules work — make `app/page.module.scss` (rename existing) and confirm build

### Internationalization (CC2)
- [ ] 30. Create `core/i18n/dictionary.ts` exporting `dictionary` const with `as const`. Seed with `common: { save, cancel, loading, error, retry, confirm, back }`, `app: { title }`. Nested object structure.
- [ ] 31. Create `core/i18n/t.ts` with recursive `NestedKeys<T>` type and `t(key: NestedKeys<typeof dictionary>): string` function. Throws or returns key in dev if missing; returns key in prod (no crash).
- [ ] 32. Unit test: `t('common.save')` returns `'Save'`; missing key falls back to key string in prod.
- [ ] 33. Document convention in this doc's Decision log: "every UI string in JSX uses `t()`. No literals except `aria-label` for icons until icon system arrives."

### Theme infrastructure (CC1)
- [ ] 34. Create `core/store/slices/theme.ts` — state: `'dark' | 'light' | 'system'`, default `'dark'`, action `setTheme`.
- [ ] 35. Create `core/theme/cookie.ts` — `getThemeFromCookie()` (server-side via `next/headers`), `setThemeCookie(value)` (client-side via `document.cookie`). Cookie name: `logger_theme`. Max-age 1 year.
- [ ] 36. Create `core/theme/ThemeProvider.tsx` (`'use client'`) — reads Redux theme state, resolves `'system'` to actual via `window.matchMedia('(prefers-color-scheme: dark)')`, sets `document.documentElement.dataset.theme`. Listens for system pref changes.
- [ ] 37. Add no-flash inline script in `app/layout.tsx` `<head>` — reads cookie (defaults to `'dark'`), resolves `system`, sets `document.documentElement.dataset.theme` BEFORE first paint. Must be a string (not React); use `<script dangerouslySetInnerHTML>`.
- [ ] 38. Wire ThemeProvider inside Redux Provider in `app/layout.tsx`.
- [ ] 39. Live check: set cookie `logger_theme=light` in browser → reload → page renders in light theme without flash. Toggle Redux state → CSS variables update.

### Health endpoints
- [ ] 40. Create `app/api/health/route.ts` — returns `{ status: 'ok', uptime, version }`
- [ ] 41. Create `app/api/health/ready/route.ts` — runs `SELECT 1` against DB, returns 503 on failure
- [ ] 42. Live check: `curl localhost:3000/api/health` → 200; `curl localhost:3000/api/health/ready` → 200

### Tests
- [ ] 43. Create `vitest.config.ts` with jsdom + RTL setup
- [ ] 44. Create `vitest.setup.ts` importing `@testing-library/jest-dom`
- [ ] 45. Create `playwright.config.ts` with single project, baseURL `http://localhost:3000`
- [ ] 46. Add npm scripts: `test`, `test:e2e`
- [ ] 47. Live check: `npm run test` runs (zero tests is OK), `npm run test:e2e` runs (zero tests is OK)

### Final
- [ ] 48. Live check end-to-end:
  - `npm run lint` passes
  - `npm run build` succeeds
  - `npm run dev` starts, scaffold page loads
  - `/api/health` returns 200
  - `/api/health/ready` returns 200 with DB connected
  - Theme cookie respected on page load (no flash)
- [ ] 49. Update PROGRESS.md: feature 00 → ✅ Done. Update this doc's Status block.

## Live check (full)

A fresh clone of the repo plus `docker compose -f docker-compose.dev.yml up -d` plus `npm install && npm run dev` results in:

- Default scaffold page at http://localhost:3000
- `GET /api/health` → `{ status: 'ok', uptime: ..., version: ... }` 200
- `GET /api/health/ready` → 200 (DB OK) or 503 (DB down — verified by stopping postgres container and re-checking)
- `npm run lint` → no errors
- `npm run build` → succeeds
- `npm run test` → "no tests found" but exits 0
- `npm run test:e2e` → "no tests found" but exits 0

## Tests

Foundation has no business tests. Just verify tooling exits 0 with empty test suite.

## Open questions

None outstanding. Decisions captured in PLAN.md.

## Decision log (local)

(Empty — populated as decisions arise during implementation.)
