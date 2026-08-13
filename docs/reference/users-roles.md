# Users, Organizations, Roles & Permissions

## Model overview

```
User ──< Session, Account (better-auth)
User ──< OrganizationMember >── Organization
                │
                └── roleId ──> Role (bundle of permission strings, scoped to one org)
```

- A **user** account is global (`users` table), managed by better-auth.
- An **organization** is the tenant boundary. A user joins an organization via an **`organizationMembers`** row, which carries exactly one **role** and an **`isOwner`** boolean.
- **Ownership is a boolean flag, not a role.** The owner bypasses every permission check unconditionally, including permissions no role can ever hold (`org.delete`, `roles.manage`).
- This product currently supports **exactly one organization**, created once via the `/setup` first-run wizard. There is no self-serve "create another organization" flow anywhere in the codebase — the schema (`getFirstOrgForUser`) is multi-org-capable (a user could theoretically be invited into a second org if one existed), but nothing creates a second org today.

## Permission system (`shared/permissions/`)

Permissions are `resource.action` strings, defined in a single registry (`shared/permissions/registry.ts`):

| Permission | Meaning |
|---|---|
| `org.read` | View organization |
| `org.update` | Edit organization settings |
| `org.delete` | Delete organization — **owner-only** |
| `members.read` | View members |
| `members.invite` | Invite members |
| `members.remove` | Remove members |
| `members.role.assign` | Change a member's role |
| `roles.manage` | Create/edit/delete custom roles — **owner-only** |
| `projects.create` | Create projects |
| `projects.read` | View projects |
| `projects.update` | Edit projects |
| `projects.delete` | Delete projects |
| `events.read` | Read events |
| `events.delete` | Delete events |
| `alerts.read` | View alert rules |
| `alerts.manage` | Create/edit/delete/toggle alert rules |
| `api_keys.read` | View API keys |
| `api_keys.manage` | Create/revoke API keys |

`org.delete` and `roles.manage` are **owner-only permissions** — they are structurally excluded from every role (system or custom); the permission-matrix UI never offers them as assignable, and the corresponding actions call `assertOwner(membership)` directly instead of `assertPermission(membership, perm)`.

Enforcement logic (`shared/permissions/check.ts`):
```ts
function hasPermission(membership: Membership, perm: Permission): boolean {
    if (membership.isOwner) return true;           // owner bypasses everything
    return membership.role.permissions.includes(perm);
}
```
`shared/permissions/guards.ts` exposes `assertPermission(membership, perm)` and `assertOwner(membership)`, both throwing a `ForbiddenError` if the check fails — always caught locally by the calling Server Action/page and turned into a user-facing message (never left to bubble as an unhandled exception). A client-side `usePermission(perm)` hook (`shared/permissions/hooks.ts`) reads the current membership from Redux for conditional UI rendering only — it is **not** a real access-control boundary; the server-side check is what actually enforces access.

## System (built-in) roles

Every organization gets exactly three roles, seeded at creation time (`features/roles/utils/seed-system-roles.ts`):

| Role | `isSystem` | `isDefault` | Permissions |
|---|---|---|---|
| **Admin** | true | false | Every permission except the two owner-only ones (i.e. everything but `org.delete` and `roles.manage`) |
| **Member** | true | **true** | `org.read`, `members.read`, `projects.read`, `events.read`, `alerts.read`, `api_keys.read` (read-only defaults, this is the role assigned to new members unless changed) |
| **Viewer** | true | false | Every permission ending in `.read` (computed dynamically from the registry) |

