# 01. Auth + Organizations + Roles

## Status
- [ ] Not started · [ ] In progress · [x] Done
- Started: 2026-05-02
- Completed: 2026-05-04
- Last touched: 2026-05-04
- Progress: 69 / 69 checklist items

## Goal

Establish identity and access control. Implement: setup wizard for the very first owner, login/logout, password reset, organization creation with seeded system roles, custom role management, member invitations (link-copy, no email yet), member listing with role assignment, account/sessions screens. End state: owner can sign in, invite a teammate via copy-paste link, that teammate creates an account and lands inside the org with their assigned role.

## Prerequisites

- ✅ 00-foundation: `/api/health/ready` returns 200, Drizzle connects to DB, app boots.

## Locked decisions

From planning session on 2026-04-30:

| ID | Question | Resolution |
|---|---|---|
| Q-A1 | Email verification on registration? | **No** in MVP. Invite-only signup means email is verified by the act of receiving the link. |
| Q-A2 | 2FA / TOTP? | **No** in MVP. Add later as `account.security` feature. |
| Q-A3 | Session length? | **30 days, rolling expiration** (renewed on activity). |
| Q-A4 | "Remember me" / device choice? | **No** — single rolling-30d session model. `/account/sessions` shows and revokes. |
| Q-A5 | Bootstrap of the first owner? | **Setup wizard at `/setup`**. Active only when `COUNT(users) === 0`. After first owner exists, `/setup` returns 404 forever. |
| Q-A6 | Invitation delivery in MVP? | **Copy link manually** from UI. Owner/admin shares it via their channel. Webhook hookup is future work. |

Other locked items relevant to this feature:
- Owner is a flag `organization_members.is_owner: boolean`, NOT a role (PLAN.md §5).
- Three system roles seeded per org: `Admin`, `Member`, `Viewer` (PLAN.md §5).
- Permission registry hardcoded in `shared/permissions/registry.ts` (PLAN.md §5).
- `org.delete` and `roles.manage` are owner-only and not assignable to any role.

## Data model

This feature creates these tables. Drizzle schemas live under `core/db/schema/`.

### Auth (better-auth managed)

```ts
users               (id uuid pk, email text unique, name text,
                     password_hash text, email_verified boolean default false,
                     preferences jsonb default '{"theme":"dark"}'::jsonb,  -- CC1
                     created_at, updated_at)
sessions            (id uuid pk, user_id uuid fk → users.id, token text unique,
                     expires_at, ip text, user_agent text, created_at)
accounts            (id uuid pk, user_id uuid fk, provider text, provider_id text,
                     created_at)
                    -- empty in MVP, populated when OAuth is added
verification_tokens (id uuid pk, identifier text, token text, expires_at)
                    -- used for password reset
```

`users` and `sessions` schemas are dictated by better-auth. Don't fight them.

### Organizations

```ts
organizations            (id uuid pk, name text, slug text unique,
                          plan text default 'internal', limits jsonb default '{}'::jsonb,
                          allow_signup boolean default false, created_at, updated_at)

roles                    (id uuid pk,
                          organization_id uuid fk → organizations.id ON DELETE CASCADE,
                          name text, description text,
                          permissions text[] default '{}',
                          is_system boolean default false,
                          is_default boolean default false,
                          created_at, updated_at)
                         UNIQUE (organization_id, name)

organization_members     (organization_id uuid fk → organizations.id ON DELETE CASCADE,
                          user_id uuid fk → users.id ON DELETE CASCADE,
                          role_id uuid fk → roles.id ON DELETE RESTRICT,
                          is_owner boolean default false,
                          joined_at)
                         PK (organization_id, user_id)
                         INDEX (user_id) — для "какие у меня орги"

invitations              (id uuid pk,
                          organization_id uuid fk → organizations.id ON DELETE CASCADE,
                          email text,
                          role_id uuid fk → roles.id ON DELETE RESTRICT,
                          token text unique,
                          expires_at,
                          invited_by uuid fk → users.id ON DELETE SET NULL,
                          accepted_at timestamptz, created_at)
                         INDEX (email, organization_id) WHERE accepted_at IS NULL

project_member_roles     (project_id uuid, user_id uuid fk → users.id ON DELETE CASCADE,
                          role_id uuid fk → roles.id ON DELETE RESTRICT)
                         -- project_id FK added in feature 02 with ON DELETE CASCADE
                         -- table created here (empty), populated when per-project roles ship
                         PK (project_id, user_id)
```

