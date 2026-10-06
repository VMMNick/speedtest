/**
 * Конфігурація зі змінних оточення (12-factor). Значення за замовчуванням — для локальної розробки.
 */
import { resolve } from 'node:path';

const int = (v, def) => (v === undefined || v === '' ? def : Number.parseInt(v, 10));
const bool = (v, def) => (v === undefined || v === '' ? def : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));

export function loadConfig(env = process.env) {
  // Render завжди задає RENDER=true. Там сервіс стоїть за проксі і на безкоштовному тарифі
  // не повинен роздавати трафік вимірювань — розумні значення за замовчуванням,
  // навіть якщо сервіс створено вручну, а не з render.yaml.
  const onRender = env.RENDER === 'true';
  return {
    host: env.HOST ?? '0.0.0.0',
    port: int(env.PORT, 8080),
    logLevel: env.LOG_LEVEL ?? 'info',
    /** postgres://user:pass@host:5432/db — без нього результати не зберігаються (лише вимірювання) */
    databaseUrl: env.DATABASE_URL || null,
    /** redis://host:6379 — без нього rate limit тримається в пам'яті процесу */
    redisUrl: env.REDIS_URL || null,
    /** Тека зі зібраним фронтендом (dist). null — сервер лише API */
    staticDir: env.STATIC_DIR ? resolve(env.STATIC_DIR) : null, // @fastify/static потребує абсолютний шлях
    /** За reverse proxy (nginx, Traefik) — щоб request.ip брався з X-Forwarded-For */
    trustProxy: bool(env.TRUST_PROXY, onRender),
    /**
     * Ендпоінти download/upload. На безкоштовних хмарних тарифах (Render, Fly) їх варто
     * вимкнути: тест ганяє сотні МБ і швидко з'їдає ліміт трафіку. Тоді міряємо через Cloudflare,
     * а сервер лише збирає статистику.
     */
    speedEndpoints: bool(env.SPEED_ENDPOINTS, !onRender),
    limits: {
      /** Максимальний розмір одного download/upload-запиту */
      maxTransferBytes: int(env.MAX_TRANSFER_BYTES, 100_000_000),
      /** Запитів на хвилину з однієї IP */
      speedPerMinute: int(env.RATE_SPEED_PER_MIN, 600),
      resultsPerMinute: int(env.RATE_RESULTS_PER_MIN, 10),
    },
  };
}
