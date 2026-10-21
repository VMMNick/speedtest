import { describe, it, expect } from 'vitest';
import { DEMO_THRESHOLD, demoStats, demoProviders, demoCities, demoHeatmap } from '../../src/core/demoData.js';

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
});
