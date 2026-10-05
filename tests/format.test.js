import { describe, it, expect } from 'vitest';
import { formatMbps, formatMs, formatBytes, valueToFraction } from '../src/ui/UIController.js';

describe('форматування', () => {
  it('formatMbps: точність залежить від величини, гігабіти — без суфіксів', () => {
    expect(formatMbps(3.14159)).toBe('3.14');
    expect(formatMbps(42.42)).toBe('42.4');
    expect(formatMbps(512.6)).toBe('513');
    expect(formatMbps(1234.5)).toBe('1235');
    expect(Number(formatMbps(2500))).toBe(2500);
    expect(formatMbps(null)).toBe('—');
    expect(formatMbps(NaN)).toBe('—');
  });

  it('formatMs', () => {
    expect(formatMs(7.25)).toBe('7.3');
    expect(formatMs(150.4)).toBe('150');
    expect(formatMs(undefined)).toBe('—');
  });

  it('formatBytes', () => {
    expect(formatBytes(0)).toBe('0 Б');
    expect(formatBytes(512)).toBe('512 Б');
    expect(formatBytes(1536)).toBe('1.5 КБ');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.0 ГБ');
  });

  it('valueToFraction: нелінійна шкала датчика', () => {
    const scale = [0, 10, 100, 1000];
    expect(valueToFraction(0, scale)).toBe(0);
    expect(valueToFraction(10, scale)).toBeCloseTo(1 / 3);
    expect(valueToFraction(55, scale)).toBeCloseTo(0.5);
    expect(valueToFraction(5000, scale)).toBe(1);
    expect(valueToFraction(-1, scale)).toBe(0);
  });
});
