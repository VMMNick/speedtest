/**
 * Чисті функції для теплової карти: розбиття на інтервали кольору і висновки.
 * Колір — послідовна шкала одного відтінку (світліше = повільніше), 5 рівнів.
 */

export const LEVELS = 5;

/**
 * Рівні шкали: рівні за шириною інтервали від мінімуму до максимуму.
 * Для вимірювань це зрозуміліше за квантилі: легенда показує «круглі» межі в Мбіт/с.
 * @param {number[]} values
 * @returns {{ from: number, to: number, index: number }[]}
 */
export function heatBins(values) {
  const vs = values.filter(Number.isFinite);
  if (!vs.length) return [];
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  // Усі значення однакові — один рівень посередині шкали (не «найгірший» і не «найкращий»)
  if (max === min) return [{ from: min, to: max, index: Math.floor(LEVELS / 2) }];
  const step = (max - min) / LEVELS;
  return Array.from({ length: LEVELS }, (_, i) => ({
    from: min + step * i,
    to: i === LEVELS - 1 ? max : min + step * (i + 1),
    index: i,
  }));
}

/**
 * Індекс рівня (0…LEVELS−1) для значення.
 * @param {number} value
 * @param {ReturnType<typeof heatBins>} bins
 */
export function binOf(value, bins) {
  if (!bins.length) return 0;
  if (bins.length === 1) return bins[0].index;
  const found = bins.find((b) => value <= b.to);
  return (found ?? bins[bins.length - 1]).index;
}

/**
 * Найкращий і найгірший слот (день × година) за медіанною швидкістю.
 * При рівності — той, де більше тестів (надійніше).
 * @template {{ medianDownload: number, samples: number }} C
 * @param {C[]} cells
 * @returns {{ best: C | null, worst: C | null }}
 */
export function bestAndWorst(cells) {
  if (!cells.length) return { best: null, worst: null };
  const sorted = [...cells].sort((a, b) => b.medianDownload - a.medianDownload || b.samples - a.samples);
  const worst = [...cells].sort((a, b) => a.medianDownload - b.medianDownload || b.samples - a.samples)[0];
  return { best: sorted[0], worst };
}
