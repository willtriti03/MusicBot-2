#!/bin/sh
set -eu

mkdir -p /app/data /app/audio_cache /app/data/tmp

if [ -z "${DISCORD_TOKEN:-}" ]; then
    echo "DISCORD_TOKEN is not set. Put it in .env before starting the container." >&2
    exit 1
fi

exec "$@"

