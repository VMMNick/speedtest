import { describe, it, expect } from 'vitest';
import * as M from '../src/core/MetricsCalculator.js';

describe('MetricsCalculator — базова статистика', () => {
  it('mean / median / percentile', () => {
    expect(M.mean([1, 2, 3, 4])).toBe(2.5);
    expect(M.mean([])).toBe(0);
    expect(M.median([5, 1, 3])).toBe(3);
    expect(M.median([1, 2, 3, 4])).toBe(2.5);
    expect(M.percentile([10, 20, 30, 40, 50], 0.9)).toBeCloseTo(46);
  });

  it('stdDev', () => {
    expect(M.stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(M.stdDev([5])).toBe(0);
  });
});

describe('MetricsCalculator — мережеві метрики', () => {
  it('bytesToMbps: 1 250 000 байт за 1 с = 10 Мбіт/с', () => {
    expect(M.bytesToMbps(1_250_000, 1000)).toBeCloseTo(10);
    expect(M.bytesToMbps(100, 0)).toBe(0);
  });

  it('jitter — середня різниця між послідовними RTT', () => {
    expect(M.jitter([10, 12, 10, 14])).toBeCloseTo((2 + 2 + 4) / 3);
    expect(M.jitter([10])).toBe(0);
    expect(M.jitter([20, 20, 20])).toBe(0);
  });

  it('packetLoss у відсотках', () => {
    expect(M.packetLoss(20, 19)).toBe(5);
    expect(M.packetLoss(10, 10)).toBe(0);
    expect(M.packetLoss(0, 0)).toBe(0);
  });

  it('summarizeLatency', () => {
    const s = M.summarizeLatency([10, 20, 30], 4);
    expect(s).toMatchObject({ min: 10, max: 30, avg: 20, median: 20, jitter: 10, loss: 25 });
  });
});

describe('MetricsCalculator — пропускна здатність', () => {
  // 10 Мбіт/с = 1250 байт/мс, семпл кожні 200 мс
  const steady = Array.from({ length: 51 }, (_, i) => ({ t: i * 200, bytes: i * 200 * 1250 }));

  it('throughput на рівномірному потоці', () => {
    expect(M.throughput(steady, 1500)).toBeCloseTo(10);
  });

  it('throughput ігнорує повільний розгін (slow start)', () => {
    // перші 1.5 с — 1 Мбіт/с, далі — 50 Мбіт/с
    const samples = [];
    let bytes = 0;
    for (let t = 0; t <= 10000; t += 200) {
      samples.push({ t, bytes });
      bytes += (t < 1500 ? 125 : 6250) * 200;
    }
    expect(M.throughput(samples, 1500)).toBeGreaterThan(48);
    expect(M.throughput(samples, 0)).toBeLessThan(48);
  });

  it('throughput для короткого тесту бере весь інтервал', () => {
    expect(M.throughput([{ t: 0, bytes: 0 }, { t: 200, bytes: 250_000 }], 1500)).toBeCloseTo(10);
    expect(M.throughput([], 0)).toBe(0);
  });

  it('liveSpeed — швидкість у ковзному вікні', () => {
    expect(M.liveSpeed(steady, 1000)).toBeCloseTo(10);
    expect(M.liveSpeed([], 1000)).toBe(0);
  });

  it('variation — коефіцієнт варіації', () => {
    expect(M.variation([10, 10, 10])).toBe(0);
    expect(M.variation([5, 15])).toBeGreaterThan(0.5);
  });
});

describe('MetricsCalculator — оцінки', () => {
  it('grade', () => {
    expect(M.grade(95)).toBe('A');
    expect(M.grade(80)).toBe('B');
    expect(M.grade(65)).toBe('C');
    expect(M.grade(45)).toBe('D');
    expect(M.grade(10)).toBe('F');
  });

  it('bufferbloat', () => {
    expect(M.bufferbloat(20, 25)).toEqual({ delta: 5, grade: 'A' });
    expect(M.bufferbloat(20, 170)).toMatchObject({ grade: 'C' });
    expect(M.bufferbloat(20, 10)).toEqual({ delta: 0, grade: 'A' });
  });

  it('stabilityScore: ідеальне з’єднання ≈ 100, погане — низький бал', () => {
    const good = M.stabilityScore({ ping: 10, jitter: 1, loss: 0, bloatMs: 5, speedCv: 0.05 });
    const bad = M.stabilityScore({ ping: 200, jitter: 40, loss: 5, bloatMs: 300, speedCv: 0.8 });
    expect(good.score).toBeGreaterThanOrEqual(90);
    expect(good.grade).toBe('A');
    expect(bad.score).toBeLessThan(20);
    expect(bad.grade).toBe('F');
  });

  it('useCases', () => {
    const u = M.useCases({ download: 100, upload: 20, ping: 15, jitter: 2, loss: 0 });
    expect(Object.values(u).every(Boolean)).toBe(true);
    const slow = M.useCases({ download: 1, upload: 0.5, ping: 300, jitter: 50, loss: 5 });
    expect(Object.values(slow).some(Boolean)).toBe(false);
  });
});
