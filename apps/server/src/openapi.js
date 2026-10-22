/**
 * OpenAPI 3.1 опис API: генерується з тих самих JSON Schema, якими Fastify валідує запити,
 * тож документація не може розійтися з кодом.
 *
 *   GET /api/docs       — Swagger UI
 *   GET /api/docs/json  — специфікація (її ж знімок лежить у docs/openapi.json)
 */
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { readFileSync } from 'node:fs';
import { RESULT_TOKEN_HEADER } from '@speedtest/shared/result-schema';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const TAGS = /** @type {const} */ ({
  measure: 'measurement',
  results: 'results',
  analytics: 'analytics',
  status: 'status',
  service: 'service',
});

/** Тіло помилки — і для власних відповідей (403/400), і для стандартних помилок Fastify (400/429) */
export const errorSchema = {
  type: 'object',
  properties: {
    statusCode: { type: 'integer' },
    code: { type: 'string' },
    error: { type: 'string' },
    message: { type: 'string' },
    reason: { type: 'string', description: 'Причина відмови токена (лише для 403)' },
  },
};

/** Стандартна відповідь Fastify на невалідні query/body */
export const badRequest = { 400: { description: 'Параметри не відповідають схемі', ...errorSchema } };

export const rateLimited = { 429: { description: 'Перевищено ліміт запитів (rate limit)', ...errorSchema } };

/** Специфікація як об'єкт (для генерації docs/openapi.json і тестів) */
export const openapiInfo = {
  openapi: '3.1.0',
  info: {
    title: 'Спідтест API',
    version,
    description:
      'API бекенда «Спідтесту»: ендпоінти вимірювань (сумісні зі speed.cloudflare.com), ' +
      'анонімні результати й агрегована аналітика. Групи з менш ніж 3 тестів не показуються (k-анонімність).',
    license: { name: 'MIT', identifier: 'MIT' },
  },
  servers: [{ url: '/', description: 'Цей сервер' }],
  // Публічне API; токен потрібен лише POST /api/results (security на рівні операції)
  security: [],
  tags: [
    { name: TAGS.measure, description: 'Вимірювання до власного сервера (режим selfhosted)' },
    { name: TAGS.results, description: 'Анонімні результати тестів' },
    { name: TAGS.analytics, description: 'Агрегована аналітика (кеш у Redis на 60 с, заголовок X-Cache)' },
    { name: TAGS.status, description: 'Стан провайдерів «зараз проти звичайного» й інциденти (фонова задача BullMQ)' },
    { name: TAGS.service, description: 'Службові ендпоінти' },
  ],
  components: {
    securitySchemes: {
      resultToken: {
        type: 'apiKey',
        in: 'header',
        name: RESULT_TOKEN_HEADER,
        description:
          'Одноразовий токен з GET /api/results/token. Діє не раніше ніж через 5 с і не пізніше ніж через 15 хв після видачі.',
      },
    },
  },
};

/**
 * Реєструє генератор специфікації (до маршрутів — він збирає їх через onRoute) і Swagger UI.
 * @param {import('fastify').FastifyInstance} app
 */
export async function registerDocs(app) {
  await app.register(swagger, { openapi: openapiInfo });
  await app.register(swaggerUi, {
    routePrefix: '/api/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true, defaultModelsExpandDepth: 0 },
    staticCSP: false,
  });
}
