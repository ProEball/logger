#!/bin/sh
# Restores the database from a backup produced by scripts/backup.sh.
#
#   docker compose exec backup sh /scripts/restore.sh /backups/20260813-030000.dump
#
# Invoked through `sh` rather than directly, because the scripts are bind-mounted
# from the host and the executable bit does not survive every checkout.
#
# Destructive: every table in the target database is dropped and rebuilt from
# the dump. Anything written since that dump is gone. See docs/OPERATIONS.md.
set -eu

DUMP_FILE="${1:-}"

log() {
    echo "{\"level\":\"$1\",\"time\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"service\":\"restore\",\"msg\":\"$2\"}"
}

if [ -z "$DUMP_FILE" ]; then
    echo "usage: restore.sh <dumpfile>" >&2
    echo "" >&2
    echo "available backups:" >&2
    ls -1t "${BACKUP_DIR:-/backups}"/*.dump 2>/dev/null >&2 || echo "  (none)" >&2
    exit 2
fi

if [ ! -f "$DUMP_FILE" ]; then
    log error "no such file: ${DUMP_FILE}"
    exit 2
fi

# Verify the archive is readable *before* dropping anything. Restoring from a
# truncated dump onto a wiped database is the one unrecoverable mistake here.
if ! pg_restore --list "$DUMP_FILE" >/dev/null 2>&1; then
    log error "${DUMP_FILE} is not a readable pg_dump custom-format archive — refusing to restore"
    exit 1
fi

TARGET_DB="${PGDATABASE:-logger}"

# Skippable for scripted disaster recovery, but never silently: RESTORE_YES
# must be set deliberately.
if [ "${RESTORE_YES:-}" != "true" ]; then
    printf 'This DROPS every object in database "%s" and rebuilds it from\n' "$TARGET_DB" >&2
    printf '  %s\n' "$DUMP_FILE" >&2
    printf 'Data written after that dump will be lost. Type the database name to confirm: ' >&2
    read -r confirmation
    if [ "$confirmation" != "$TARGET_DB" ]; then
        log info "confirmation did not match — nothing was changed"
        exit 1
    fi
fi

log info "restoring ${TARGET_DB} from $(basename "$DUMP_FILE")"

# The database is dropped and recreated rather than restored over with
# `pg_restore --clean`. `--clean` cannot handle this schema: `events` is
# declaratively partitioned, and its per-partition primary keys are inherited
# constraints that Postgres refuses to drop directly —
#
#   ERROR: cannot drop inherited constraint "events_p20260820_pkey"
#
# — which aborts the restore partway through the drop phase. Restoring into a
# genuinely empty database sidesteps it. The dump carries the `drizzle` and
# `pgboss` schemas and the pg_partman extension, so nothing else needs
# recreating by hand.
#
# All maintenance runs against the `postgres` database, since a database cannot
# be dropped from a session connected to it.
log info "terminating connections to ${TARGET_DB}"
psql -d postgres -v ON_ERROR_STOP=1 -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
     WHERE datname = '${TARGET_DB}' AND pid <> pg_backend_pid();" >/dev/null

# Anything reconnecting between here and the restore would recreate the problem;
# `app` and `worker` must already be stopped (see docs/OPERATIONS.md).
psql -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"${TARGET_DB}\";"
psql -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${TARGET_DB}\" OWNER \"${PGUSER:-postgres}\";"

# --exit-on-error: the default is to report errors and carry on, which would
# leave a half-restored database exiting 0 and looking successful.
pg_restore \
    --dbname="$TARGET_DB" \
    --no-owner \
    --no-privileges \
    --exit-on-error \
    "$DUMP_FILE"

log info "restore complete — start app and worker, then check /api/health/ready"
