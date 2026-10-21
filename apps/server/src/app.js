/**
 * Фабрика Fastify-застосунку. Не слухає порт і не створює з'єднань сам —
 * усе (репозиторій, Redis) передається ззовні, тож тести працюють через app.inject().
 */
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import speedRoutes from './routes/speed.js';
import resultsRoutes from './routes/results.js';
import analyticsRoutes from './routes/analytics.js';
import { randomBytes } from 'node:crypto';
import { memoryRepository } from './db.js';
import { createTokenService } from './tokens.js';
import { registerDocs, TAGS } from './openapi.js';

/**
 * @param {object} opts
 * @param {ReturnType<import('./config.js').loadConfig>} opts.config
 * @param {ReturnType<import('./db.js').memoryRepository>} [opts.repo] без нього — в пам'яті
 * @param {import('ioredis').Redis} [opts.redis] без нього rate limit у пам'яті процесу
 * @param {object | boolean} [opts.logger]
 */
export async function buildApp({ config, repo = memoryRepository(), redis = undefined, logger = true }) {
  const app = Fastify({
    logger,
    trustProxy: config.trustProxy,
    // Для JSON-запитів (результати) — маленький ліміт; upload має власний потоковий парсер
    bodyLimit: 16 * 1024,
    // За замовчуванням Fastify мовчки ВИДАЛЯЄ зайві поля; нам потрібна явна відмова (400),
    // щоб клієнт не міг непомітно надіслати, напр., IP-адресу
    ajv: { customOptions: { removeAdditional: false } },
  });

  // Безпечні заголовки. CSP уже є в <meta> продакшн-збірки (див. config/vite-plugin-csp.js)
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    hsts: false, // TLS термінує reverse proxy — він і ставить HSTS
  });

  await app.register(rateLimit, {
    global: false, // ліміти задаються на кожен маршрут окремо
    redis, // спільний лічильник для кількох інстансів сервера
    nameSpace: 'speedtest-rl:',
    skipOnError: true, // недоступний Redis не повинен ламати вимірювання
  });

  // OpenAPI збирає маршрути через onRoute — тому реєструється раніше за них
  await registerDocs(app);

  await app.register(speedRoutes, {
    maxTransferBytes: config.limits.maxTransferBytes,
    perMinute: config.limits.speedPerMinute,
    transfers: config.speedEndpoints,
  });
  const { secret, minAgeMs, maxAgeMs, perMinute: tokensPerMinute } = config.resultTokens;
  const tokens = createTokenService({
    secret: secret ?? randomBytes(32).toString('hex'),
    minAgeMs,
    maxAgeMs,
    redis,
  });
  await app.register(resultsRoutes, {
    repo,
    redis,
    tokens,
    perMinute: config.limits.resultsPerMinute,
    tokensPerMinute,
  });
  await app.register(analyticsRoutes, { repo, redis });

  const component = { type: 'string', enum: ['ok', 'error', 'disabled'] };
  const healthSchema = {
    type: 'object',
    properties: { status: { type: 'string', enum: ['ok', 'degraded'] }, db: component, redis: component },
  };
  const healthRoute = {
    schema: {
      tags: [TAGS.service],
      operationId: 'getHealth',
      summary: 'Стан сервера, бази й Redis',
      description: 'Використовується healthcheck-ом Docker і Render. Redis `disabled`, якщо REDIS_URL не задано.',
      response: {
        200: { description: 'Усе працює', ...healthSchema },
        503: { description: 'База або Redis недоступні', ...healthSchema },
      },
    },
  };
  app.get('/api/health', healthRoute, async (request, reply) => {
    const check = async (fn) => {
      try {
        await fn();
        return 'ok';
      } catch {
        return 'error';
      }
    };
    const status = {
      db: await check(() => repo.ping()),
      redis: redis ? await check(() => redis.ping()) : 'disabled',
    };
    const healthy = status.db === 'ok' && status.redis !== 'error';
    return reply.code(healthy ? 200 : 503).send({ status: healthy ? 'ok' : 'degraded', ...status });
  });

  if (config.staticDir) {
    await app.register(fastifyStatic, {
      root: config.staticDir,
      // Файли з хешем в імені кешуються назавжди; HTML і service worker — ніколи
      // (у @fastify/static v10 перший аргумент — Fastify reply)
      setHeaders(reply, filePath) {
        const immutable = /[\\/]assets[\\/].+-[\w-]{8}\.\w+$/.test(filePath);
        reply.header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  return app;
}
