import { describe, it, expect } from 'vitest';
import { heatBins, binOf, bestAndWorst, LEVELS } from '../src/core/heatmap.js';

describe('heatBins / binOf', () => {
  it('5 рівних інтервалів від мінімуму до максимуму', () => {
    const bins = heatBins([100, 200, 600]);
    expect(bins).toHaveLength(LEVELS);
    expect(bins[0]).toEqual({ from: 100, to: 200, index: 0 });
    expect(bins.at(-1)).toEqual({ from: 500, to: 600, index: 4 });
    expect(binOf(100, bins)).toBe(0);
    expect(binOf(200, bins)).toBe(0); // межа належить нижчому інтервалу
    expect(binOf(201, bins)).toBe(1);
    expect(binOf(600, bins)).toBe(4);
  });

  it('усі значення однакові — один середній рівень', () => {
    const bins = heatBins([300, 300]);
    expect(bins).toEqual([{ from: 300, to: 300, index: 2 }]);
    expect(binOf(300, bins)).toBe(2);
  });

  it('порожньо', () => {
    expect(heatBins([])).toEqual([]);
    expect(binOf(5, [])).toBe(0);
  });
});

describe('bestAndWorst', () => {
  it('за медіаною; при рівності — слот із більшою кількістю тестів', () => {
    const cells = [
      { dow: 1, hour: 9, medianDownload: 100, samples: 2 },
      { dow: 2, hour: 21, medianDownload: 400, samples: 1 },
      { dow: 3, hour: 3, medianDownload: 400, samples: 5 },
      { dow: 5, hour: 20, medianDownload: 50, samples: 4 },
    ];
    const { best, worst } = bestAndWorst(cells);
    expect(best).toMatchObject({ dow: 3, hour: 3 });
    expect(worst).toMatchObject({ dow: 5, hour: 20 });
    expect(bestAndWorst([])).toEqual({ best: null, worst: null });
  });
});
