import { describe, it, expect, vi } from 'vitest';
import { toPayload, submitResult, requestToken } from '../../src/services/ResultsApi.js';
import { SELF_SERVER, resolveServerUrls } from '../../src/core/config.js';
import { resultSchema } from '@speedtest/shared/result-schema';

const result = {
  timestamp: 1,
  server: { id: 'cloudflare', name: 'Cloudflare' },
  download: { mbps: 512.3456 },
  upload: { mbps: 98.123 },
  ping: { median: 12.345, jitter: 1.2, loss: 0 },
  stability: { score: 93.6, grade: 'A' },
  bufferbloat: { delta: 8.25, grade: 'A' },
};

describe('toPayload — тіло для POST /api/results', () => {
  it('відповідає схемі сервера (ті самі поля, нічого зайвого)', () => {
    const body = toPayload(
      result,
      { isp: 'Kyivstar', city: 'Kyiv', country: 'UA', ip: '1.2.3.4' },
      { lightMode: true },
    );
    expect(body).toEqual({
      server: 'cloudflare',
      download: 512.35,
      upload: 98.12,
      ping: 12.35,
      jitter: 1.2,
      loss: 0,
      grade: 'A',
      score: 94,
      bufferbloat: 8.25,
      lightMode: true,
      isp: 'Kyivstar',
      city: 'Kyiv',
      country: 'UA',
    });
    const allowed = Object.keys(resultSchema.properties);
    expect(Object.keys(body).every((k) => allowed.includes(k))).toBe(true);
    expect(resultSchema.required.every((k) => k in body)).toBe(true);
  });

  it('без метаданих і з невалідною країною — поля просто не надсилаються', () => {
    const body = toPayload({ ...result, server: { id: 'self' } }, { country: 'Ukraine' });
    expect(body.server).toBe('self');
    expect(body).not.toHaveProperty('isp');
    expect(body).not.toHaveProperty('country');
  });
});

describe('submitResult', () => {
  it('POST JSON на api/results відносно сторінки, з токеном у заголовку', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 201 }));
    expect(await submitResult({ a: 1 }, 'https://host/speedtest/', 'tok', fetchImpl)).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://host/speedtest/api/results');
    expect(init.method).toBe('POST');
    expect(init.headers['x-result-token']).toBe('tok');
    expect(JSON.parse(init.body)).toEqual({ a: 1 });
  });
  it('помилка мережі чи 4xx — false, без винятку', async () => {
    expect(await submitResult({}, 'https://h/', 't', async () => new Response('', { status: 403 }))).toBe(false);
    expect(
      await submitResult({}, 'https://h/', 't', async () => {
        throw new TypeError('offline');
      }),
    ).toBe(false);
  });
});

describe('requestToken', () => {
  it('бере токен з api/results/token', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ token: 'abc' }));
    expect(await requestToken('https://host/speedtest/', fetchImpl)).toBe('abc');
    expect(fetchImpl.mock.calls[0][0]).toBe('https://host/speedtest/api/results/token');
  });
  it('сервер недоступний або відповів помилкою — null', async () => {
    expect(await requestToken('https://h/', async () => new Response('', { status: 429 }))).toBeNull();
    expect(
      await requestToken('https://h/', async () => {
        throw new TypeError('offline');
      }),
    ).toBeNull();
  });
});

describe('resolveServerUrls', () => {
  it('робить шляхи абсолютними відносно сторінки (а не воркера)', () => {
    const s = resolveServerUrls(SELF_SERVER, 'https://example.com/speedtest/index.html');
    expect(s.pingUrl).toBe('https://example.com/speedtest/api/ping');
    expect(s.downloadUrl).toBe('https://example.com/speedtest/api/download');
    expect(s.id).toBe('self');
  });
  it('абсолютні URL лишаються як є', () => {
    const cf = { pingUrl: 'https://speed.cloudflare.com/__down?bytes=0' };
    expect(resolveServerUrls(cf, 'https://example.com/').pingUrl).toBe(cf.pingUrl);
  });
});
