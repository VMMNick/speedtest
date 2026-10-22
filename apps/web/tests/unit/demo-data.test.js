import { describe, it, expect } from 'vitest';
import {
  DEMO_THRESHOLD,
  demoStats,
  demoProviders,
  demoCities,
  demoHeatmap,
  demoStatus,
  demoIncidents,
} from '../../src/core/demoData.js';

describe('демо-дані аналітики', () => {
  it('мають ту саму форму, що й відповіді API', () => {
    expect(demoStats(30)).toEqual({
      count: expect.any(Number),
      avgDownload: expect.any(Number),
      avgUpload: expect.any(Number),
      medianPing: expect.any(Number),
    });
    for (const p of demoProviders(30)) {
      expect(Object.keys(p).sort()).toEqual(
        ['isp', 'medianDownload', 'medianPing', 'medianUpload', 'p90Download', 'samples'].sort(),
      );
      expect(p.p90Download).toBeGreaterThanOrEqual(p.medianDownload);
    }
    expect(demoCities(30)[0]).toEqual({ city: expect.any(String), country: 'UA', samples: expect.any(Number) });
  });

  it('рейтинг відсортований за медіаною, фільтр за містом працює', () => {
    const all = demoProviders(30);
    expect(all.map((p) => p.medianDownload)).toEqual([...all.map((p) => p.medianDownload)].sort((a, b) => b - a));
    expect(demoProviders(30, 'Lviv').map((p) => p.isp)).toEqual(['HomeLAN']);
    expect(demoProviders(30, 'Nowhere')).toEqual([]);
  });

  it('теплова карта: 7 × 24, детермінована, вечір повільніший за ніч', () => {
    const a = demoHeatmap(30);
    expect(a).toHaveLength(7 * 24);
    expect(demoHeatmap(30)).toEqual(a);
    const at = (h) => a.filter((c) => c.hour === h).reduce((s, c) => s + c.medianDownload, 0);
    expect(at(21)).toBeLessThan(at(4));
    expect(demoHeatmap(30, { isp: 'Nobody' })).toEqual([]);
    expect(a.reduce((s, c) => s + c.samples, 0)).toBe(demoStats(30).count);
  });

  it('кількість тестів залежить від періоду, поріг — розумний', () => {
    expect(demoStats(7).count).toBeLessThan(demoStats(30).count);
    expect(DEMO_THRESHOLD).toBeGreaterThan(3);
  });

  it('стан провайдерів: форма як у /api/status/*, проблемні першими', () => {
    const now = Date.parse('2026-10-20T12:00:00Z');
    const s = demoStatus(now);
    expect(s).toMatchObject({ checkedAt: '2026-10-20T11:57:00.000Z', recentHours: 3, baselineDays: 14 });
    expect(s.providers.map((p) => p.status)).toEqual(['degraded', 'ok', 'ok', 'ok', 'unknown']);
    for (const p of s.providers) {
      expect(Object.keys(p).sort()).toEqual(
        [
          'baselineDownload',
          'baselinePing',
          'baselineSamples',
          'isp',
          'reasons',
          'recentDownload',
          'recentPing',
          'recentSamples',
          'since',
          'status',
        ].sort(),
      );
    }
    const incidents = demoIncidents(now);
    expect(incidents.filter((i) => i.endedAt === null)).toHaveLength(1);
    expect(incidents.map((i) => i.startedAt)).toEqual([...incidents.map((i) => i.startedAt)].sort().reverse());
    for (const i of incidents) if (i.endedAt) expect(Date.parse(i.endedAt)).toBeGreaterThan(Date.parse(i.startedAt));
  });
});
