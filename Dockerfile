FROM node:22-bookworm-slim

ARG CODEX_VERSION=0.147.0

RUN npm install --global "@openai/codex@${CODEX_VERSION}" \
    && npm cache clean --force

WORKDIR /app

COPY package.json ./
COPY src ./src

RUN mkdir -p /app/data /root/.codex

ENV NODE_ENV=production \
    CODEX_HOME=/root/.codex

CMD ["node", "src/index.js"]
