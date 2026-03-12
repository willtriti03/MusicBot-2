# MusicBot

[![GitHub stars](https://img.shields.io/github/stars/Just-Some-Bots/MusicBot.svg)](https://github.com/Just-Some-Bots/MusicBot/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/Just-Some-Bots/MusicBot.svg)](https://github.com/Just-Some-Bots/MusicBot/network)
[![Python version](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://python.org)
[![Discord](https://discordapp.com/api/guilds/129489631539494912/widget.png?style=shield)](https://discord.gg/bots)
[![Code style: black](https://img.shields.io/badge/code%20style-black-000000.svg)](https://github.com/psf/black)

MusicBot is a Discord music bot written for [Python](https://www.python.org "Python homepage") 3.10-3.13. Main bot logic still runs in Python, but regular Discord voice playback now uses an embedded Node.js DAVE sidecar so it can join modern non-stage voice channels after Discord's 2026 DAVE enforcement. It plays requested songs from YouTube and other services into a Discord server (or multiple servers). If the queue is empty, MusicBot will play a list of existing songs that is configurable.

![Main](https://i.imgur.com/FWcHtcS.png)

## Setup
Install dependencies into your current Python environment, build the embedded voice sidecar, and run the bot directly from the repo.

```bash
python3.13 -m pip install -r requirements.lock
npm install --prefix voice-sidecar
npm run build --prefix voice-sidecar
cp config/1_options.ini config/options.ini
python3.13 run.py
```

The main configuration file is `config/options.ini`. If it does not exist yet, copy [`config/1_options.ini`](./config/1_options.ini) to `config/options.ini`.

## Voice Runtime Note
Discord enforced DAVE on regular voice channels on 2026-03-01. `VoiceTransport = dave-sidecar` is now the default, and requires a local Node.js runtime plus the `voice-sidecar/` npm dependencies.

The sidecar migration currently restores:

- `play`
- `pause`
- `resume`
- `skip`
- `stop`
- `volume`
- queue persistence / recovery

The first DAVE sidecar pass intentionally blocks:

- `listen`
- `stoplisten`
- `seek`
- `speed`

### Commands

There are many commands that can be used with the bot. Most notably, the `play <url>` command (preceded by your command prefix), which will download, process, and play a song from YouTube or a similar site. A full list of commands is available [here](https://just-some-bots.github.io/MusicBot/using/commands/ "Commands").

### Further reading

* [Support Discord server](https://discord.gg/bots)
* [Project license](LICENSE)
