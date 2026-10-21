# syntax=docker/dockerfile:1
# Повний «Спідтест»: фронтенд (apps/web) + Fastify API (apps/server) в одному образі.
# PostgreSQL і Redis — окремими сервісами (див. docker-compose.yml).
# Монорепозиторій на npm workspaces: один package-lock.json у корені.

# ── 1. Збірка фронтенду ─────────────────────────────────────────────
FROM node:22-alpine AS web
WORKDIR /app
# Маніфести всіх воркспейсів — npm ci потребує їх, щоб звірити lockfile
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN npm ci -w @speedtest/web --ignore-scripts --no-audit --no-fund
# selfhosted — власні ендпоінти вимірювань (LAN/VPS); cloud — вимірювання через Cloudflare (Render)
# Без явного BUILD_MODE: cloud, якщо в збірку прийшов RENDER=true, інакше selfhosted.
# Render передає змінні сервісу як build args, тож надійніше задати там BUILD_MODE=cloud явно.
ARG BUILD_MODE=
ARG RENDER=
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN mode="${BUILD_MODE:-$([ "$RENDER" = true ] && echo cloud || echo selfhosted)}" \
 && echo "vite build --mode $mode" && npm run build -w @speedtest/web -- --mode "$mode"

# ── 2. Продакшн-залежності сервера ─────────────────────────────────
FROM node:22-alpine AS server-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
# Лише залежності сервера (і @speedtest/shared як посилання на packages/shared), без dev-інструментів
RUN npm ci -w @speedtest/server --omit=dev --ignore-scripts --no-audit --no-fund

# ── 3. Фінальний образ ─────────────────────────────────────────────
FROM node:22-alpine
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    STATIC_DIR=/app/apps/web/dist
WORKDIR /app
COPY --from=server-deps /app/node_modules ./node_modules
COPY packages/shared packages/shared
COPY apps/server/package.json apps/server/
COPY apps/server/src apps/server/src
COPY apps/server/migrations apps/server/migrations
COPY --from=web /app/apps/web/dist apps/web/dist

# Не root
USER node
# Платформи на кшталт Render задають власний PORT — сервер і healthcheck його враховують
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" > /dev/null || exit 1
CMD ["node", "apps/server/src/index.js"]
