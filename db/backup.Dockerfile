# Image for the `backup` service.
#
# Needs two tools in one place: `pg_dump`/`pg_restore` and `rclone`. The
# postgres client version must be >= the server version (pg_dump refuses to dump
# a newer server), so this tracks the same major as `db/Dockerfile` — bump both
# together.
FROM postgres:16-alpine

# `--no-cache` keeps the layer small; rclone is a single static binary.
RUN apk add --no-cache rclone
