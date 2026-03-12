# MusicBot

MusicBot now runs as a single-process TypeScript/Node application under `ts-bot/`. The old Python runtime, PM2 flow, and embedded sidecar path are no longer the supported deployment targets.

## Runtime

- Node.js `22.12+`
- `ffmpeg` in `PATH`
- `yt-dlp` in `PATH`
- Linux with `systemd` for production deployment

The bot is slash-command only. The first TypeScript cut includes:

- `play`, `stream`, `summon`, `skip`, `pause`, `resume`, `queue`, `np`, `volume`, `disconnect`
- `autoplaylist`, `autosimilar`, `shuffle`, `clear`, `remove`
- `latency`, `botlatency`
- SQLite-backed guild settings, autoplaylist storage, and queue recovery

These legacy features are intentionally outside the TypeScript rewrite scope:

- text commands
- voice recognition / `listen`
- `seek`
- `speed`
- PM2-based process management

## Configuration

Static settings live in `config/config.json`.

Secrets come from either:

- repo-local `.env`
- `MUSICBOT_ENV_PATH`
- Linux `EnvironmentFile`, such as `/etc/musicbot/musicbot.env`

An example environment file is provided at `config/musicbot.env.example`.

## Docker

If you want a one-shot runtime with Node.js, `ffmpeg`, and `yt-dlp` bundled, use Docker:

```bash
docker compose up -d --build
docker compose logs -f musicbot
```

This compose stack uses the explicit project name `musicbot-ts` so it does not try to reuse or replace older legacy containers that were created under different names. On Linux it also runs with `network_mode: host`, because the bot does not expose ports and this avoids Docker bridge/iptables failures on hosts with broken `DOCKER-ISOLATION` chains.

If you are migrating from an older manual container, clear the old instance first:

```bash
docker compose down --remove-orphans
docker rm -f musicbot 2>/dev/null || true
docker compose up -d --build
```

The included [docker-compose.yml](/Users/leejungjun/MusicBot-2/docker-compose.yml) mounts:

- [config/config.json](/Users/leejungjun/MusicBot-2/config/config.json) as read-only runtime config
- `./data` for the SQLite database
- `./audio_cache` for downloaded audio files

Secrets come from the repo-local [/.env](/Users/leejungjun/MusicBot-2/.env). Inside the container, startup fails fast if `DISCORD_TOKEN` is missing.

## Local Build

```bash
./install.sh
cp config/musicbot.env.example .env
./run.sh
```

On apt-based Linux hosts, `./install.sh` will attempt to install Node.js `22.x`, `ffmpeg`, `yt-dlp`, and the local npm dependencies for you. On macOS, the same script can do the equivalent via Homebrew.

## systemd Deployment

The shipped `musicbot.service` targets this layout:

- app root: `/opt/musicbot`
- working directory: `/opt/musicbot/ts-bot`
- service env file: `/etc/musicbot/musicbot.env`

Typical deployment flow:

```bash
sudo install -d /opt/musicbot /etc/musicbot
sudo rsync -a --delete --exclude '.git' --exclude 'audio_cache' --exclude 'data' ./ /opt/musicbot/
sudo npm install --prefix /opt/musicbot/ts-bot
sudo npm run build --prefix /opt/musicbot/ts-bot
sudo install -m 0644 /opt/musicbot/musicbot.service /etc/systemd/system/musicbot.service
sudo install -m 0640 /opt/musicbot/config/musicbot.env.example /etc/musicbot/musicbot.env
sudo systemctl daemon-reload
sudo systemctl enable --now musicbot
sudo systemctl status musicbot
```

Logs are available through:

```bash
journalctl -u musicbot -f
```

## DAVE Note

The TypeScript runtime depends on `discord.js`, `@discordjs/voice`, and `@snazzah/davey`. The codebase now passes DAVE protocol hints through the Node voice path and keeps all voice handling inside the TypeScript process. Actual non-stage voice validation still needs to be done on a Linux host with the production dependency set installed.