### FK cascade rationale

| FK | Behavior | Why |
|---|---|---|
| `roles.organization_id` | CASCADE | Roles are owned by org; org gone → roles meaningless |
| `organization_members.*` | CASCADE | Membership is the relationship, not data to preserve |
| `invitations.organization_id` | CASCADE | Same |
| `invitations.invited_by` | SET NULL | Audit trace stays even if inviter is deleted |
| `*.role_id` | RESTRICT | Cannot delete a role while members or invites still reference it; UI must reassign first |

### Migration split

Logical grouping for traceability:

- `0001_auth.sql` — better-auth tables (users, sessions, accounts, verification_tokens)
- `0002_organizations.sql` — organizations, roles
- `0003_org_membership.sql` — organization_members, project_member_roles (placeholder)
- `0004_invitations.sql` — invitations

## Server-side artifacts

### Permissions (shared)
- `shared/permissions/registry.ts` — `PERMISSIONS` const (see PLAN.md §5 for full list)
- `shared/permissions/groups.ts` — grouping for UI: `organization | members | projects | events | alerts | api-keys`
- `shared/permissions/check.ts` — `hasPermission(member, perm)`
- `shared/permissions/guards.ts` — `assertPermission`, `assertOwner` (throws ForbiddenError)
- `shared/permissions/hooks.ts` — `usePermission(perm)` for client conditional rendering

### Auth core
- `core/auth/config.ts` — better-auth config: email+password provider, 30d session, Drizzle adapter
- `core/auth/server.ts` — server-side `auth` instance + `getSession`, `getCurrentUser`
- `app/api/auth/[...all]/route.ts` — better-auth catch-all handler

### Services
- `features/auth/services/auth.service.ts` — wrappers (signIn, signUp, signOut, requestPasswordReset, resetPassword)
- `features/organizations/services/organizations.service.ts` — CRUD + getCurrentOrg + getMembership
- `features/organizations/services/invitations.service.ts` — generateToken, validate, accept, revoke
- `features/roles/services/roles.service.ts` — CRUD + getOrgRoles + getDefaultRole
- `features/roles/utils/seed-system-roles.ts` — called on org creation

### Server actions
```
features/auth/actions/
  setup.action.ts                 — creates first user + org + system roles + auto-login
  login.action.ts
  logout.action.ts
  request-password-reset.action.ts
  reset-password.action.ts
  update-preferences.action.ts    — theme + future preferences

features/organizations/actions/
  invite-member.action.ts
  revoke-invitation.action.ts
  accept-invitation.action.ts
  remove-member.action.ts
  change-member-role.action.ts
  transfer-ownership.action.ts
  update-org.action.ts

features/roles/actions/
  create-role.action.ts
  update-role.action.ts
  delete-role.action.ts
```

All actions:
- Validate inputs with Zod
- Use `assertPermission` / `assertOwner` for access control
- Return typed errors

## Client-side artifacts

### Components

```
features/auth/components/
  SetupWizard.tsx
  LoginForm.tsx
  ForgotPasswordForm.tsx
  ResetPasswordForm.tsx
  AcceptInviteForm.tsx
  parts/
    PasswordInput.tsx       — со strength-indicator

features/organizations/components/
  OrgSwitcher.tsx           — в app shell
  OrgSettingsForm.tsx
  MembersList.tsx
  MemberRow.tsx
  InviteMemberDialog.tsx
  InvitationCreatedDialog.tsx   — с copy-link
  InvitationsList.tsx
  TransferOwnershipDialog.tsx

features/roles/components/
  RolesList.tsx
  RoleEditor.tsx
  PermissionMatrix.tsx
  RoleBadge.tsx

shared/components/
  AppShell/
  AppShell/parts/Sidebar.tsx
  AppShell/parts/TopBar.tsx
  AppShell/parts/UserMenu.tsx           — Account / Sessions / Theme submenu / Logout
  AppShell/parts/ThemeSwitcher.tsx      — radio: dark / light / system (CC1)
  Confirm/
  ConfirmDialog.tsx
```

