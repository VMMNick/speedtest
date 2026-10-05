/**
 * Анонімна статистика результатів.
 *
 *   POST /api/results        — зберегти результат (валідація JSON Schema, rate limit)
 *   GET  /api/results/stats  — зведення за період
 */

const num = (max) => ({ type: 'number', minimum: 0, maximum: max });
const text = (max) => ({ type: 'string', maxLength: max });

export const resultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['server', 'download', 'upload', 'ping', 'jitter', 'loss', 'grade', 'score'],
  properties: {
    server: { type: 'string', enum: ['self', 'cloudflare'] },
    download: num(100_000),
    upload: num(100_000),
    ping: num(60_000),
    jitter: num(60_000),
    loss: num(100),
    grade: { type: 'string', enum: ['A', 'B', 'C', 'D', 'F'] },
    score: num(100),
    bufferbloat: num(60_000),
    isp: text(100),
    city: text(100),
    country: { type: 'string', pattern: '^[A-Z]{2}$' },
    lightMode: { type: 'boolean' },
  },
};

/** @type {import('fastify').FastifyPluginAsync<{ repo: any, perMinute: number }>} */
export default async function resultsRoutes(app, { repo, perMinute }) {
  app.post(
    '/api/results',
    {
      config: { rateLimit: { max: perMinute, timeWindow: '1 minute' } },
      schema: {
        body: resultSchema,
        response: {
          201: {
            type: 'object',
            properties: { id: { type: 'integer' }, createdAt: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const saved = await repo.insert(request.body);
      return reply.code(201).send(saved);
    },
  );

  app.get(
    '/api/results/stats',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { days: { type: 'integer', minimum: 1, maximum: 365, default: 30 } },
        },
      },
    },
    async (request) => repo.stats(/** @type {{ days: number }} */ (request.query).days),
  );
}
