#!/bin/bash
set -euo pipefail

SERVICE_NAME="musicbot"
SYSTEMD_UNIT="/etc/systemd/system/${SERVICE_NAME}.service"

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

echo "Uninstalling MusicBot service registration..."

if command -v docker > /dev/null 2>&1; then
    run_root docker compose -p musicbot-ts down --remove-orphans || true
    run_root docker compose down --remove-orphans || true
    run_root docker rm -f musicbot 2>/dev/null || true
fi

if command -v systemctl > /dev/null 2>&1; then
    run_root systemctl stop "${SERVICE_NAME}" || true
    run_root systemctl disable "${SERVICE_NAME}" || true

    if run_root test -f "${SYSTEMD_UNIT}"; then
        run_root rm -f "${SYSTEMD_UNIT}"
    fi

    run_root systemctl daemon-reload || true
    run_root systemctl reset-failed "${SERVICE_NAME}" || true
fi

echo "MusicBot uninstall sequence finished."
