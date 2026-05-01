# 02. Projects + API keys

## Status
- [ ] Not started · [ ] In progress · [ ] Done
- Started: —
- Completed: —
- Last touched: 2026-04-30 (planning)
- Progress: 0 / 38 checklist items

## Goal

Allow users with `projects.create` to create projects within their organization. Each project has API keys for ingest authentication. Keys are shown once on creation, hashed at rest. Projects soft-delete; events fade out via 30d retention.

## Prerequisites

- ✅ 01-auth-organizations-roles

## Locked decisions

| ID | Question | Resolution |
|---|---|---|
| Q-B1 | API key format | `lgr_<base64url(32 bytes)>` — 256-bit entropy + searchable prefix |
| Q-B2 | Storage | SHA-256 hex hash + `key_prefix` (first 4 chars after `lgr_`) for UI identification |
| Q-B3 | Reveal | Show once on creation. No re-reveal possible (one-way hash). |
| Q-B4 | Per-project member overrides | **Removed from MVP**. Only org-level roles. `project_member_roles` stays as schema stub for future. |
| Q-B5 | Project slug uniqueness | Per-org. URL: `/[org]/[project]/...` |
| Q-B6 | Project deletion | Soft delete (`deleted_at`). No auto-purge in MVP. |
| Q-B7 | Per-project retention | Column exists (`retention_days int default 30`), NOT editable in MVP. Global 30d retention applies. |
| Q-B8 | Create permission | `projects.create` (already in registry). Default: Admin yes, Member no. |
| Q-B9 | Slug input | Auto-generated from name via `slugify`. User can edit before save. |
| Q-B10 | Hard limits | None in MVP. `organizations.limits` jsonb available for future. |

## Data model

```ts
projects
  id              uuid pk
  organization_id uuid fk → organizations.id ON DELETE CASCADE
  name            text                                       -- "My API Server"
  slug            text                                       -- "my-api-server"
  retention_days  int default 30                             -- not enforced yet (Q-B7)
  deleted_at      timestamptz                                -- soft delete (Q-B6)
  created_at, updated_at
  
  UNIQUE INDEX (organization_id, slug) WHERE deleted_at IS NULL  -- only active slugs unique
  INDEX (organization_id) WHERE deleted_at IS NULL

api_keys
  id              uuid pk
  project_id      uuid fk → projects.id ON DELETE CASCADE
  name            text                                       -- "Production server", "CI"
  key_hash        text                                       -- sha256 hex (64 chars)
  key_prefix      text                                       -- first 4 chars after lgr_, e.g. "aBcD"
  last_used_at    timestamptz                                -- updated by ingest endpoint
  created_at      timestamptz
  revoked_at      timestamptz                                -- null = active
  created_by      uuid fk → users.id ON DELETE SET NULL
  
  UNIQUE INDEX (key_hash)                                    -- collision protection + fast lookup
  INDEX (project_id) WHERE revoked_at IS NULL
```

### Soft-delete contract for events

Projects are soft-deleted (`deleted_at` set). API keys for that project are revoked atomically (`revoked_at` set) — see step 13. **Events are NOT touched** — they remain in `events` until 30-day retention drops their partitions.

Implications across features:
- **Feature 04 (events list)**: when querying events, JOIN with `projects` and filter `WHERE projects.deleted_at IS NULL`. A user navigating to `/[org]/[project]/events` for a soft-deleted project hits 404 at the route level (feature 02 step 16 enforces this in the `[project]/layout.tsx`). No "archived events" view in MVP.
- **Feature 03 (ingest)**: API key lookup already filters `revoked_at IS NULL`. Soft-deleted projects have all keys revoked, so ingest naturally rejects with 401.
- **Feature 06 (alerts)**: alert evaluator must skip rules whose project has `deleted_at IS NOT NULL`. Add to `listEnabled(projectId)` query.
- **Hard purge**: not in MVP. If needed later, add a maintenance job: `DELETE FROM projects WHERE deleted_at < NOW() - INTERVAL '30 days'` — events for that project will be gone via partition drop by then anyway.

### Migration split

- `0005_projects.sql` — projects table
- `0006_api_keys.sql` — api_keys table

## Server-side artifacts

### Services
- `features/projects/services/projects.service.ts` — CRUD; all reads filter `deleted_at IS NULL` by default
- `features/projects/utils/slugify.ts` — name → slug + uniqueness retry helper (`my-api-server`, `my-api-server-2` if collision)
- `features/api-keys/services/api-keys.service.ts` — generate, hash, lookup-by-hash, revoke
- `features/api-keys/utils/key-generator.ts` — `crypto.randomBytes(32)` → base64url with `lgr_` prefix
- `features/api-keys/utils/key-hash.ts` — SHA-256 hex helper

