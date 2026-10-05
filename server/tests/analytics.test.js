import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { memoryRepository, percentileCont } from '../src/db.js';
import { seed, MONDAY_LATE_UTC } from './fixtures.js';

describe('аналітика (репозиторій у пам’яті)', () => {
  let app;
  beforeAll(async () => {
    const repo = memoryRepository();
    await seed(repo);
    app = await buildApp({ config: loadConfig({}), repo, logger: false });
  });
  afterAll(() => app.close());

  it('рейтинг провайдерів: за медіаною download, з k-анонімністю', async () => {
    const res = await app.inject('/api/analytics/providers');
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-cache']).toBe('MISS'); // без Redis — завжди обчислення
    const rows = res.json();
    expect(rows.map((r) => r.isp)).toEqual(['FastNet', 'SlowNet']); // TinyISP (2 тести) прихований
    expect(rows[0]).toMatchObject({ samples: 7, medianDownload: 400, medianPing: 10 }); // Київ + Львів
    expect(rows[1]).toMatchObject({ samples: 3, medianDownload: 50, p90Download: 58, medianPing: 40 });
  });

  it('фільтр за містом', async () => {
    const rows = (await app.inject('/api/analytics/providers?city=Lviv')).json();
    expect(rows).toEqual([expect.objectContaining({ isp: 'FastNet', samples: 3, medianDownload: 500 })]);
  });

  it('міста — без малих груп', async () => {
    const rows = (await app.inject('/api/analytics/cities')).json();
    expect(rows).toEqual([
      { city: 'Kyiv', country: 'UA', samples: 7 },
      { city: 'Lviv', country: 'UA', samples: 3 },
    ]);
  });

  it('теплова карта враховує часовий пояс клієнта', async () => {
    if (Date.now() - MONDAY_LATE_UTC.getTime() > 20 * 86_400_000) return; // фікстура «застаріла»
    const utc = (await app.inject('/api/analytics/heatmap?tz=UTC')).json();
    const kyiv = (await app.inject('/api/analytics/heatmap?tz=Europe/Kyiv')).json();
    expect(utc.find((c) => c.dow === 1 && c.hour === 21)).toMatchObject({ samples: 3, medianDownload: 280 });
    expect(kyiv.find((c) => c.dow === 2 && c.hour === 0)).toMatchObject({ samples: 3, medianDownload: 280 });
    expect(utc.reduce((s, c) => s + c.samples, 0)).toBe(12);
  });

  it('теплова карта: фільтр за провайдером', async () => {
    const cells = (await app.inject('/api/analytics/heatmap?isp=SlowNet')).json();
    expect(cells.reduce((s, c) => s + c.samples, 0)).toBe(3);
  });

  it.each([
    ['невідомий часовий пояс', '/api/analytics/heatmap?tz=Mars/Olympus'],
    ['SQL-ін’єкція в tz', "/api/analytics/heatmap?tz=UTC';DROP TABLE results;--"],
    ['зайвий параметр', '/api/analytics/providers?sort=desc'],
    ['days поза межами', '/api/analytics/providers?days=1000'],
  ])('400: %s', async (_name, url) => {
    expect((await app.inject(url)).statusCode).toBe(400);
  });
});

describe('percentileCont = PostgreSQL percentile_cont', () => {
  it('лінійна інтерполяція', () => {
    expect(percentileCont([40, 50, 60], 0.9)).toBe(58);
    expect(percentileCont([200, 280, 320, 400], 0.5)).toBe(300);
    expect(percentileCont([], 0.5)).toBe(0);
    expect(percentileCont([7], 0.9)).toBe(7);
  });
});

describe('часові пояси браузер ↔ PostgreSQL', async () => {
  const { resolveTimeZone } = await import('../src/timezones.js');
  const pg = new Set(['UTC', 'Europe/Kyiv', 'Asia/Kolkata']);
  it('застаріла назва з браузера → актуальна в БД', () => {
    expect(resolveTimeZone('Europe/Kiev', pg)).toBe('Europe/Kyiv');
    expect(resolveTimeZone('Asia/Calcutta', pg)).toBe('Asia/Kolkata');
  });
  it('і навпаки — для старої tzdata', () => {
    expect(resolveTimeZone('Europe/Kyiv', new Set(['Europe/Kiev']))).toBe('Europe/Kiev');
  });
  it('невідомий пояс → UTC', () => {
    expect(resolveTimeZone('Mars/Base', pg)).toBe('UTC');
  });
});
