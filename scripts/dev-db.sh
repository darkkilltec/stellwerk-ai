#!/bin/sh
# Starts the dev database with docker or podman, whichever exists,
# and waits until Postgres accepts connections. Replaces `docker compose
# up -d --wait db`, whose --wait podman-compose only tolerates but does
# not implement.
set -e
if command -v docker >/dev/null 2>&1; then RUNTIME=docker; else RUNTIME=podman; fi
$RUNTIME compose up -d db
for i in $(seq 1 30); do
  $RUNTIME exec "$($RUNTIME ps --format '{{.Names}}' | grep db | head -1)" \
    pg_isready -U app -d stellwerk >/dev/null 2>&1 && exit 0
  sleep 1
done
echo "database did not become ready" >&2
exit 1