### Server actions
```
features/projects/actions/
  create-project.action.ts        — assertPermission('projects.create')
  update-project.action.ts        — assertPermission('projects.update')
  delete-project.action.ts        — assertPermission('projects.delete'), soft delete

features/api-keys/actions/
  create-api-key.action.ts        — assertPermission('api_keys.manage'), returns plain key ONCE
  revoke-api-key.action.ts        — assertPermission('api_keys.manage'), sets revoked_at
```

## Client-side artifacts

```
features/projects/components/
  ProjectsList.tsx                — grid/list of projects
  ProjectCard.tsx                 — single card with stats placeholder
  ProjectCreateForm.tsx           — name + auto-slug (editable)
  ProjectSettingsForm.tsx         — name, slug, danger zone
  ProjectDeleteDialog.tsx         — confirm with project name retype
  parts/
    SlugInput.tsx                 — input with auto-fill from name + manual override

features/api-keys/components/
  ApiKeysList.tsx                 — table: name, prefix, last_used, status, actions
  ApiKeyRow.tsx
  ApiKeyCreateDialog.tsx          — form: name only
  ApiKeyCreatedDialog.tsx         — shows plain key with copy + "I saved it" confirm
  ApiKeyRevokeDialog.tsx          — confirm
```

### Hooks
- `features/projects/hooks/use-current-project.ts` — reads from URL/Redux
- `features/api-keys/hooks/use-api-keys.ts` — list with revalidation after revoke

### Redux
- `core/store/slices/project.ts` — current project context (id, slug, name, org_id)

## Routes

```
/[org]/projects                                 projects.read
  └─ list of projects, "New project" button     projects.create
/[org]/projects/new                             projects.create
/[org]/[project]                                projects.read           — dashboard placeholder, real content in feature 05
/[org]/[project]/settings                       projects.update
/[org]/[project]/settings/api-keys              api_keys.read
  └─ "Create API key" button                    api_keys.manage
/[org]/[project]/settings/danger                projects.delete         — soft delete project
```

## Designs

- 🎨 Status: ⬜ not requested
- Destination: `docs/designs/screens/02-projects/`
- Key visuals to design:
  - Empty state: "No projects yet — create your first" full-page CTA
  - Project card (in list): name, slug, recent activity placeholder
  - API key reveal modal — must be visually distinct (copy once, never again)
  - Soft-delete confirm: typed-confirmation pattern (typing project name to enable button)

## Implementation Checklist

### Schema
- [ ] 1. Drizzle schema: `projects` with `deleted_at` and conditional unique constraint on `(organization_id, slug)`
- [ ] 2. Drizzle schema: `api_keys` with `key_hash`, `key_prefix`, `revoked_at`
- [ ] 3. Generate migrations 0005, 0006; run `db:migrate`
- [ ] 4. Inspect via `db:studio`

### Slug + naming
- [ ] 5. `features/projects/utils/slugify.ts`: name → kebab-case-ascii. Use lightweight regex (no extra dep), fallback to `random-suffix` if empty.
- [ ] 6. Slug uniqueness retry: rely on the partial UNIQUE INDEX as source of truth — wrap insert in try/catch on Postgres unique-violation (`23505`), retry with `slug-2`, `slug-3`, up to 10 attempts then error. Pre-check (`SELECT WHERE slug=...`) is racy under concurrent creates and must NOT be used as the gate.
- [ ] 7. Unit test: slugify ascii / unicode / numbers / empty / collision retry.

### Project services
- [ ] 8. `projects.service.ts`: `create`, `update`, `softDelete`, `findBySlug`, `listForOrg` (all filter `deleted_at IS NULL`).
- [ ] 9. `getCurrentProjectFromParams(org, project)` helper for server components.
- [ ] 10. Unit test: list excludes soft-deleted; findBySlug returns null for deleted.

### Project actions + UI
- [ ] 11. `create-project.action.ts` (Zod: name min 2, max 80; slug optional pattern `/^[a-z0-9-]+$/`).
- [ ] 12. `update-project.action.ts`.
- [ ] 13. `delete-project.action.ts` — sets `deleted_at`, also revokes all api_keys atomically.
- [ ] 14. `app/[org]/projects/page.tsx` (server component) — `ProjectsList` or empty CTA.
- [ ] 15. `app/[org]/projects/new/page.tsx` + `ProjectCreateForm` (gform-react). `SlugInput` auto-fills, can be overridden.
- [ ] 16. `app/[org]/[project]/layout.tsx` — loads current project, 404 if not found or deleted, hydrates Redux project slice.
- [ ] 17. `app/[org]/[project]/settings/page.tsx` + `ProjectSettingsForm`.
- [ ] 18. `app/[org]/[project]/settings/danger/page.tsx` — Delete project with `ProjectDeleteDialog` (typed-confirm).
- [ ] 19. Live check: create project → URL works → edit → soft-delete → URL 404s → DB row has `deleted_at` set.

