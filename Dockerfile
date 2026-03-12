FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV MUSICBOT_CONFIG_PATH=/app/config/config.json
ENV PYTHON=/usr/bin/python3

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        ffmpeg \
        libopus-dev \
        pkg-config \
        python3 \
        python3-pip \
        tini \
    && python3 -m pip install --no-cache-dir --break-system-packages yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/ts-bot

COPY ts-bot/package.json ts-bot/package-lock.json ./
RUN npm ci --omit=dev

COPY ts-bot/src ./src
COPY ts-bot/scripts ./scripts
COPY ts-bot/tsconfig.json ./tsconfig.json

WORKDIR /app

COPY config/config.json ./config/config.json
COPY config/musicbot.env.example ./config/musicbot.env.example
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN npm run build --prefix ts-bot \
    && mkdir -p /app/data /app/audio_cache /app/data/tmp \
    && chmod +x /app/docker-entrypoint.sh

ENTRYPOINT ["/usr/bin/tini", "-s", "--", "/app/docker-entrypoint.sh"]
CMD ["node", "ts-bot/dist/main.js"]
