# Logger

A Next.js 16 application for structured log management.

## Prerequisites

- Node.js 20+
- Docker (for local Postgres)

## Local development

**1. Start Postgres:**

```bash
docker compose -f docker-compose.dev.yml up -d
```

**2. Copy env and install deps:**

```bash
cp .env.example .env.local
npm install
```

**3. Run migrations and start dev server:**

```bash
npm run db:migrate
npm run dev
```

App runs at http://localhost:80.

## Commands

```bash
npm run dev          # dev server (port 80)
npm run build        # production build
npm run start        # production server (port 80)
npm run lint         # ESLint

npm run db:generate  # generate Drizzle migration from schema
npm run db:migrate   # apply pending migrations
npm run db:push      # push schema without migrations (dev only)
npm run db:studio    # open Drizzle Studio

npm run test         # Vitest unit + integration tests
npm run test:e2e     # Playwright end-to-end tests
```

## Health checks

```
GET /api/health        # liveness — always 200
GET /api/health/ready  # readiness — 200 if DB ok, 503 if DB down
```
