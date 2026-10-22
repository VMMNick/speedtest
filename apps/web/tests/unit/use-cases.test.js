import { describe, it, expect } from 'vitest';
import { useCaseChecks, worstCheck, USE_CASE_RULES } from '../../src/core/useCases.js';
import { useCases } from '../../src/core/MetricsCalculator.js';

const good = { download: 300, upload: 50, ping: 12, jitter: 2, loss: 0 };

describe('сценарії використання', () => {
  it('гарне з’єднання проходить усе', () => {
    const c = useCaseChecks(good);
    expect(Object.values(c).every((x) => x.ok)).toBe(true);
    expect(worstCheck(c.gaming.checks)).toBeNull();
  });

  it('кожна умова з фактичним значенням — видно, що саме не так', () => {
    // Як на скріншоті: швидко, але нерівна затримка
    const c = useCaseChecks({ ...good, ping: 46, jitter: 34 });
    expect(c.streaming4k.ok).toBe(true);
    expect(c.videoCalls.ok).toBe(false);
    expect(c.videoCalls.checks.filter((x) => !x.ok)).toEqual([
      { metric: 'jitter', op: '<', limit: 30, value: 34, ok: false },
    ]);
    expect(c.gaming.checks.filter((x) => !x.ok).map((x) => x.metric)).toEqual(['jitter']);
  });

  it('межі: «≥» включно, «<» — ні', () => {
    expect(useCaseChecks({ ...good, download: 25 }).streaming4k.ok).toBe(true);
    expect(useCaseChecks({ ...good, ping: 60 }).gaming.ok).toBe(false);
    expect(useCaseChecks({ ...good, ping: 59.9 }).gaming.ok).toBe(true);
  });

  it('найгірша умова — за кратністю перевищення порогу', () => {
    // пінг 300 при порозі 60 (×5) гірший за джиттер 20 при порозі 15 (×1.3)
    const { checks } = useCaseChecks({ ...good, ping: 300, jitter: 20 }).gaming;
    expect(worstCheck(checks)).toMatchObject({ metric: 'ping' });
    // upload 0.5 при порозі 3 (×6) гірший за пінг 200 при 150 (×1.3); нульова швидкість не ламає розрахунок
    expect(worstCheck(useCaseChecks({ ...good, upload: 0.5, ping: 200 }).videoCalls.checks)).toMatchObject({
      metric: 'upload',
    });
    expect(worstCheck(useCaseChecks({ ...good, download: 0 }).browsing.checks)).toMatchObject({ metric: 'download' });
  });

  it('рушій зберігає ті самі булеві значення', () => {
    const v = { ...good, jitter: 34 };
    expect(useCases(v)).toEqual(Object.fromEntries(Object.entries(useCaseChecks(v)).map(([k, x]) => [k, x.ok])));
    expect(Object.keys(useCases(good))).toEqual(Object.keys(USE_CASE_RULES));
  });
});
