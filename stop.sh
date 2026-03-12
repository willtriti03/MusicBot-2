#!/bin/bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")" || {
    echo "Could not change directory to MusicBot."
    exit 1
}

run_root() {
    if [[ "${EUID}" -eq 0 ]]; then
        "$@"
        return
    fi

    if command -v sudo > /dev/null 2>&1; then
        sudo "$@"
        return
    fi

    echo "This command requires root privileges: $*" >&2
    exit 1
}

echo "Stopping MusicBot services..."

if command -v docker > /dev/null 2>&1; then
    run_root docker compose -p musicbot-ts down --remove-orphans || true
    run_root docker compose down --remove-orphans || true
    run_root docker rm -f musicbot 2>/dev/null || true
fi

if command -v systemctl > /dev/null 2>&1; then
    run_root systemctl stop musicbot || true
    run_root systemctl disable musicbot || true
fi

echo "MusicBot shutdown sequence finished."