### Hooks
- `features/auth/hooks/use-current-user.ts`
- `features/organizations/hooks/use-current-org.ts`
- `features/organizations/hooks/use-org-members.ts`
- `shared/permissions/hooks.ts` (`usePermission`)

### Redux slices
- `core/store/slices/user.ts` — current user info (sync'd from server on layout)
- `core/store/slices/org.ts` — current org context (id, slug, role membership)

## Routes

```
PUBLIC
/setup                              — guarded: only when COUNT(users)=0
/login
/forgot-password
/reset-password/[token]
/invite/[token]                     — public to view, requires login to accept

USER SCOPE                          (signed-in)
/                                   — landing: redirect to /[org] if exactly 1 org, else org picker
/account                            — profile + change password
/account/sessions                   — active sessions, revoke

ORGANIZATION SCOPE                  permission required
/[org]                              org.read              — overview
/[org]/team                         members.read
/[org]/settings                     org.update
/[org]/settings/roles               roles.manage          (owner-only)
/[org]/settings/roles/new           roles.manage
/[org]/settings/roles/[id]          roles.manage
/[org]/settings/danger              org.delete            (owner-only)
```

## Designs

- 🎨 Design system: not yet generated. Prompt at `docs/prompts/design-system.md`.
- 🎨 Screen designs: not yet generated. Prompt to be created at `docs/prompts/screens/01-auth.md` after this feature plan is reviewed.
- Design output destination: `docs/designs/screens/01-auth/`
- Design status: ⬜ not requested

## Implementation Checklist

### Schema
- [x] 1. Drizzle schema: `users` (with `preferences jsonb default '{"theme":"dark"}'`), `sessions`, `accounts`, `verification_tokens` (better-auth) — extend better-auth users table via `additionalFields` config
- [x] 2. Drizzle schema: `organizations`, `roles`
- [x] 3. Drizzle schema: `organization_members`, `project_member_roles` (empty placeholder)
- [x] 4. Drizzle schema: `invitations`
- [x] 5. Generate migrations 0001–0004, run `db:migrate`, inspect via `db:studio`

### Permissions module
- [x] 6. `shared/permissions/registry.ts` — `PERMISSIONS` const + `Permission` type + `ownerOnly` markers
- [x] 7. `shared/permissions/groups.ts` — group keys + display labels for UI
- [x] 8. `shared/permissions/check.ts` — `hasPermission(member, perm)`
- [x] 9. `shared/permissions/guards.ts` — `assertPermission`, `assertOwner`, custom `ForbiddenError`
- [x] 10. `shared/permissions/hooks.ts` — `usePermission(perm)` reading from Redux org slice
- [x] 11. Unit test: `hasPermission` for owner, member with role, member without permission, owner-only perm denial

### Auth core (better-auth)
- [x] 12. `core/auth/config.ts` — better-auth init with email+password, 30d session rolling, Drizzle adapter
- [x] 13. `core/auth/server.ts` — exports `auth`, `getSession`, `getCurrentUser`
- [x] 14. `app/api/auth/[...all]/route.ts` — wired to better-auth handler
- [x] 15. Add `AUTH_SECRET` to `.env.example` and `core/env/index.ts` schema
- [x] 16. Live check: `curl POST /api/auth/sign-up` with test creds creates a user row

### System role seeding utility
- [x] 17. `features/roles/utils/seed-system-roles.ts` — creates Admin/Member/Viewer rows, returns IDs
- [x] 18. Unit test: seeding produces three rows with correct permission sets

### Setup wizard
- [x] 19. `app/setup/page.tsx` + `SetupWizard.tsx` (gform-react form: org name + email + name + password)
- [x] 20. `features/auth/actions/setup.action.ts` — transactional: insert user, insert org, seed roles, insert organization_members with is_owner=true, sign-in.
  - **Race guard inside the transaction**: take a Postgres advisory lock with a fixed key (e.g. `SELECT pg_advisory_xact_lock(7438291)`), then `SELECT COUNT(*) FROM users` — if non-zero, abort with `SetupAlreadyDoneError`. Without this, two simultaneous `/setup` submits both pass the middleware check and both create owners.
- [x] 21. `proxy.ts` (Next.js 16 renamed middleware → proxy) — guard: redirect to `/setup` if `users` is empty; 404 `/setup` once done. Only caches `setupDone=true` (never caches `false` to avoid stale-redirect after setup completes).
- [x] 22. Live check: fresh DB → open app → redirect to /setup → submit form → land on /[org] as owner. Repeat submit in another tab → second request hits `SetupAlreadyDoneError` and shows "Setup already complete".

### Login / logout
- [x] 23. `app/login/page.tsx` + `LoginForm.tsx` (gform-react: email + password)
- [x] 24. `features/auth/actions/login.action.ts` — calls better-auth signIn, redirects to `/`
- [x] 25. `UserMenu` (in TopBar) — logout button calling `logout.action.ts`
- [x] 26. Live check: logout → /login → enter creds → land on /[org]

### Forgot / reset password
- [x] 27. `app/forgot-password/page.tsx` + `ForgotPasswordForm.tsx`
- [x] 28. `features/auth/actions/request-password-reset.action.ts` — generates token, stores in `verification_tokens`, **logs reset URL via pino** (TEMP — will switch to email when provider is wired)
- [x] 29. `app/reset-password/[token]/page.tsx` + `ResetPasswordForm.tsx`
- [x] 30. `features/auth/actions/reset-password.action.ts` — validates token, updates password, deletes token
- [x] 31. Live check: trigger reset → grab URL from logs → open in browser → set new password → log in

### Invitations (link-copy flow)
- [x] 32. `app/[org]/team/page.tsx` — server component, lists members + pending invitations
- [x] 33. `MembersList.tsx` + `InvitationsList.tsx`
- [x] 34. `InviteMemberDialog.tsx` — gform: email + role select
- [x] 35. `features/organizations/actions/invite-member.action.ts` — generates token, inserts row, returns full URL
- [x] 36. `InvitationCreatedDialog.tsx` — modal showing the URL with "Copy" button (not closeable until copied or dismissed)
- [x] 37. `app/invite/[token]/page.tsx` — three states:
  - token invalid/expired → friendly error page
  - no logged-in user → registration form (`AcceptInviteForm`)
  - logged-in user matching invitation email → "Accept" button
  - logged-in different user → "Sign out and continue with [email]" hint
- [x] 38. `features/organizations/actions/accept-invitation.action.ts` — transactional: insert organization_members, set accepted_at
- [x] 39. `features/organizations/actions/revoke-invitation.action.ts` — guard with `members.invite`
- [x] 40. Live check: create invite → copy URL → open in incognito → register → land in /[org] with assigned role

### Member management
- [x] 41. `MemberRow` actions (kebab menu): change role (`change-member-role.action.ts`), remove (`remove-member.action.ts`), transfer ownership (`transfer-ownership.action.ts`)
- [x] 42. ConfirmDialog for destructive actions
- [x] 43. Guards: cannot remove owner, only owner can transfer ownership, cannot remove self if last owner
- [x] 44. Live check: create second user via invite → change their role → remove them → re-invite → transfer ownership

### Roles management UI (owner-only)
- [x] 45. `app/[org]/settings/roles/page.tsx` + `RolesList.tsx`
- [x] 46. `app/[org]/settings/roles/new/page.tsx` + `RoleEditor.tsx` + `PermissionMatrix.tsx` (grouped checkboxes; owner-only perms hidden)
- [x] 47. `app/[org]/settings/roles/[id]/page.tsx` — same editor in edit mode; system roles can be edited but not renamed/deleted
- [x] 48. CRUD server actions with `assertOwner` (since `roles.manage` is owner-only)

### Account
- [x] 49. `app/account/page.tsx` — view/edit name, change password
- [x] 50. `app/account/sessions/page.tsx` — list active sessions with revoke buttons

### Org settings
- [x] 51. `app/[org]/settings/page.tsx` — name + slug edit (slug change is destructive — confirm dialog)
- [x] 52. `app/[org]/settings/danger/page.tsx` — transfer ownership (alt path) + delete org (cascade) — owner-only

### App shell
- [x] 53. `AppShell` layout in `app/[org]/layout.tsx`
- [x] 54. `Sidebar` with org-level nav
- [x] 55. `TopBar` with org switcher, user menu
- [x] 56. `OrgSwitcher` lists user's orgs (from Redux org slice or server)
- [x] 57. `UserMenu` dropdown items: Account, Sessions, Theme submenu (Dark/Light/System), Logout
- [x] 58. `ThemeSwitcher` component — calls `update-preferences.action.ts`, updates Redux + cookie + DB
- [x] 59. `update-preferences.action.ts` — Zod-validated, **MERGES** into `users.preferences` (does NOT replace).
  - **Critical pattern**: `UPDATE users SET preferences = preferences || $1::jsonb WHERE id = $2`. Naive `SET preferences = $1` would wipe other keys (e.g. theme update sneaks `autoRefresh` away — feature 04 adds that key). All future preference writers MUST use this pattern. Document in `Decision log (local)` below.
  - Zod validates the partial object: `z.object({ theme: themeEnum.optional(), autoRefresh: refreshEnum.optional() }).strict()`. Each new feature extending preferences widens this schema.
- [x] 60. On login, hydrate Redux theme from `users.preferences.theme`. Sync cookie too. Handles SSR by reading cookie first, then upgrading from DB on auth.
- [x] 61. Live check: log in as user A with theme=light → theme persists across logout/login → log in as user B with theme=dark → see dark

### Tests
- [x] 62. Unit: `hasPermission`, `seedSystemRoles`, invite token validation, theme cookie roundtrip
- [x] 63. E2E (`e2e/auth-bootstrap.spec.ts`): full setup wizard → org creation flow
- [x] 64. E2E (`e2e/invite.spec.ts`): create invite → register via link → accept → role applied
- [x] 65. E2E (`e2e/role-management.spec.ts`): create custom role → assign to user → user sees only those perms
- [x] 66. E2E (`e2e/theme.spec.ts`): toggle theme → reload → state preserved

### Final
- [x] 67. Update `PROGRESS.md` row for feature 01 → ✅ Done
- [x] 68. Update Status block at top of this file
- [x] 69. End-to-end live check (see "Live check" section)

> **Note**: counts may shift as we discover sub-tasks. The first 48 items are the planning estimate; final count goes here when we finish.

## Live check (full)

A fresh DB plus a fresh `npm run dev` produces this end-to-end success:

1. Open `http://localhost:3000` → redirect to `/setup`.
2. Fill setup form → land on `/[org]` as owner.
3. Open `/account` → change name → persists after refresh.
4. Open `/[org]/team` → invite a teammate at `test@example.com` with role `Member` → modal shows URL.
5. Copy URL, open in incognito → registration form → submit → land on `/[org]` with `Member` role.
6. Back as owner: open `/[org]/settings/roles` → create role `QA` with only `events.read` checked.
7. Change teammate's role from `Member` to `QA` → in incognito, teammate now sees no `members` page.
8. Owner: visit `/account/sessions` → see two sessions → revoke teammate's session → teammate is logged out on next request.
9. Owner: trigger forgot-password for teammate → reset URL appears in pino logs → use it → set new password → log in.
10. Owner: `/[org]/settings/danger` → transfer ownership to teammate → teammate becomes owner.

## Tests

- Unit (Vitest): `shared/permissions/check.test.ts`, `features/roles/utils/seed-system-roles.test.ts`, `features/organizations/services/invitations.service.test.ts`.
- E2E (Playwright): `auth-bootstrap.spec.ts`, `invite.spec.ts`, `role-management.spec.ts`.

## Open questions

- ❓ When email provider lands later, which auth flows auto-switch to email vs. stay log-only? Defer until email provider feature.

## Decision log (local)

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-01 | Setup wizard guarded by `pg_advisory_xact_lock` + COUNT(users) inside transaction | Middleware check is racy; two simultaneous submits would both create owners without DB-level guard |
| 2026-05-01 | `users.preferences` writes use `preferences \|\| $1::jsonb` merge, never full replace | Multiple features extend this jsonb (theme in 01, autoRefresh in 04, more later); naive replace silently wipes sibling keys |
| 2026-05-01 | FK cascades: org-owned tables CASCADE, role refs RESTRICT, audit refs SET NULL | Predictable org-delete semantics; prevents accidental role wipe; preserves history when users go away |
| 2026-05-02 | Single migration file `0000_narrow_sway.sql` instead of planned 0001–0004 split | Drizzle kit generates one file per schema snapshot; traceability covered by schema file split (auth.ts / organizations.ts / orgMembership.ts / invitations.ts) |
| 2026-05-02 | Auth table IDs are `text` (not `uuid`); org table IDs are `uuid` | better-auth controls ID generation for its own tables and passes string IDs to the adapter; FKs from org tables to `users.id` are `text` to match |
| 2026-05-02 | `verifications` is the schema export key for the `verification_tokens` PG table | Drizzle adapter with `usePlural: true` maps better-auth model `verification` → key `verifications`; actual table name is `verification_tokens` as planned |
| 2026-05-03 | `proxy.ts` instead of `middleware.ts`; function `proxy` instead of `middleware` | Next.js 16 deprecated the `middleware` file convention and renamed it to `proxy`. Edge runtime removed — only Node.js is supported. |
| 2026-05-03 | Setup guard only caches `setupDone=true`, never `setupDone=false` | Caching the negative state would cause the redirect after setup action to bounce back to /setup within the 5 s TTL window. |
| 2026-05-03 | `SetupWizard` attaches native `submit` listener via `useRef` to always call `e.preventDefault()` | GForm only calls `e.preventDefault()` when `state.isValid`; without this, an invalid submit triggers the browser's native GET fallback and appends form fields as query params. |
| 2026-05-03 | `useId()` instead of `input.gid` for `htmlFor`/`id` pairs in GForm components | GForm generates `gid` via `Date.now() + Math.random()` — different on server vs client, causing React hydration mismatch. `useId()` is SSR-stable by design. Applied to SetupWizard and LoginForm; all future GForm components must follow this pattern. |
| 2026-05-03 | `proxy.ts` calls `auth.api.getSession` on every non-static request | Session must be verified at the proxy level to protect all routes uniformly. Only caches setupDone; session check is cheap (indexed session token lookup). |
| 2026-05-03 | Password reset uses `auth.api.requestPasswordReset` + `sendResetPassword` hook; token extracted from DB for live check | Delegating to better-auth means token lifecycle (generation, hashing, expiry, deletion) is handled correctly. Live check reads `identifier LIKE 'reset-password:%'` from `verification_tokens` to avoid parsing pino logs. |
| 2026-05-03 | `core/logger/index.ts` — plain `pino({ level: "info" })` without pino-pretty transport | pino-pretty is a devDependency; transport config in production build would fail. JSON stdout is sufficient; pipe through pino-pretty manually for local dev if needed. |
| 2026-05-03 | `shared/components/Modal/Modal.tsx` — `isProgrammaticClose` ref suppresses `onClose` when component calls `dialog.close()` internally | Native `<dialog>` fires a `close` DOM event on every close, including programmatic ones triggered by the `open` prop going false. Without the guard, `onClose` fires on every programmatic close, causing parent state resets that race with concurrent state transitions (e.g. "invite" → "created" in InviteSection). |
| 2026-05-04 | `MembersList` is a client component that manages all member-action dialogs; `MemberRow` only renders `<tr>` and calls `onAction` callback | Putting dialogs inside `MemberRow` would place `<dialog>` elements inside `<tbody>` (invalid HTML). Lifting dialog state to `MembersList` keeps the table valid and avoids portal complexity. |
| 2026-05-04 | E2E re-invite acceptance uses DB helper (`dbAcceptInvite`) rather than browser UI | After removal, the user account still exists; opening the invite link without a session shows the registration form, which fails because the email already exists. The invite-acceptance UI flow was fully tested in item 40; this live check focuses on member management actions. |
