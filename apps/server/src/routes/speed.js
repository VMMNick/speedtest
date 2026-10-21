/**
 * Ендпоінти вимірювань — сумісні за форматом із speed.cloudflare.com,
 * тож фронтенд працює з обома однаково.
 *
 *   GET  /api/ping              — порожня відповідь + Server-Timing
 *   GET  /api/download?bytes=N  — N нестискуваних байтів потоком
 *   POST /api/upload            — приймає й відкидає тіло, рахує байти
 *   GET  /api/meta              — IP клієнта (формат як у Cloudflare /meta)
 */
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { TAGS, badRequest, errorSchema, rateLimited } from '../openapi.js';

/** 1 МБ випадкових даних, генерується раз — далі віддаються зрізи (без навантаження на CPU) */
const BLOCK = randomBytes(1 << 20);

/** Генератор чанків потрібного обсягу з одного блоку */
export function* chunks(total, block = BLOCK) {
  let left = total;
  while (left > 0) {
    const n = Math.min(left, block.length);
    yield n === block.length ? block : block.subarray(0, n);
    left -= n;
  }
}

const NO_STORE = 'no-store, no-cache, must-revalidate';

/** @type {import('fastify').FastifyPluginAsync<{ maxTransferBytes: number, perMinute: number, transfers?: boolean }>} */
export default async function speedRoutes(app, { maxTransferBytes, perMinute, transfers = true }) {
  const rateLimit = { max: perMinute, timeWindow: '1 minute' };

  // Тіло upload не буферизується: рахуємо байти потоком і викидаємо.
  // Парсер діє лише всередині цього плагіна (інкапсуляція Fastify).
  const discardBody = (request, payload, done) => {
    let bytes = 0;
    payload.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxTransferBytes) {
        payload.destroy();
        const err = Object.assign(new Error('Payload too large'), { statusCode: 413 });
        done(err);
      }
    });
    payload.on('end', () => done(null, { bytes }));
    payload.on('error', done);
  };
  app.addContentTypeParser(['text/plain', 'application/octet-stream'], discardBody);

  // Без download/upload вимірювати до цього сервера нема сенсу — тоді й ping/meta не віддаємо:
  // ServerSelector на фронтенді побачить сервер недоступним і обере Cloudflare.
  if (!transfers) return;

  /** Схема для OpenAPI: тег, опис і 429 від rate limit */
  const doc = (operationId, summary, description, response) => ({
    tags: [TAGS.measure],
    operationId,
    summary,
    description,
    response: { ...response, ...badRequest, ...rateLimited },
  });

  const pingSchema = doc(
    'ping',
    'Пінг',
    'Порожня відповідь. Час обробки на сервері — у заголовку `Server-Timing: app;dur=…`, клієнт віднімає його з RTT.',
    { 200: { description: 'Порожнє тіло', headers: { 'server-timing': { type: 'string' } } } },
  );
  app.get('/api/ping', { config: { rateLimit }, schema: pingSchema }, async (request, reply) => {
    const ms = reply.elapsedTime;
    reply
      .header('cache-control', NO_STORE)
      .header('server-timing', `app;dur=${ms.toFixed(2)}`)
      .code(200)
      .send('');
  });

  const metaSchema = doc(
    'getMeta',
    'Дані клієнта',
    'Формат як у speed.cloudflare.com/meta. Провайдер і місто тут не визначаються.',
    {
      200: {
        description: 'IP клієнта',
        type: 'object',
        properties: {
          clientIp: { type: 'string' },
          asOrganization: { type: ['string', 'null'] },
          city: { type: ['string', 'null'] },
          country: { type: ['string', 'null'] },
          colo: { type: 'string', description: 'Для власного сервера завжди SELF' },
        },
      },
    },
  );
  app.get('/api/meta', { config: { rateLimit }, schema: metaSchema }, async (request, reply) => {
    reply.header('cache-control', NO_STORE);
    // Формат як у speed.cloudflare.com/meta — фронтенду байдуже, хто відповідає
    return { clientIp: request.ip, asOrganization: null, city: null, country: null, colo: 'SELF' };
  });

  app.get(
    '/api/download',
    {
      config: { rateLimit },
      schema: {
        ...doc('download', 'Завантаження (download)', 'Потік нестискуваних випадкових байтів заданого обсягу.', {
          200: { description: 'Двійкові дані', content: { 'application/octet-stream': { schema: {} } } },
        }),
        querystring: {
          type: 'object',
          properties: { bytes: { type: 'integer', minimum: 0, maximum: maxTransferBytes, default: 0 } },
        },
      },
    },
    async (request, reply) => {
      const { bytes } = /** @type {{ bytes: number }} */ (request.query);
      reply
        .header('cache-control', NO_STORE)
        .header('content-type', 'application/octet-stream')
        .header('content-length', String(bytes));
      return reply.send(bytes ? Readable.from(chunks(bytes), { objectMode: false }) : '');
    },
  );

  const uploadSchema = doc(
    'upload',
    'Вивантаження (upload)',
    'Приймає тіло `text/plain` або `application/octet-stream` потоком, рахує байти й відкидає їх. ' +
      `Більше ${maxTransferBytes} байтів — 413.`,
    {
      200: { description: 'Скільки байтів отримано', type: 'object', properties: { bytes: { type: 'integer' } } },
      413: { description: 'Тіло завелике', ...errorSchema },
    },
  );
  app.post('/api/upload', { config: { rateLimit }, schema: uploadSchema }, async (request, reply) => {
    const bytes = /** @type {{ bytes?: number }} */ (request.body)?.bytes ?? 0;
    reply.header('cache-control', NO_STORE);
    return { bytes };
  });
}
