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

## Local Build

```bash
npm install --prefix ts-bot
npm run build --prefix ts-bot
cp config/musicbot.env.example .env
node ts-bot/dist/main.js
```

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
