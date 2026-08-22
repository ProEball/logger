# Logger — Code Rules

Rules for writing code in **this** repository. Structure and layering claims here were verified against the tree on 2026-08-13; if you find a discrepancy, the code is right and this file is a bug — fix it (see `WORKFLOW.md` §1).

Each rule is tagged:

- **[MUST]** — binding. A violation is a defect; fix it or explain in a comment why the rule does not apply here.
- **[DEFAULT]** — the way to do it unless there is a concrete reason not to. Deviating is fine; deviating silently is not.

## 1. Core Principles

- **[DEFAULT]** SOLID, DRY, and single-responsibility at every level — module, function, component.
- **[MUST]** Prefer readability over cleverness. The next reader is a cold session with no context.
- **[DEFAULT]** Keep performance in mind, but do not optimize without evidence.

## 2. Project Structure

### 2.1 Feature-Driven layout

```
core/       app-wide singletons and infrastructure:
            auth/ (better-auth config + server helpers), db/ (client, schema,
            migrations, middleware), env/ (validated env schema), i18n/,
            store/ (Redux), theme/, worker/ (pg-boss bootstrap), logger.ts
shared/     cross-feature code: components/ (+ its top-level index.ts barrel),
            hooks/, permissions/, types/, utils/
features/   one folder per feature (11 today): alerts api-keys auth dashboard
            events help ingest organizations overview projects roles
app/        Next.js App Router only
```

A feature contains **only the subfolders it needs**, drawn from:

| Subfolder | Holds | Example |
|---|---|---|
| `components/` | feature UI (see §2.2) | all features with UI |
| `actions/` | Server Actions, one per file (§8) | `alerts`, `auth`, `projects`, `roles`, `api-keys`, `organizations` |
| `services/` | data access and business logic (§7) | most features |
| `utils/` | pure functions | most features |
| `hooks/` | feature-specific hooks | `dashboard`, `events` |
| `jobs/` | pg-boss job definitions | `alerts`, `ingest` |
| `content/` | static authored content | `help` |

- **[MUST]** A feature never imports from another feature. If two need it, it moves to `shared/`.
- **[MUST]** Use the `@/` alias for all cross-folder imports: `@/core/…`, `@/shared/…`, `@/features/…`.

### 2.2 Component folders

**[MUST]** Every component lives in its own named folder, file matching folder:

```
components/
  ComponentName/
    ComponentName.tsx
    ComponentName.module.scss
    parts/                  ← sub-components used ONLY by this parent, flat
      SubComponent.tsx
```

- Semantic grouping folders (`filters/`, `widgets/`, `detail/`) are allowed inside `components/`; the per-component rule still applies inside them.
- **[MUST]** No `parts/` directly under a feature's `components/`. Used by one parent → nest in that parent's `parts/`. Used by two or more → its own top-level folder.
- **[MUST]** No nested folders inside `parts/`.
- **[MUST]** No per-component barrel `index.ts`. Import the explicit path. The single exception is `shared/components/index.ts`.

> **§2.1 is the most-violated rule in this file. Counted 2026-08-20: 54 cross-feature imports in non-test source, across 19 feature pairs** — `dashboard → events` alone is 14. `features/alerts` reaches into `organizations` and `projects` from every one of its five actions; `api-keys`, `projects` and `roles` do the same.
>
> That count is recorded here rather than quietly fixed because it changes what the rule *is*. As written it reads like a boundary the codebase holds; in fact it is an aspiration the codebase breaks routinely, and a reader who assumes the former will be surprised by the first file they open. Most of the 54 are actions reaching for `getMembership`/`getProjectBySlug` — an authorization helper that arguably belongs in `shared/` and was never moved.
>
> One instance *was* fixed the same day, and only because it acquired a third consumer: `AutoRefreshControl` lived in `features/events/components/auto-refresh/` with `features/dashboard` importing it across the boundary, and adding the org overview made the shared home unavoidable. It moved to `shared/components/AutoRefreshControl/`, its hook to `shared/hooks/use-auto-refresh.ts`, its strings from the `events` i18n namespace to `common`.
>
> The honest lesson is not "three arrows forced the rule" — 54 arrows did not force anything. It is that this rule has no enforcement, so it is obeyed exactly when someone notices. An import-boundary lint rule would change that; until one exists, treat the number above as the baseline rather than the exception.

### 2.3 `app/` is routing only

**[MUST]** No business logic, services, or components in `app/`. Pages compose feature components and handle routing, params, and data loading. Route files follow App Router conventions (`page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`).

