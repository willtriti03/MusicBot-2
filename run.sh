#!/bin/bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")" || {
    echo "Could not change directory to MusicBot."
    exit 1
}

if ! command -v node > /dev/null 2>&1; then
    echo "Node.js is required to run MusicBot."
    exit 1
fi

if [[ ! -f "ts-bot/dist/main.js" ]]; then
    echo "Missing ts-bot/dist/main.js. Run ./install.sh or npm run build --prefix ts-bot first."
    exit 1
fi

exec node ts-bot/dist/main.js "$@"
