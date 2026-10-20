/**
 * Математика шкали датчика: нелінійні шкали і перетворення значення в частку дуги.
 * Чистий модуль — без DOM, тестується в Node.
 */
import { CONFIG } from './config.js';

const PING_SCALE = [0, 5, 10, 20, 30, 50, 75, 100, 150, 250, 500, 1000];

/**
 * Шкала датчика: пінг — своя; швидкість — до 1 Гбіт/с, а якщо значення більше —
 * мультигігабітна (до 10 Гбіт/с).
 * @param {'ping' | 'speed'} kind
 * @param {number} value
 */
export function scaleFor(kind, value = 0) {
  if (kind === 'ping') return PING_SCALE;
  return value > CONFIG.gaugeScale[CONFIG.gaugeScale.length - 1] ? CONFIG.gaugeScaleGigabit : CONFIG.gaugeScale;
}

/** Значення → частка шкали (0..1) з нелінійною шкалою. */
export function valueToFraction(value, scale) {
  if (value <= scale[0]) return 0;
  const last = scale.length - 1;
  if (value >= scale[last]) return 1;
  for (let i = 0; i < last; i++) {
    if (value <= scale[i + 1]) {
      const local = (value - scale[i]) / (scale[i + 1] - scale[i]);
      return (i + local) / last;
    }
  }
  return 1;
}
