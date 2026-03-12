#!/bin/bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")" || {
    echo "Could not change directory to MusicBot."
    exit 1
}

if ! command -v node > /dev/null 2>&1 || ! command -v npm > /dev/null 2>&1; then
    echo "Node.js and npm are required to update MusicBot."
    exit 1
fi

echo "Refreshing ts-bot dependencies..."
npm install --prefix ts-bot

echo "Rebuilding ts-bot..."
npm run build --prefix ts-bot

echo ""
echo "Update complete."
echo "If this host uses systemd, reload the service with:"
echo "  sudo systemctl restart musicbot"
