# syntax=docker/dockerfile:1
# Повний «Спідтест»: фронтенд (збірка selfhosted) + Fastify API в одному образі.
# PostgreSQL і Redis — окремими сервісами (див. docker-compose.yml).

# ── 1. Збірка фронтенду ─────────────────────────────────────────────
FROM node:22-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
# selfhosted — власні ендпоінти вимірювань (LAN/VPS); cloud — вимірювання через Cloudflare (Render)
ARG BUILD_MODE=selfhosted
COPY vite.config.js .env.selfhosted .env.cloud ./
COPY config ./config
COPY public ./public
COPY src ./src
RUN npx vite build --mode "$BUILD_MODE"

# ── 2. Продакшн-залежності сервера ─────────────────────────────────
FROM node:22-alpine AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# ── 3. Фінальний образ ─────────────────────────────────────────────
FROM node:22-alpine
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    STATIC_DIR=/app/dist
WORKDIR /app
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server/package.json ./server/
COPY server/src ./server/src
COPY server/migrations ./server/migrations
COPY --from=web /app/dist ./dist

# Не root
USER node
# Платформи на кшталт Render задають власний PORT — сервер і healthcheck його враховують
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" > /dev/null || exit 1
CMD ["node", "server/src/index.js"]
