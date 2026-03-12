FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV MUSICBOT_CONFIG_PATH=/app/config/config.json

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        ffmpeg \
        python3 \
        python3-pip \
        tini \
    && python3 -m pip install --no-cache-dir --break-system-packages yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY ts-bot/package.json ts-bot/package-lock.json ./ts-bot/
RUN npm ci --prefix ts-bot --omit=dev

COPY ts-bot/src ./ts-bot/src
COPY ts-bot/scripts ./ts-bot/scripts
COPY ts-bot/tsconfig.json ./ts-bot/tsconfig.json
COPY config/config.json ./config/config.json
COPY config/musicbot.env.example ./config/musicbot.env.example
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN npm run build --prefix ts-bot \
    && mkdir -p /app/data /app/audio_cache /app/data/tmp \
    && chmod +x /app/docker-entrypoint.sh

ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker-entrypoint.sh"]
CMD ["node", "ts-bot/dist/main.js"]

