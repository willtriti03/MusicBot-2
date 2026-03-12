#!/bin/bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")" || {
    echo "Could not change directory to MusicBot."
    exit 1
}

require_command() {
    if ! command -v "$1" > /dev/null 2>&1; then
        echo "Missing required command: $1"
        exit 1
    fi
}

require_command node
require_command npm

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)'; then
    echo "Node.js 22.12 or newer is required."
    exit 1
fi

warn_missing_command() {
    if ! command -v "$1" > /dev/null 2>&1; then
        echo "Warning: '$1' is not installed."
        echo "         Music playback will not work until '$1' is available in PATH."
    fi
}

warn_missing_command ffmpeg
warn_missing_command yt-dlp

echo "Installing ts-bot dependencies..."
npm install --prefix ts-bot

echo "Building ts-bot..."
npm run build --prefix ts-bot

if [[ ! -f ".env" ]]; then
    cp "config/musicbot.env.example" ".env"
fi

echo ""
echo "Install complete."
echo "Next steps:"
echo "  1. Edit .env or /etc/musicbot/musicbot.env"
echo "  2. Review config/config.json"
echo "  3. Install ffmpeg and yt-dlp if this host should play music"
echo "  4. Run: ./run.sh"
echo "  5. For systemd deployment, copy this repo to /opt/musicbot and install musicbot.service"
