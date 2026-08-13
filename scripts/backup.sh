#!/bin/sh
# Nightly database backup for the production compose stack.
#
# Runs as the `backup` service's entrypoint: takes a dump immediately on start
# (so a fresh deployment has a restore point within seconds rather than after
# the first interval), rotates the local copies, optionally pushes offsite with
# rclone, then sleeps and repeats.
#
# Deliberately a `while sleep` loop rather than cron: the postgres image has no
# cron daemon, and a loop inside PID 1 means the container's health and the
# backup's health are the same thing — if backups stop, the container is gone.
#
# Local retention is intentionally small (3 by default). The offsite bucket is
# the real archive and its lifecycle rules own long-term retention; local files
# exist to make a same-day restore fast.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"
BACKUP_RETENTION_COUNT="${BACKUP_RETENTION_COUNT:-3}"
OFFSITE="${OFFSITE:-false}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

log() {
    # Matches the app's pino output closely enough to read `docker logs` for all
    # services together without switching mental formats.
    echo "{\"level\":\"$1\",\"time\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"service\":\"backup\",\"msg\":\"$2\"}"
}

# Fail loudly at startup rather than silently skipping the offsite copy every
# night for a month and discovering it during an actual restore.
if [ "$OFFSITE" = "true" ] && [ -z "$RCLONE_REMOTE" ]; then
    log error "OFFSITE=true but RCLONE_REMOTE is empty — refusing to start"
    exit 1
fi
if [ "$OFFSITE" = "true" ] && ! command -v rclone >/dev/null 2>&1; then
    log error "OFFSITE=true but rclone is not installed in this image — refusing to start"
    exit 1
fi

take_backup() {
    target="${BACKUP_DIR}/$(date -u +%Y%m%d-%H%M%S).dump"

    # -Fc: custom format. Compressed, and the only format `pg_restore` can
    # restore selectively from. Connection details come from the standard
    # PG* environment variables set by compose.
    #
    # Written to a .partial name first: a dump interrupted by a container
    # restart would otherwise sit in the directory looking like a valid
    # backup, and rotation would happily delete a good one to keep it.
    if ! pg_dump -Fc --file="${target}.partial"; then
        log error "pg_dump failed — no new backup this cycle"
        rm -f "${target}.partial"
        return 1
    fi
    mv "${target}.partial" "$target"
    log info "wrote $(basename "$target") ($(du -h "$target" | cut -f1))"

    rotate
    copy_offsite "$target"
}

rotate() {
    # Newest first, drop everything past the retention count.
    ls -1t "${BACKUP_DIR}"/*.dump 2>/dev/null \
        | tail -n "+$((BACKUP_RETENTION_COUNT + 1))" \
        | while read -r stale; do
            log info "rotating out $(basename "$stale")"
            rm -f "$stale"
        done
}

copy_offsite() {
    [ "$OFFSITE" = "true" ] || return 0

    if rclone copy "$1" "$RCLONE_REMOTE"; then
        log info "copied $(basename "$1") to ${RCLONE_REMOTE}"
    else
        # Not fatal: a local backup with a failed upload still beats no backup,
        # and the next cycle retries. The error line is what monitoring watches.
        log error "rclone copy to ${RCLONE_REMOTE} failed — local copy retained"
    fi
}

mkdir -p "$BACKUP_DIR"
log info "backup loop starting (interval=${BACKUP_INTERVAL_HOURS}h retention=${BACKUP_RETENTION_COUNT} offsite=${OFFSITE})"

# `set -e` is relaxed around the loop body on purpose — a single failed dump
# must not kill the loop, or one transient error would end backups until
# somebody noticed the container had exited.
while true; do
    take_backup || true
    sleep "$((BACKUP_INTERVAL_HOURS * 3600))"
done
