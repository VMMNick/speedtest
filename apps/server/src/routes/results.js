/**
 * Анонімна статистика результатів.
 *
 *   GET  /api/results/token  — одноразовий токен на старті тесту (див. tokens.js)
 *   POST /api/results        — зберегти результат (токен, валідація JSON Schema, rate limit)
 *   GET  /api/results/stats  — зведення за період
 */

import { bumpDataVersion } from '../cache.js';
import { resultSchema, RESULT_TOKEN_HEADER } from '@speedtest/shared/result-schema';
import { TAGS, badRequest, errorSchema, rateLimited } from '../openapi.js';

// Схема спільна з фронтендом — див. packages/shared/result-schema.js
export { resultSchema };

/**
 * @type {import('fastify').FastifyPluginAsync<{
 *   repo: any, perMinute: number, tokensPerMinute: number,
 *   tokens: ReturnType<import('../tokens.js').createTokenService>, redis?: import('ioredis').Redis
 * }>}
 */
export default async function resultsRoutes(app, { repo, perMinute, tokensPerMinute, tokens, redis }) {
  app.get(
    '/api/results/token',
    {
      config: { rateLimit: { max: tokensPerMinute, timeWindow: '1 minute' } },
      schema: {
        tags: [TAGS.results],
        operationId: 'getResultToken',
        summary: 'Одноразовий токен для результату',
        description:
          'Браузер бере токен на старті тесту й надсилає його з результатом у заголовку `' +
          RESULT_TOKEN_HEADER +
          '`. Підпис HMAC-SHA256; повторне використання блокується через Redis.',
        response: {
          200: {
            description: 'Токен і вікно його дії',
            type: 'object',
            required: ['token', 'minAgeMs', 'maxAgeMs'],
            properties: {
              token: { type: 'string' },
              minAgeMs: { type: 'integer', description: 'Раніше цього віку токен не приймається' },
              maxAgeMs: { type: 'integer', description: 'Після цього віку токен прострочений' },
            },
          },
          ...rateLimited,
        },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      return { token: tokens.issue(), minAgeMs: tokens.minAgeMs, maxAgeMs: tokens.maxAgeMs };
    },
  );

  app.post(
    '/api/results',
    {
      config: { rateLimit: { max: perMinute, timeWindow: '1 minute' } },
      schema: {
        tags: [TAGS.results],
        operationId: 'createResult',
        summary: 'Зберегти анонімний результат',
        description:
          'Тіло валідується спільною JSON Schema з `packages/shared` (зайві поля, напр. IP, — 400). ' +
          'Потрібен одноразовий токен.',
        security: [{ resultToken: [] }],
        body: resultSchema,
        response: {
          201: {
            description: 'Збережено',
            type: 'object',
            properties: { id: { type: 'integer' }, createdAt: { type: 'string', format: 'date-time' } },
          },
          400: { description: 'Тіло не відповідає схемі', ...errorSchema },
          403: {
            description: 'Токена немає, він підроблений, ще «молодий», прострочений або вже використаний',
            ...errorSchema,
          },
          ...rateLimited,
        },
      },
    },
    async (request, reply) => {
      const check = await tokens.consume(request.headers[RESULT_TOKEN_HEADER]);
      if (!check.ok) return reply.code(403).send({ error: 'invalid result token', reason: check.reason });
      const saved = await repo.insert(request.body);
      await bumpDataVersion(redis); // аналітика має одразу побачити новий результат
      return reply.code(201).send(saved);
    },
  );

  app.get(
    '/api/results/stats',
    {
      schema: {
        tags: [TAGS.results],
        operationId: 'getResultStats',
        summary: 'Зведення за період',
        querystring: {
          type: 'object',
          properties: { days: { type: 'integer', minimum: 1, maximum: 365, default: 30 } },
        },
        response: {
          200: {
            description: 'Кількість тестів, середні швидкості й медіанний пінг',
            type: 'object',
            properties: {
              count: { type: 'integer' },
              avgDownload: { type: 'number', description: 'Мбіт/с' },
              avgUpload: { type: 'number', description: 'Мбіт/с' },
              medianPing: { type: 'number', description: 'мс' },
            },
          },
          ...badRequest,
        },
      },
    },
    async (request) => repo.stats(/** @type {{ days: number }} */ (request.query).days),
  );
}
