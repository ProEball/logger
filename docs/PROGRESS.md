# Progress

> Single source of truth for "where are we right now". Update after every work session.

**Last updated**: 2026-04-30

---

## Current Phase

**Feature 00 — Foundation** · `docs/features/00-foundation.md`
Status: ⬜ Not started · 0 / N items

> First action when resuming: open the feature doc above, find the first unchecked item in its Implementation Checklist, continue from there.

---

## Roadmap

Each feature has its own implementation doc with a status block, decisions, schema, server actions, components, routes, and a step-by-step checklist.

| # | Feature | Status | Doc |
|---|---|---|---|
| 00 | Foundation | ⬜ Not started | [features/00-foundation.md](features/00-foundation.md) |
| 01 | Auth + Organizations + Roles | ⬜ Not started | [features/01-auth-organizations-roles.md](features/01-auth-organizations-roles.md) |
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
