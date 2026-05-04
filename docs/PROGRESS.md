# Progress

> Single source of truth for "where are we right now". Update after every work session.

**Last updated**: 2026-05-04 (Feature 01 — items 1–61 done)

---

## Current Phase

**Feature 01 — Auth + Organizations + Roles** · `docs/features/01-auth-organizations-roles.md`
Status: 🟨 In progress · 61 / 69 items

> First action when resuming: open `docs/features/01-auth-organizations-roles.md`, find the first unchecked item, continue from there.

**Done (1–61):** full auth, orgs, invitations, member management, roles CRUD, account pages, org settings, full App Shell (Sidebar + TopBar + OrgSwitcher + UserMenu + ThemeSwitcher + Redux hydration), live check passed.

**Remaining (62–69):**
- 62 — Unit tests (Vitest): `hasPermission`, `seedSystemRoles`, invite token validation, theme cookie roundtrip. Files: `shared/permissions/check.test.ts`, `features/roles/utils/seed-system-roles.test.ts`, `features/organizations/actions/invite-member.test.ts`, `core/theme/cookie.test.ts`
- 63 — E2E `e2e/auth-bootstrap.spec.ts`: setup wizard → org creation
- 64 — E2E `e2e/invite.spec.ts`: create invite → register via link → accept → role applied
- 65 — E2E `e2e/role-management.spec.ts`: create custom role → assign to user → user sees only those perms
- 66 — E2E `e2e/theme.spec.ts`: toggle theme → reload → state preserved
- 67 — Update PROGRESS.md row for feature 01 → ✅ Done
- 68 — Update Status block in feature doc
- 69 — End-to-end live check (see "Live check" section in feature doc)

**Test infra note:** Vitest config at `vitest.config.ts`, E2E via Playwright at `e2e/`. Check existing test in `shared/permissions/check.test.ts` (item 11, already written) as a reference for style.

---

## Roadmap

Each feature has its own implementation doc with a status block, decisions, schema, server actions, components, routes, and a step-by-step checklist.

| # | Feature | Status | Doc |
|---|---|---|---|
| — | Design System + UI kit (side track) | ✅ Done | [features/design-system.md](features/design-system.md) |
| 00 | Foundation | ✅ Done | [features/00-foundation.md](features/00-foundation.md) |
| 01 | Auth + Organizations + Roles | 🟨 In progress | [features/01-auth-organizations-roles.md](features/01-auth-organizations-roles.md) |
| 02 | Projects + API keys | 🟦 Planned | [features/02-projects-api-keys.md](features/02-projects-api-keys.md) |
| 03 | Ingest | 🟦 Planned | [features/03-ingest.md](features/03-ingest.md) |
| 04 | Events list + filters + detail | 🟦 Planned | [features/04-events-list-filters.md](features/04-events-list-filters.md) |
| 05 | Dashboard | 🟦 Planned | [features/05-dashboard.md](features/05-dashboard.md) |
| 06 | Alerts | 🟦 Planned | [features/06-alerts.md](features/06-alerts.md) |
| 07 | Polish | 🟦 Planned | [features/07-polish.md](features/07-polish.md) |
| 08 | Docker packaging | 🟦 Planned | [features/08-docker-packaging.md](features/08-docker-packaging.md) |

Status legend:
- ⬜ Not started — no work yet
- 🟦 Planned — feature doc detailed, ready to implement
- 🟨 In progress — work started, see checklist
- ✅ Done — all checklist items complete, live check passed

"Planning pending" means the feature doc is a stub. We detail it when we reach it (or earlier if dependencies require).

---

## How to Resume After a Break

1. Read this file (PROGRESS.md) → identify current phase.
2. Open the linked feature doc.
3. Read its **Status**, **Locked decisions**, and **Implementation Checklist** sections.
4. Find the first unchecked item.
5. Continue.

If the feature doc says "planning pending" — stop and ask the user to detail the feature before implementation.

---

## Conventions

- **Doc updates**: when a feature is touched, update its status block (`Last touched`, `Progress: X/Y`). Update PROGRESS.md row.
- **Decisions made mid-implementation**: log them in the feature doc's "Decision log (local)" section. If the decision affects more than one feature → also append to PLAN.md §17.
- **New permission added**: register in `shared/permissions/registry.ts` AND list in PLAN.md §5 AND mention in the feature doc that introduced it.
- **New env variable**: add to `.env.example` AND the feature doc.
