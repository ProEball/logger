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
- Unit tests sit next to their source: `thing.test.ts`. E2E specs live in `e2e/`, one per flow, `kebab-case.spec.ts`.
- **Reality check:** 23 unit test files, all `.test.ts` — there are currently **no** component tests, and `features/auth/` (9 Server Actions) and `features/overview/` have none at all. Do not read the existing layout as the target.

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
- Files: components `PascalCase/PascalCase.tsx` · hooks `use-kebab-case.ts` · utils `camelCase.ts` · services `camelCase.service.ts` · types `camelCase.types.ts` · jobs `kebab-case.job.ts` · actions `kebab-case.action.ts` · tests `<source>.test.ts` · e2e `kebab-case.spec.ts`.

## 16. Anti-Patterns

Massive page components · deep prop drilling · business logic in JSX · global mutable state · ignoring loading and error states · `any` or suppressed TS errors · feature code inside `app/` · importing one feature from another · a `useEffect` that only calls `setState` · documenting intent as if it were current behaviour.