Business rules on system roles (`features/roles/actions/*.action.ts`, all **owner-only**):
- **Name is locked** — a system role's `name` cannot be changed (its `description` and `permissions` **can** be edited by the owner).
- **Cannot be deleted.**
- Custom roles **can** be freely created/renamed/edited/deleted by the owner, subject to: name unique per org (1–50 chars), description optional (≤200 chars), permissions restricted to the assignable set (owner-only perms can never be included in the array — enforced by a Zod enum). A role still assigned to a member or a pending invitation cannot be deleted (the DB's `ON DELETE RESTRICT` FK is the actual guard; the action catches the resulting constraint violation and returns a friendly "reassign them first" message rather than pre-checking).

## Organization lifecycle

- **Creation**: only via `/setup` (`features/auth/actions/setup.action.ts`). Runs inside a single DB transaction that: takes a Postgres advisory lock (serializes concurrent submits), verifies `COUNT(users) === 0` (aborts otherwise), creates the first user + credential account, creates the organization (slug derived from the org name), seeds the three system roles, and inserts the creator as a member with `roleId: adminRoleId, isOwner: true`. `proxy.ts` makes `/setup` 404 permanently once any user exists.
- **Update**: `org.update` permission edits the name; changing the **slug** additionally requires ownership (it breaks existing URLs) and a uniqueness check.
- **Delete**: owner-only, requires typing the exact org name as confirmation; cascades to members/roles/invitations via FK `ON DELETE CASCADE` (but not to events — see [architecture.md](architecture.md#events-partitioning)).
- **Ownership transfer**: owner-only, cannot target self or an already-owner user; flips `isOwner` on both rows transactionally (single-owner-at-a-time by convention, though the schema itself doesn't enforce uniqueness of `isOwner=true` at the DB level).

## Membership management

- **Change a member's role** — requires `members.role.assign`; cannot change an owner's role; new role must belong to the same org.
- **Remove a member** — requires `members.remove`; cannot remove an owner (must transfer ownership first).

## Invitations (copy-link, not email)

There is no transactional email sending in this app. Invitations are a **copy-link flow**:

1. **Invite** (`invite-member.action.ts`, requires `members.invite`): validates the target role belongs to the org, rejects duplicate pending invites for the same email and emails that already belong to a member, generates `token = crypto.randomUUID()`, sets `expiresAt = now + 7 days`, inserts the `invitations` row, and returns `inviteUrl = ${APP_URL}/invite/${token}` for the inviter to copy and send manually.
2. **Revoke** (`revoke-invitation.action.ts`, requires `members.invite`): deletes the pending invitation row.
3. **Acceptance** (`app/invite/[token]/page.tsx` + `accept-invitation.action.ts`) branches three ways:
   - Token invalid/expired → error page.
   - User already logged in with a matching email → one-click **Accept** button, transactionally inserts `organizationMembers` (`isOwner: false`, using the invite's role) and marks the invite accepted.
   - User already logged in with a **different** email → prompted to sign out first.
   - User not logged in → registration form (`registerAndAcceptAction`): Zod-validates name + password (min 8 chars), transactionally creates the `users` row (**email is taken from the invitation, not the form input** — prevents email spoofing), creates the credential `accounts` row, creates the membership, marks the invite accepted, then signs the new user in and redirects into the org.

## User-facing auth flows (`app/`)

| Route | Flow |
|---|---|
| `/setup` | First-run bootstrap — see above |
| `/login` | `login.action.ts` → `auth.api.signInEmail`; generic `"Invalid email or password."` on failure (no user-enumeration signal) |
| `/forgot-password` | `request-password-reset.action.ts` → `auth.api.requestPasswordReset`; **always** returns success regardless of whether the email exists (no enumeration oracle). See [security.md](security.md#authentication) for a note on where the reset link actually goes today |
| `/reset-password/[token]` | `reset-password.action.ts` → `auth.api.resetPassword`; generic "invalid or expired" error on failure |
| `/account` | Profile editing (name/email) + change-password form. Changing the password revokes every other active session for the account (see [security.md](security.md#authentication)) |
| `/account/sessions` | Lists all active sessions (`auth.api.listSessions`), current session first; supports revoking individual sessions |

## Access control enforcement

Two layers, neither of which is a single centralized `requirePermission(request, perm)` HTTP middleware — enforcement is deliberately per-action/per-page, right at the data-access boundary:

**1. Page-level (Server Components)** — fetch membership, gate rendering:
```ts
const membership = await getMembership(user.id, org.id);
if (!membership) redirect("/login");
if (!hasPermission(membership, "members.read")) notFound();
```
Owner-only pages (e.g. role management settings) check `membership.isOwner` directly rather than going through a permission string, since `roles.manage` can never be granted to any role anyway — functionally equivalent to `hasPermission`, but worth knowing if you're tracing exactly how a given page is gated.

**2. Action-level (Server Actions)** — the pattern shown in [architecture.md](architecture.md#server-actions-pattern): `getMembership()` then `assertPermission()`/`assertOwner()` wrapped in try/catch, converted to a typed `{ error }` return.

`proxy.ts` (the app-wide gate, see [architecture.md](architecture.md)) only checks *authentication*, not *authorization* — it has no concept of organizations, roles, or permissions.

## Known gaps / drift worth knowing about

- `retentionDays` on `projects` exists as a column (default 30) but the actual partition retention is a **global** 30-day `pg_partman` policy, not read per-project from this column — per-project retention configuration is schema-ready but not wired up.
- `projectMemberRoles` (per-project role overrides) is a placeholder table with no code path that populates it — all authorization today is at the organization level.