> Next 16 renamed `middleware.ts` to **`proxy.ts`** (repo root). It handles auth gating and mints the per-request CSP nonce — read `docs/reference/security.md` before touching it.

## 3. Code Style

- **[MUST]** Semicolons. 4-space indent.
- **[MUST]** Functions ≤ 40 lines.
- **[MUST]** Components ≤ 250 lines. One known exception: `AppSidebar.tsx`.
- **[MUST]** Server Components by default. Add `"use client"` only for hooks, browser APIs, or event handlers — and push it down to the smallest component that needs it, never a whole page.
- **[DEFAULT]** Extract complex logic into hooks; avoid large inline functions in JSX; do not pass `setState` as a prop.

## 4. TypeScript

- **[MUST]** `strict: true` errors are fixed, never suppressed. `npx tsc --noEmit` stays at 0.
- **[MUST]** No `any`, no `@ts-ignore`, no `as` — unless a comment explains precisely why it is unavoidable. See `features/roles/utils/seed-system-roles.ts` for the bar.
- **[DEFAULT]** `type` for unions and aliases, `interface` for extensible object shapes. PascalCase. Export what is shared.

## 5. State

- **[MUST]** Never mutate state directly.
- **[DEFAULT]** Redux Toolkit for app-wide state (user, theme, current org/project). React Context for feature-scoped state. `useState` locally; `useReducer` once there are several related pieces.
- **[MUST]** Do not gate rendering on a `useState` + `useEffect` "mounted" flag — it is a cascading render and eslint rejects it. Use `useIsHydrated()` from `@/shared/hooks/use-is-hydrated`. To reset state when a prop changes, adjust state during render with a "previous value" state, not an effect.

## 6. Data Fetching

- **[DEFAULT]** Fetch on the server in async Server Components. `Suspense` for loading. Client fetching only for genuine interactivity.
- **[MUST]** No `fetch` inside a component — go through a service.

## 7. Services

- **[MUST]** All data access lives in `services/`. Route handlers under `app/api/` contain no business logic — they parse, delegate, and map errors to status codes.
- **[MUST]** Services validate inputs and throw meaningful, typed errors.

## 8. Server Actions

- **[MUST]** One action per file in `actions/`, never inline in a component.
- **[MUST]** Validate every input with Zod. Never fail silently — return a typed `{ error }` or throw deliberately.
- **[DEFAULT]** Server Actions for mutations; Server Components for reads.

## 9. Error Handling

- **[MUST]** Never swallow an error. Every async path has `try/catch` or `.catch()`.
- **[MUST]** Route segments have `error.tsx` boundaries; use the shared `GlobalErrorPage` / `NotFoundPage` / `ForbiddenPage`.

## 10. Performance

- **[DEFAULT]** `useMemo` for genuinely expensive computation. `React.memo` only when profiling shows it helps.
- **[DEFAULT]** `dynamic()` for heavy client components — Recharts widgets and the event drawer already use it.

## 11. Testing

- **[MUST]** *When* tests are required is defined in `WORKFLOW.md` §2. This section is only *how*.
- **[MUST]** Test behaviour, not implementation — query by role and label, never class or id.
- **[MUST]** Mock only at real system boundaries: database, external HTTP, DNS, clock. Never mock an internal module.
- **[MUST]** Unit tests sit **next to their source**: `thing.ts` → `thing.test.ts` in the same folder, **named after the module it actually imports**. All 55 `.test.ts` files under `core/`, `features/` and `shared/` do today. E2E specs are the exception and live in `e2e/`, one per flow, `kebab-case.spec.ts`.

  The naming half of that rule is not pedantry. Until 2026-08-20 `features/dashboard/services/aggregations.service.test.ts` tested `utils/aggregation-utils.ts` and never imported the service it was named for — so the folder listing showed a 9.5 kB SQL service as covered when it had no tests at all, and showed `aggregation-utils.ts` as untested when it was the only thing covered. A misnamed test does not merely fail to help; it actively hides the gap the colocation rule exists to expose.

  Not a stylistic preference — it is what makes a missing test visible. `features/auth/actions/` holds nine actions beside nine tests; add a tenth action without one and the gap shows in the folder listing and in the diff, which is what WORKFLOW.md §2 relies on. Colocation also means `git mv` on a module carries its test along, so renames do not leave orphans behind.

  *Rejected 2026-08-13: a per-feature `features/*/tests/` folder.* The motivation was that tests appear under different subfolder names across features — but that only reflects where each feature keeps its logic (`auth` in `actions/`, `ingest` in `services/` and `utils/`); the rule itself is already uniform. It would cost the two properties above and rewrite 32 import paths. Reopen only if component tests (`.test.tsx`) arrive in bulk and genuinely clutter the per-component folders.
