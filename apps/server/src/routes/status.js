/**
 * Стан провайдерів (знімок, який зберігає фонова задача provider-status, див. jobs.js).
 *
 *   GET /api/status/providers           — поточний стан кожного провайдера
 *   GET /api/status/incidents?days=30   — періоди, коли провайдер був помітно повільнішим за звичайне
 *
 * Приватність: як і в аналітиці, провайдери з менш ніж MIN_SAMPLES тестів не показуються.
 */
import { MIN_SAMPLES } from './analytics.js';
import { DEFAULT_RULES, evaluate } from '../status.js';
import { TAGS, badRequest } from '../openapi.js';

const mbps = { type: ['number', 'null'], description: 'Мбіт/с' };
const ms = { type: ['number', 'null'], description: 'мс' };
const time = { type: 'string', format: 'date-time' };
const reasons = {
  type: 'array',
  items: { type: 'string', enum: ['download', 'ping'] },
  description: 'Що саме погіршилось',
};

/** @type {import('fastify').FastifyPluginAsync<{ repo: any }>} */
export default async function statusRoutes(app, { repo }) {
  app.get(
    '/api/status/providers',
    {
      schema: {
        tags: [TAGS.status],
        operationId: 'getProviderStatus',
        summary: 'Стан провайдерів зараз',
        description:
          `Медіани за останні ${DEFAULT_RULES.recentHours} год порівнюються з попередніми ` +
          `${DEFAULT_RULES.baselineDays} днями. \`degraded\` — download упав нижче ` +
          `${DEFAULT_RULES.downloadDrop * 100}% звичайного або пінг зріс більш ніж у ${DEFAULT_RULES.pingRise} рази; ` +
          '`unknown` — замало свіжих тестів. Оновлюється фоновою задачею BullMQ.',
        response: {
          200: {
            description: 'Знімок останньої перевірки',
            type: 'object',
            properties: {
              checkedAt: { type: ['string', 'null'], format: 'date-time' },
              recentHours: { type: 'integer' },
              baselineDays: { type: 'integer' },
              providers: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    isp: { type: 'string' },
                    status: { type: 'string', enum: ['ok', 'degraded', 'unknown'] },
                    since: { ...time, description: 'Відколи триває цей стан' },
                    reasons,
                    recentDownload: mbps,
                    baselineDownload: mbps,
                    recentPing: ms,
                    baselinePing: ms,
                    recentSamples: { type: 'integer' },
                    baselineSamples: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const rows = (await repo.providerStatus())
        .filter((p) => p.recentSamples + p.baselineSamples >= MIN_SAMPLES)
        // Причини деградації — з тих самих правил, що й у фоновій задачі
        .map((p) => ({ ...p, reasons: p.status === 'degraded' ? evaluate(p).reasons : [] }));
      // Спершу проблемні, потім за кількістю свіжих тестів
      const order = { degraded: 0, ok: 1, unknown: 2 };
      rows.sort((a, b) => order[a.status] - order[b.status] || b.recentSamples - a.recentSamples);
      reply.header('cache-control', 'public, max-age=60');
      return {
        checkedAt: rows.reduce((max, p) => (!max || p.checkedAt > max ? p.checkedAt : max), null),
        recentHours: DEFAULT_RULES.recentHours,
        baselineDays: DEFAULT_RULES.baselineDays,
        providers: rows,
      };
    },
  );

  app.get(
    '/api/status/incidents',
    {
      schema: {
        tags: [TAGS.status],
        operationId: 'getIncidents',
        summary: 'Інциденти провайдерів',
        description: 'Інциденти, що почалися за останні N днів, і ті, що тривають. Щонайбільше 50.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { days: { type: 'integer', minimum: 1, maximum: 90, default: 30, description: 'Період, днів' } },
        },
        response: {
          200: {
            description: 'Від найновішого',
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                isp: { type: 'string' },
                startedAt: time,
                endedAt: { type: ['string', 'null'], format: 'date-time', description: 'null — триває' },
                reasons,
                recentDownload: mbps,
                baselineDownload: mbps,
                recentPing: ms,
                baselinePing: ms,
              },
            },
          },
          ...badRequest,
        },
      },
    },
    async (request, reply) => {
      const { days } = /** @type {{ days: number }} */ (request.query);
      reply.header('cache-control', 'public, max-age=60');
      return repo.incidents({ days });
    },
  );
}