### API key core
- [ ] 20. `key-generator.ts`: `lgr_${base64url(crypto.randomBytes(32))}`.
- [ ] 21. `key-hash.ts`: SHA-256 hex via Node `crypto`.
- [ ] 22. `api-keys.service.ts`:
  - `generate(projectId, name, createdBy)` → returns `{ key, prefix, hash, row }`. Inserts row with hash + prefix, returns plain key.
  - `lookupByPlainKey(plainKey)` → SHA-256 → query by hash → returns active key + project, or null.
  - `revoke(id)` → sets `revoked_at`.
- [ ] 23. Unit test: generate produces correct format; lookup roundtrip works; revoked key returns null on lookup.
- [ ] 24. Integration test: two keys with different secrets have unique hashes.

### API key actions + UI
- [ ] 25. `create-api-key.action.ts` (Zod: name required). Returns plain key ONLY in this response — never stored anywhere else.
- [ ] 26. `revoke-api-key.action.ts`.
- [ ] 27. `app/[org]/[project]/settings/api-keys/page.tsx` (server component) — `ApiKeysList`.
- [ ] 28. `ApiKeyRow`: shows name, `lgr_<prefix>...` masked display, last_used relative time, status badge, revoke button.
- [ ] 29. `ApiKeyCreateDialog`: gform with name. On submit → calls action → result triggers `ApiKeyCreatedDialog`.
- [ ] 30. `ApiKeyCreatedDialog`: full plain key with monospace + Copy button + "I've saved it" confirm checkbox enabling Close. Cannot dismiss without checkbox.
- [ ] 31. `ApiKeyRevokeDialog`: confirm action.
- [ ] 32. Live check: create key → see plain value once → close → see only `lgr_aBcD...` masked → revoke → confirmed revoked status.

### Empty states + permissions
- [ ] 33. Empty state on `/[org]/projects` when no projects: full-page CTA. Hide CTA if user lacks `projects.create`.
- [ ] 34. Empty state on api-keys page when none: inline CTA. Hide if user lacks `api_keys.manage`.
- [ ] 35. UI: hide all create/edit/delete/revoke buttons via `usePermission` for users without rights.
- [ ] 36. Server actions enforce same with `assertPermission` — UI hiding is convenience, not security.

### Tests
- [ ] 37. E2E (`e2e/projects.spec.ts`): create project → edit → soft-delete → 404. Permission check: viewer cannot create.
- [ ] 38. E2E (`e2e/api-keys.spec.ts`): create → see plain → close → revoke → cannot create event with revoked key (this last assertion deferred to feature 03; mark as TODO).

### Final
- [ ] 39. Update PROGRESS.md row for feature 02 → ✅ Done.
- [ ] 40. Update Status block.
- [ ] 41. End-to-end live check (see "Live check" section).

## Live check (full)

After implementing, with one user signed in (owner from feature 01):

1. `/[org]/projects` shows empty state CTA.
2. Create project "API Server" → slug auto-fills to `api-server`.
3. Land on `/[org]/api-server` (placeholder dashboard for now).
4. Open `/[org]/api-server/settings/api-keys` → empty state.
5. Create key "CI" → modal shows full `lgr_...` value with Copy.
6. Save the value somewhere (we need it for feature 03 ingest test).
7. Click "I've saved it" → modal closes → list shows `lgr_aBcD... · last used: never · active`.
8. Revoke key → confirmation → row shows `revoked` badge.
9. Soft-delete project → `/[org]/api-server` returns 404 → DB row has `deleted_at` set, api_keys for that project also have `revoked_at`.
10. Permissions: switch to a user with role `Viewer` → no Create buttons visible; direct POST to action returns 403.

## Tests

- Unit (Vitest): `slugify`, `key-generator`, `key-hash`, services with soft-delete awareness.
- E2E (Playwright): `projects.spec.ts`, `api-keys.spec.ts`.

## Open questions

None outstanding for this feature.

## Decision log (local)

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-01 | Soft-deleted projects: events stay until partition drop, no archive UI | Simplest contract; 30-day retention naturally garbage-collects them; restore feature deferred |
| 2026-05-01 | FK cascades: `projects → organizations CASCADE`, `api_keys → projects CASCADE`, `api_keys.created_by → users SET NULL` | Org delete should wipe its projects/keys; key audit trail survives user deletion |
| 2026-05-01 | Slug uniqueness via DB constraint + retry on `23505`, no pre-check | Pre-check is racy; the partial UNIQUE INDEX is the only correct source of truth |
