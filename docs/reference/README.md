# Logger — Reference Documentation

This is the authoritative technical reference for the Logger project: a self-hosted, invite-only, multi-tenant structured event logging / observability service.

It is generated from the actual codebase (not from planning docs), most recently refreshed **2026-08-13**, cross-checked against `docs/PLAN.md` and `docs/features/*.md`. Where the planning docs and the real implementation disagree, this reference describes **what the code actually does**, and calls out the discrepancy in a note.

This documentation is written to be equally useful to a human engineer onboarding onto the project and to an AI coding assistant that needs precise, verifiable facts (exact field names, exact permission strings, exact status codes) rather than prose summaries.

## Contents

| Doc | Covers |
|---|---|
| [stack.md](stack.md) | Tech stack, dependencies, required environment, env vars |
| [architecture.md](architecture.md) | Folder structure, layering rules, database schema, background jobs |
| [api.md](api.md) | HTTP API — ingest, health, version, auth, Server Actions pattern |
| [users-roles.md](users-roles.md) | Users, organizations, membership, roles, permissions, invitations |
| [logging.md](logging.md) | The event/log data model, filtering, dashboard, alerts |
| [security.md](security.md) | AuthN/AuthZ, API key security, rate limiting, headers, known gaps |
| [misc.md](misc.md) | Testing, deployment/Docker, i18n, theming, logging-the-app-itself |

## How this project is organized (one paragraph)

An **organization** contains **projects**; each project receives **events** (structured log lines) via an ingest API authenticated with a per-project **API key**. Users belong to an organization via **membership**, which carries a **role** (a named, permission-string-based bundle) or the special **owner** flag. Within a project, users can browse/filter events, view a metrics **dashboard**, and configure **alert rules** that evaluate on a schedule and notify a webhook. The whole app is a single Next.js 16 deployable plus an optional separate **worker** process for scheduled jobs (partition maintenance, alert evaluation, alert delivery), backed by one PostgreSQL database (partitioned event storage via `pg_partman`) and no other required infrastructure (no Redis, no external queue).

## Source-of-truth note for maintainers

Existing planning docs (`docs/PLAN.md`, `docs/features/00-08*.md`) are kept as-is and are **not** the source for this reference — they document intent and design history, and have drifted from the implementation in places (noted throughout this reference). When code and those docs conflict, trust this reference or re-verify against the code directly; when *this* reference goes stale, regenerate it from the code, not from the planning docs.
