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

  app.get('/api/ping', { config: { rateLimit } }, async (request, reply) => {
    const ms = reply.elapsedTime;
    reply
      .header('cache-control', NO_STORE)
      .header('server-timing', `app;dur=${ms.toFixed(2)}`)
      .code(200)
      .send('');
  });

  app.get('/api/meta', { config: { rateLimit } }, async (request, reply) => {
    reply.header('cache-control', NO_STORE);
    // Формат як у speed.cloudflare.com/meta — фронтенду байдуже, хто відповідає
    return { clientIp: request.ip, asOrganization: null, city: null, country: null, colo: 'SELF' };
  });

  // ping і meta — крихітні, лишаються завжди; download/upload — опційно (SPEED_ENDPOINTS)
  if (!transfers) return;

  app.get(
    '/api/download',
    {
      config: { rateLimit },
      schema: {
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

  app.post('/api/upload', { config: { rateLimit } }, async (request, reply) => {
    const bytes = /** @type {{ bytes?: number }} */ (request.body)?.bytes ?? 0;
    reply.header('cache-control', NO_STORE);
    return { bytes };
  });
}