- **[MUST]** A test that needs a **real database** is named `<source>.itest.ts`, still beside its source, and runs under `npm run test:it`. The suffix is load-bearing: `npm run test` must work with no Docker running, so `vitest.config.ts` excludes `**/*.itest.ts` and the integration run uses its own config. Reach for one only when the query-builder mock genuinely cannot express the thing under test — today that means raw `db.execute(sql\`…\`)`. An integration test that a unit test could have covered is slower, needs Postgres, and buys nothing.

  Its fixture is **enumerated, not generated**: every row exists for a named case and every expected value is a literal with its arithmetic shown. A randomised fixture forces the test to compute its expectation, and computing it means re-implementing the query — the test then compares the code with a copy of itself. See `itest/support/fixture.ts`.

- **Reality check (recounted 2026-08-20):** `npm run test` runs **53 files / 568 tests**. Of those, 49 are `.test.ts` beside their source under `core/`, `features/` and `shared/`; three are `.test.mjs` under `scripts/` (the load generators — `vitest.config.ts` does not exclude them) and one sits under `app/`. There are still **no** component tests: zero `.test.tsx` in the tree. Do not read the existing layout as the target.

  *Updated 2026-08-21:* `npm run test` now runs **59 files / 644 tests** and `npm run test:it` **4 files / 102 tests**. `features/dashboard/services/aggregations.service.ts` — flagged here as uncovered since 2026-08-20 — is covered by 26 integration tests, which is what finally allowed the two text-alias `ORDER BY` defects in it to be fixed.

## 12. Styling

- **[MUST]** SCSS Modules. Global styles only in `app/globals.scss`. Design tokens over literal values.
- **[MUST]** camelCase class names. Nesting follows HTML structure.
- **[DEFAULT]** Avoid inline styles. Note that CSP forbids tightening `style-src`, so inline styles are not *blocked* — that is not permission to use them.

## 13. Forms

**The codebase does both, and the split is not random.** `gform-react` (6 components) covers the **unauthenticated entry flows**: `LoginForm`, `SetupWizard`, `AcceptInviteForm`, `ForgotPasswordForm`, `ResetPasswordForm`, plus `InviteMemberDialog`. Plain controlled `useState` + `<form onSubmit>` + shared `FormField`/`Input` (10+ components) covers **in-app forms**, including `AccountProfileForm` and `ChangePasswordForm` inside `features/auth/` itself, plus `ProjectCreateForm`, `OrgSettingsForm`, `AlertRuleEditor`.

- **[MUST]** Submission goes through a Server Action (§8), and inputs are validated server-side with Zod regardless of what the client does. Client-side validation is UX, never the boundary.
- **[DEFAULT]** Match the surrounding feature. Do not introduce the other pattern into a file that does not already use it.

*Open: whether that entry-flow / in-app split is the intended rule or an accident. If intended, state it as [MUST] and delete this note; if not, pick one and migrate.*

## 14. Internationalization

`core/i18n/` is a typed English-only dictionary; `t("a.b.c")` returns the key itself when missing, so a gap degrades to an ugly string instead of a crash.

**Currently 30 of 120 feature components use `t()`** — the rest hardcode English. That inconsistency is the status quo, not the goal.

- **[DEFAULT]** New user-facing strings go through `t()` with a key under the feature's namespace.
- **[MUST]** Never mix the two inside one component — a half-translated component is worse than a consistently hardcoded one.
- Not required for: `aria-label`s on icon-only controls in unmigrated components, developer-facing log messages, or test fixtures.

## 15. Naming

- `camelCase` — variables, functions, hooks, methods. `PascalCase` — components, types, interfaces, classes. `UPPER_SNAKE_CASE` — constants.
- **[MUST]** Booleans start with `is`, `has`, `should`, or `can`.
- Files: components `PascalCase/PascalCase.tsx` · hooks `use-kebab-case.ts` · utils `camelCase.ts` · services `camelCase.service.ts` · types `camelCase.types.ts` · jobs `kebab-case.job.ts` · actions `kebab-case.action.ts` · tests `<source>.test.ts` **in the source's own folder** (§11) · integration tests `<source>.itest.ts`, same folder · e2e `kebab-case.spec.ts` in `e2e/`.

## 16. Anti-Patterns

Massive page components · deep prop drilling · business logic in JSX · global mutable state · ignoring loading and error states · `any` or suppressed TS errors · feature code inside `app/` · importing one feature from another · a `useEffect` that only calls `setState` · documenting intent as if it were current behaviour.
