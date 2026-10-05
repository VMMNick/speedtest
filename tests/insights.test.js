import { describe, it, expect } from 'vitest';
import {
  compareResults,
  planShare,
  filterByPeriod,
  sparklinePoints,
  SAME_THRESHOLD_PCT,
} from '../src/core/insights.js';

const result = (download, upload, ping, jitter) => ({
  download: { mbps: download },
  upload: { mbps: upload },
  ping: { median: ping, jitter },
});

describe('compareResults', () => {
  it('немає попереднього — немає порівняння', () => {
    expect(compareResults(null, result(100, 50, 20, 2))).toBeNull();
  });

  it('швидкість: більше — краще; пінг і джиттер: менше — краще', () => {
    const cmp = compareResults(result(100, 50, 20, 4), result(150, 40, 10, 6));
    expect(cmp.download).toMatchObject({ delta: 50, pct: 50, trend: 'better' });
    expect(cmp.upload).toMatchObject({ delta: -10, pct: -20, trend: 'worse' });
    expect(cmp.ping).toMatchObject({ delta: -10, pct: -50, trend: 'better' });
    expect(cmp.jitter).toMatchObject({ delta: 2, pct: 50, trend: 'worse' });
  });

  it(`зміни < ${SAME_THRESHOLD_PCT}% — «без змін»`, () => {
    const cmp = compareResults(result(100, 50, 20, 2), result(101, 49.5, 20.2, 2));
    expect(Object.values(cmp).every((d) => d.trend === 'same')).toBe(true);
  });

  it('пропускає метрики без даних або з нулем у попередньому', () => {
    const cmp = compareResults({ download: { mbps: 0 }, ping: { median: 10 } }, result(100, 50, 12, 1));
    expect(cmp.download).toBeUndefined();
    expect(cmp.ping.trend).toBe('worse');
  });
});

describe('planShare', () => {
  it('рівні: ≥80% — good, ≥50% — ok, інакше bad', () => {
    expect(planShare(450, 500)).toEqual({ pct: 90, level: 'good' });
    expect(planShare(300, 500)).toEqual({ pct: 60, level: 'ok' });
    expect(planShare(100, 500)).toEqual({ pct: 20, level: 'bad' });
    expect(planShare(600, 500).pct).toBe(120);
  });
  it('тариф не задано', () => {
    expect(planShare(100, null)).toBeNull();
    expect(planShare(100, 0)).toBeNull();
    expect(planShare(NaN, 100)).toBeNull();
  });
});

describe('filterByPeriod', () => {
  const now = 1_000_000_000_000;
  const h = 3600_000;
  const entries = [
    { timestamp: now - h },
    { timestamp: now - 3 * 24 * h },
    { timestamp: now - 20 * 24 * h },
    { timestamp: now - 90 * 24 * h },
  ];
  it('періоди', () => {
    expect(filterByPeriod(entries, 'all', now)).toHaveLength(4);
    expect(filterByPeriod(entries, '24h', now)).toHaveLength(1);
    expect(filterByPeriod(entries, '7d', now)).toHaveLength(2);
    expect(filterByPeriod(entries, '30d', now)).toHaveLength(3);
    expect(filterByPeriod(entries, 'unknown', now)).toHaveLength(4);
  });
});

describe('sparklinePoints', () => {
  it('масштабує в межі й інвертує Y (більше — вище)', () => {
    const pts = sparklinePoints([10, 20, 30], 100, 24, 2)
      .split(' ')
      .map((p) => p.split(',').map(Number));
    expect(pts).toEqual([
      [0, 22],
      [50, 12],
      [100, 2],
    ]);
  });
  it('однакові значення — горизонтальна лінія посередині; порожньо — порожній рядок', () => {
    expect(sparklinePoints([5, 5], 100, 24)).toBe('0,12 100,12');
    expect(sparklinePoints([], 100, 24)).toBe('');
    expect(sparklinePoints([7], 100, 24)).toBe('50,12');
  });
});
