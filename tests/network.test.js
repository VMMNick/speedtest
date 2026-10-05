import { describe, it, expect, vi } from 'vitest';
import { NetworkEngine, makePayload, fetchUpload } from '../src/core/NetworkEngine.js';
import { ServerSelector } from '../src/services/ServerSelector.js';

const server = {
  id: 'mock',
  name: 'Mock',
  pingUrl: 'https://mock.test/ping',
  downloadUrl: 'https://mock.test/down',
  uploadUrl: 'https://mock.test/up',
  metaUrl: 'https://mock.test/meta',
};

/** Швидкі налаштування, щоб тести тривали частки секунди. */
const fastConfig = {
  ping: { count: 5, timeoutMs: 200, intervalMs: 0, warmup: 0 },
  download: { durationMs: 300, streams: 2, initialBytes: 10_000, maxBytes: 200_000, targetRequestMs: 50, abortAtDeadline: true },
  upload: { durationMs: 300, streams: 2, initialBytes: 10_000, maxBytes: 200_000, targetRequestMs: 50, abortAtDeadline: false, graceMs: 200 },
  loadedLatency: { intervalMs: 30, timeoutMs: 200 },
  sampleIntervalMs: 20,
  warmupMs: 50,
  liveWindowMs: 100,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Мок fetch: пінг відповідає миттєво, download стрімить байти чанками. */
function mockFetch({ failPings = 0, downloadDelay = 2 } = {}) {
  let pings = 0;
  return vi.fn(async (url, { signal } = {}) => {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (url.startsWith(server.pingUrl)) {
      if (pings++ < failPings) throw new TypeError('network');
      await sleep(1);
      return new Response('');
    }
    if (url.startsWith(server.downloadUrl)) {
      const total = Number(new URL(url).searchParams.get('bytes'));
      let sent = 0;
      const body = new ReadableStream({
        async pull(ctrl) {
          if (signal?.aborted) return ctrl.error(new DOMException('aborted', 'AbortError'));
          await sleep(downloadDelay);
          const n = Math.min(16_384, total - sent);
          if (n <= 0) return ctrl.close();
          sent += n;
          ctrl.enqueue(new Uint8Array(n));
        },
      });
      return new Response(body);
    }
    if (url.startsWith(server.uploadUrl)) {
      await sleep(5);
      return new Response('ok');
    }
    if (url.startsWith(server.metaUrl)) {
      return Response.json({ clientIp: '1.2.3.4', asOrganization: 'Test ISP', city: 'Kyiv', colo: 'KBP', country: 'UA' });
    }
    throw new Error('unexpected url ' + url);
  });
}

describe('NetworkEngine', () => {
  it('потребує server', () => {
    expect(() => new NetworkEngine({})).toThrow();
  });

  it('measurePing рахує медіану, джиттер і втрати', async () => {
    const engine = new NetworkEngine({ server, config: fastConfig, fetchImpl: mockFetch({ failPings: 1 }) });
    const ping = await engine.measurePing();
    expect(ping.samples).toHaveLength(4);
    expect(ping.loss).toBe(20);
    expect(ping.median).toBeGreaterThan(0);
    expect(ping.jitter).toBeGreaterThanOrEqual(0);
  });

  it('measurePing кидає помилку, якщо сервер недоступний', async () => {
    const engine = new NetworkEngine({ server, config: fastConfig, fetchImpl: mockFetch({ failPings: 999 }) });
    await expect(engine.measurePing()).rejects.toThrow(/недоступний/);
  });

  it('measureDownload вимірює швидкість і шле прогрес', async () => {
    const events = [];
    const engine = new NetworkEngine({ server, config: fastConfig, fetchImpl: mockFetch(), onEvent: (e) => events.push(e) });
    const dl = await engine.measureDownload();
    expect(dl.bytes).toBeGreaterThan(0);
    expect(dl.mbps).toBeGreaterThan(0);
    expect(dl.series.length).toBeGreaterThan(0);
    expect(dl.loadedLatency.median).toBeGreaterThan(0);
    const progress = events.filter((e) => e.type === 'progress' && e.phase === 'download');
    expect(progress.length).toBeGreaterThan(3);
    expect(progress.at(-1).progress).toBeLessThanOrEqual(1);
  });

  it('адаптивно збільшує розмір чанка', async () => {
    const fetchImpl = mockFetch({ downloadDelay: 0 });
    const engine = new NetworkEngine({ server, config: fastConfig, fetchImpl });
    await engine.measureDownload();
    const sizes = fetchImpl.mock.calls
      .map(([u]) => u)
      .filter((u) => u.startsWith(server.downloadUrl))
      .map((u) => Number(new URL(u).searchParams.get('bytes')));
    expect(Math.max(...sizes)).toBeGreaterThan(fastConfig.download.initialBytes);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(fastConfig.download.maxBytes);
  });

  it('measureDownload кидає зрозумілу помилку, якщо жоден чанк не завантажився', async () => {
    const base = mockFetch();
    const fetchImpl = async (url, init) => {
      if (url.startsWith(server.downloadUrl)) return new Response('rate limited', { status: 429 });
      return base(url, init);
    };
    const engine = new NetworkEngine({ server, config: fastConfig, fetchImpl });
    await expect(engine.measureDownload()).rejects.toThrow(/HTTP 429/);
  });

  it('measureUpload використовує uploadImpl і рахує байти', async () => {
    const uploadImpl = vi.fn(async (url, body, onBytes) => {
      await sleep(5);
      onBytes(body.size);
    });
    const engine = new NetworkEngine({ server, config: fastConfig, fetchImpl: mockFetch(), uploadImpl });
    const ul = await engine.measureUpload();
    expect(uploadImpl).toHaveBeenCalled();
    expect(uploadImpl.mock.calls[0][0]).toBe(server.uploadUrl);
    expect(ul.bytes).toBeGreaterThan(0);
    expect(ul.mbps).toBeGreaterThan(0);
  });

  it('run() повертає повний результат з оцінками', async () => {
    const phases = [];
    const engine = new NetworkEngine({
      server,
      config: fastConfig,
      fetchImpl: mockFetch(),
      onEvent: (e) => e.type === 'phase' && phases.push(e.phase),
    });
    const r = await engine.run();
    expect(phases).toEqual(['ping', 'download', 'upload']);
    expect(r.server.id).toBe('mock');
    expect(r.download.mbps).toBeGreaterThan(0);
    expect(r.upload.mbps).toBeGreaterThan(0);
    expect(r.stability.score).toBeGreaterThanOrEqual(0);
    expect(r.stability.score).toBeLessThanOrEqual(100);
    expect(['A', 'B', 'C', 'D', 'F']).toContain(r.stability.grade);
    expect(r.useCases).toHaveProperty('gaming');
  });

  it('abort() зупиняє тест з AbortError', async () => {
    const engine = new NetworkEngine({
      server,
      config: { ...fastConfig, download: { ...fastConfig.download, durationMs: 5000 } },
      fetchImpl: mockFetch(),
    });
    const p = engine.run();
    setTimeout(() => engine.abort(), 150);
    const t0 = Date.now();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('Upload helpers', () => {
  it('makePayload створює Blob потрібного розміру', () => {
    expect(makePayload(2_500_000).size).toBe(2_500_000);
    expect(makePayload(1000).size).toBe(1000);
  });

  it('fetchUpload шле text/plain (без CORS preflight) і повідомляє байти', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok'));
    const onBytes = vi.fn();
    const body = makePayload(5000);
    await fetchUpload(fetchImpl, server.uploadUrl, body, onBytes);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toMatch(/^text\/plain/);
    expect(onBytes).toHaveBeenCalledWith(5000);
  });

  it('fetchUpload кидає помилку на HTTP-помилку', async () => {
    const fetchImpl = async () => new Response('no', { status: 500 });
    await expect(fetchUpload(fetchImpl, 'x', makePayload(10), () => {})).rejects.toThrow('HTTP 500');
  });
});

describe('ServerSelector', () => {
  it('обирає сервер з найменшою затримкою', async () => {
    const slow = { ...server, id: 'slow', pingUrl: 'https://slow.test/ping' };
    const fetchImpl = async (url) => {
      await sleep(url.startsWith('https://slow') ? 40 : 2);
      return new Response('');
    };
    const sel = new ServerSelector({ servers: [slow, server], fetchImpl });
    const best = await sel.selectBest();
    expect(best.server.id).toBe('mock');
    expect(best.reachable).toBe(true);
  });

  it('позначає недоступність, якщо всі сервери мовчать', async () => {
    const sel = new ServerSelector({ servers: [server], fetchImpl: async () => { throw new TypeError('offline'); } });
    const best = await sel.selectBest();
    expect(best.reachable).toBe(false);
  });

  it('fetchMeta нормалізує метадані', async () => {
    const sel = new ServerSelector({ servers: [server], fetchImpl: mockFetch() });
    expect(await sel.fetchMeta(server)).toMatchObject({ ip: '1.2.3.4', isp: 'Test ISP', city: 'Kyiv', colo: 'KBP' });
  });
});
