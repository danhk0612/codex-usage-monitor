FROM node:22-bookworm-slim

ARG CODEX_VERSION=0.147.0

LABEL org.opencontainers.image.source="https://github.com/danhk0612/codex-usage-monitor" \
      org.opencontainers.image.description="Monitor ChatGPT Codex usage limits and notify via Telegram" \
      org.opencontainers.image.licenses="MIT"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --global "@openai/codex@${CODEX_VERSION}" \
    && npm cache clean --force

WORKDIR /app

COPY package.json ./
COPY src ./src

RUN mkdir -p /app/data /root/.codex

ENV NODE_ENV=production \
    CODEX_HOME=/root/.codex

CMD ["node", "src/index.js"]
