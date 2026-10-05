import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { memoryRepository } from '../src/db.js';
import { chunks } from '../src/routes/speed.js';

const config = loadConfig({ MAX_TRANSFER_BYTES: '5000000', RATE_RESULTS_PER_MIN: '1000' });
/** Окремо — маленький ліміт, щоб перевірити 429 */
const strictConfig = loadConfig({ RATE_RESULTS_PER_MIN: '3' });

const validResult = {
  server: 'self',
  download: 512.3,
  upload: 98.1,
  ping: 12.4,
  jitter: 1.2,
  loss: 0,
  grade: 'A',
  score: 94,
  bufferbloat: 8,
  isp: 'Test ISP',
  city: 'Kyiv',
  country: 'UA',
  lightMode: false,
};

describe('вимірювання', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ config, logger: false });
  });
  afterAll(() => app.close());

  it('GET /api/ping — порожня відповідь, без кешу, з Server-Timing', async () => {
    const res = await app.inject('/api/ping');
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['server-timing']).toMatch(/^app;dur=\d+(\.\d+)?$/);
  });

  it('GET /api/download?bytes=N — рівно N байтів', async () => {
    const res = await app.inject('/api/download?bytes=2500000');
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.length).toBe(2_500_000);
    expect(res.headers['content-length']).toBe('2500000');
    expect(res.headers['content-type']).toBe('application/octet-stream');
  });

  it('download: дані нестискувані (випадкові), 0 байтів теж ок', async () => {
    const res = await app.inject('/api/download?bytes=4096');
    const distinct = new Set(res.rawPayload).size;
    expect(distinct).toBeGreaterThan(200);
    expect((await app.inject('/api/download?bytes=0')).rawPayload.length).toBe(0);
  });

  it('download: ліміт розміру та валідація', async () => {
    expect((await app.inject('/api/download?bytes=999999999')).statusCode).toBe(400);
    expect((await app.inject('/api/download?bytes=-1')).statusCode).toBe(400);
    expect((await app.inject('/api/download?bytes=abc')).statusCode).toBe(400);
  });

  it('POST /api/upload — рахує байти text/plain (як шле фронтенд) і octet-stream', async () => {
    for (const type of ['text/plain;charset=UTF-8', 'application/octet-stream']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/upload',
        headers: { 'content-type': type },
        payload: Buffer.alloc(1_234_567, 7),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ bytes: 1_234_567 });
    }
  });

  it('upload понад ліміт → 413', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.alloc(6_000_000),
    });
    expect(res.statusCode).toBe(413);
  });

  it('GET /api/meta — формат як у Cloudflare', async () => {
    const res = await app.inject({ url: '/api/meta', remoteAddress: '198.51.100.7' });
    expect(res.json()).toEqual({
      clientIp: '198.51.100.7',
      asOrganization: null,
      city: null,
      country: null,
      colo: 'SELF',
    });
  });

  it('безпечні заголовки (helmet), без CSP-заголовка (CSP у <meta>)', async () => {
    const res = await app.inject('/api/ping');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('chunks() видає рівно стільки байтів, скільки просили', () => {
    const block = Buffer.alloc(10, 1);
    const sizes = [...chunks(25, block)].map((c) => c.length);
    expect(sizes).toEqual([10, 10, 5]);
    expect([...chunks(0, block)]).toEqual([]);
  });
});

describe('результати', () => {
  let app;
  let repo;
  beforeAll(async () => {
    repo = memoryRepository();
    app = await buildApp({ config, repo, logger: false });
  });
  afterAll(() => app.close());

  it('POST /api/results — зберігає валідний результат', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/results', payload: validResult });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: 1 });
    expect(repo.rows[0]).toMatchObject({ download: 512.3, grade: 'A', isp: 'Test ISP' });
  });

  it.each([
    ['зайве поле (напр. IP)', { ...validResult, ip: '1.2.3.4' }],
    ['від’ємна швидкість', { ...validResult, download: -1 }],
    ['неіснуюча оцінка', { ...validResult, grade: 'Z' }],
    ['втрати > 100%', { ...validResult, loss: 150 }],
    ['невідомий сервер', { ...validResult, server: 'evil' }],
    ['країна не ISO-2', { ...validResult, country: 'Ukraine' }],
    ['задовгий провайдер', { ...validResult, isp: 'x'.repeat(101) }],
    ['бракує поля', (({ ping: _p, ...rest }) => rest)(validResult)],
  ])('відхиляє: %s', async (_name, payload) => {
    const res = await app.inject({ method: 'POST', url: '/api/results', payload });
    expect(res.statusCode).toBe(400);
  });

  it('rate limit на збереження результатів', async () => {
    const fresh = await buildApp({ config: strictConfig, logger: false });
    const send = () =>
      fresh.inject({ method: 'POST', url: '/api/results', payload: validResult, remoteAddress: '203.0.113.9' });
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await send()).statusCode);
    expect(codes).toEqual([201, 201, 201, 429, 429]);
    // Інша IP — свій ліміт
    const other = await fresh.inject({
      method: 'POST',
      url: '/api/results',
      payload: validResult,
      remoteAddress: '203.0.113.10',
    });
    expect(other.statusCode).toBe(201);
    await fresh.close();
  });

  it('GET /api/results/stats', async () => {
    const res = await app.inject('/api/results/stats?days=7');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ count: 1, avgDownload: 512.3 });
  });

  it('GET /api/health', async () => {
    const res = await app.inject('/api/health');
    expect(res.json()).toEqual({ status: 'ok', db: 'ok', redis: 'disabled' });
  });
});

describe('статика', () => {
  it('віддає фронтенд; хешовані файли — immutable, HTML — no-cache', async () => {
    const { mkdtempSync, writeFileSync, mkdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'st-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>t</title>');
    writeFileSync(join(dir, 'assets', 'index-AbC123xY.js'), 'console.log(1)');
    const app = await buildApp({ config: { ...config, staticDir: dir }, logger: false });
    const html = await app.inject('/');
    expect(html.statusCode).toBe(200);
    expect(html.headers['cache-control']).toBe('no-cache');
    const js = await app.inject('/assets/index-AbC123xY.js');
    expect(js.headers['cache-control']).toContain('immutable');
    await app.close();
  });
});

describe('SPEED_ENDPOINTS=false (хмарний тариф)', () => {
  it('download/upload вимкнені, ping/meta/результати працюють', async () => {
    const app = await buildApp({ config: loadConfig({ SPEED_ENDPOINTS: 'false' }), logger: false });
    expect((await app.inject('/api/download?bytes=100')).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/upload',
          headers: { 'content-type': 'text/plain' },
          payload: 'x',
        })
      ).statusCode,
    ).toBe(404);
    expect((await app.inject('/api/ping')).statusCode).toBe(200);
    expect((await app.inject('/api/meta')).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/results', payload: validResult })).statusCode).toBe(201);
    await app.close();
  });
});
