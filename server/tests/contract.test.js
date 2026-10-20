/**
 * Контрактний тест «фронтенд ↔ сервер»: тіло, яке формує браузер (toPayload),
 * сервер приймає без змін — навіть для крайніх значень і дивних метаданих.
 * Обидві сторони беруть межі з shared/result-schema.js.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { toPayload } from '../../src/services/ResultsApi.js';
import { RESULT_LIMITS } from '../../shared/result-schema.js';

const result = (over = {}) => ({
  timestamp: Date.now(),
  server: { id: 'cloudflare', name: 'Cloudflare' },
  download: { mbps: 512.3456 },
  upload: { mbps: 98.123 },
  ping: { median: 12.345, jitter: 1.2, loss: 0 },
  stability: { score: 93.6, grade: 'A' },
  bufferbloat: { delta: 8.25, grade: 'A' },
  ...over,
});

describe('контракт POST /api/results', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ config: loadConfig({ RATE_RESULTS_PER_MIN: '1000' }), logger: false });
  });
  afterAll(() => app.close());

  const post = (payload) => app.inject({ method: 'POST', url: '/api/results', payload });

  it('звичайний результат приймається', async () => {
    const res = await post(toPayload(result(), { isp: 'Kyivstar', city: 'Kyiv', country: 'UA' }));
    expect(res.statusCode).toBe(201);
  });

  it('крайні значення обрізаються на клієнті, а не відхиляються сервером', async () => {
    const payload = toPayload(
      result({
        download: { mbps: 1e9 },
        upload: { mbps: -5 },
        ping: { median: Infinity, jitter: NaN, loss: 250 },
        stability: { score: 140, grade: 'F' },
        bufferbloat: undefined,
      }),
      { isp: 'x'.repeat(500), city: { name: 'obj' }, country: 'ukr' },
      { lightMode: true },
    );
    expect(payload.download).toBe(RESULT_LIMITS.download);
    expect(payload.upload).toBe(0);
    expect(payload.loss).toBe(RESULT_LIMITS.loss);
    expect(payload.score).toBe(RESULT_LIMITS.score);
    expect(payload.isp).toHaveLength(100);
    expect(payload).not.toHaveProperty('city');
    expect(payload).not.toHaveProperty('country');
    const res = await post(payload);
    expect(res.statusCode, res.body).toBe(201);
  });

  it('власний сервер як джерело вимірювань', async () => {
    const res = await post(toPayload(result({ server: { id: 'self', name: 'self' } }), null));
    expect(res.statusCode).toBe(201);
  });
});
