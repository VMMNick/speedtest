import { describe, it, expect } from 'vitest';
import { CONFIG, LIGHT_CONFIG, detectLightMode, mergeDeep } from '../src/core/config.js';
import { scaleFor } from '../src/ui/UIController.js';

describe('економний режим', () => {
  it('detectLightMode: Save-Data або повільна мережа', () => {
    expect(detectLightMode(undefined)).toBe(false);
    expect(detectLightMode({ effectiveType: '4g' })).toBe(false);
    expect(detectLightMode({ saveData: true, effectiveType: '4g' })).toBe(true);
    expect(detectLightMode({ effectiveType: '3g' })).toBe(true);
    expect(detectLightMode({ effectiveType: 'slow-2g' })).toBe(true);
  });

  it('LIGHT_CONFIG помітно зменшує обсяг тесту', () => {
    const light = mergeDeep(CONFIG, LIGHT_CONFIG);
    expect(light.download.durationMs).toBeLessThan(CONFIG.download.durationMs);
    expect(light.download.maxBytes).toBeLessThan(CONFIG.download.maxBytes);
    expect(light.upload.streams).toBeLessThan(CONFIG.upload.streams);
    // Інші поля успадковуються
    expect(light.download.targetRequestMs).toBe(CONFIG.download.targetRequestMs);
  });
});

describe('mergeDeep', () => {
  it('зливає вкладені об’єкти, масиви замінює цілком, не мутує вхід', () => {
    const base = { a: { x: 1, y: 2 }, list: [1, 2, 3] };
    const out = mergeDeep(base, { a: { y: 3 }, list: [9] });
    expect(out).toEqual({ a: { x: 1, y: 3 }, list: [9] });
    expect(base.a.y).toBe(2);
  });
});

describe('scaleFor — шкала датчика', () => {
  it('пінг — своя шкала, швидкість до 1 Гбіт/с — стандартна, вище — мультигігабітна', () => {
    expect(scaleFor('ping', 5000)).not.toBe(CONFIG.gaugeScale);
    expect(scaleFor('speed', 500)).toBe(CONFIG.gaugeScale);
    expect(scaleFor('speed', 1000)).toBe(CONFIG.gaugeScale);
    expect(scaleFor('speed', 2300)).toBe(CONFIG.gaugeScaleGigabit);
    expect(CONFIG.gaugeScaleGigabit.at(-1)).toBe(10_000);
  });
});
