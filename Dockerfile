# syntax=docker/dockerfile:1

# One image, three processes. `app` runs the Next.js standalone server, `worker`
# runs the pg-boss job runner, and the one-shot `migrate` container applies
# pending migrations before either starts. Building them together guarantees
# all three run the exact same application code — a worker built separately
# could drift a commit behind the app and evaluate alerts against a stale
# schema. `docker-compose.yml` picks the process with `command:`.

ARG NODE_VERSION=22-alpine

# ── deps ──────────────────────────────────────────────────────────────────────
# Only the manifests are copied, so this layer is reused across builds until a
# dependency actually changes. A full install, not `--omit=dev`: the build needs
# next/typescript/sass/esbuild, and the runner takes its dependencies from the
# pruned `node_modules` that `output: 'standalone'` emits, so a second
# production-only install would be copied nowhere and only slow the build.
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── builder ───────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Surfaced by GET /api/version. These are `NEXT_PUBLIC_`, so `next build`
# inlines them into the client bundle — they must be present at build time and
# setting them at run time has no effect.
ARG NEXT_PUBLIC_BUILD_SHA=""
ARG NEXT_PUBLIC_BUILD_TIME=""
ENV NEXT_PUBLIC_BUILD_SHA=${NEXT_PUBLIC_BUILD_SHA} \
    NEXT_PUBLIC_BUILD_TIME=${NEXT_PUBLIC_BUILD_TIME}

# Produces `.next/standalone` (app) and `dist/{worker,migrate}.js` (the two
# Node entrypoints Next does not build — see scripts/build-worker.mjs).
#
# `next build` imports the env schema in `core/env`, which requires
# DATABASE_URL and AUTH_SECRET to be present and well-formed. No database is
# contacted at build time; these are throwaway values that exist only to
# satisfy the schema, and the real ones arrive from `env_file` at run time.
# They are set on the RUN line rather than with ENV so they live only for the
# duration of the command — an ENV would persist into this stage's metadata.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    AUTH_SECRET="build-time-placeholder-never-used-at-runtime" \
    npm run build

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

# Baked into the image rather than left to `env_file`, because all three
# processes depend on it and only one of them (`app`) gets it implicitly.
# `next build` already hardcoded production behaviour into the app bundle; the
# worker and migrate containers are plain `node`, where an unset NODE_ENV would
# silently select development branches — the pooled-client global in
# `core/db/client.ts` among them.
ENV NODE_ENV=production

# HOSTNAME: bind to every interface. Next's standalone server defaults to
# localhost, which inside a container means the proxy cannot reach it.
# PORT: the app's listening port, referenced by the compose healthcheck and by
# `reverse_proxy app:3000` in the Caddyfile. Change all three together.
# MIGRATIONS_DIR: read by `migrate.js`; migrations are copied to /app/migrations.
ENV HOSTNAME=0.0.0.0 \
    PORT=3000 \
    MIGRATIONS_DIR=/app/migrations

# The stock `node` user (uid 1000) already exists in the base image.
USER node

# `standalone` carries its own pruned node_modules, so nothing is installed
# here. `static` and `public` are not copied into it automatically.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# Self-contained esbuild bundles: no node_modules resolution at run time.
COPY --from=builder --chown=node:node /app/dist/worker.js ./worker.js
COPY --from=builder --chown=node:node /app/dist/migrate.js ./migrate.js
COPY --from=builder --chown=node:node /app/core/db/migrations ./migrations

EXPOSE 3000

# Overridden to `node worker.js` / `node migrate.js` by the other two services.
# Exec form, so the process is PID 1 and receives SIGTERM directly.
CMD ["node", "server.js"]
