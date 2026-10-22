/**
 * Чи підходить з'єднання для типових сценаріїв — і чому ні.
 *
 * Пороги — одне джерело правди і для рушія (MetricsCalculator.useCases), і для інтерфейсу,
 * який показує, яку саме умову не виконано. Модуль крихітний і без залежностей,
 * тож не роздуває стартовий бандл.
 */

/**
 * @typedef {'download' | 'upload' | 'ping' | 'jitter' | 'loss'} UseCaseMetric
 * @typedef {{ metric: UseCaseMetric, op: '>=' | '<', limit: number }} UseCaseRule
 * @typedef {UseCaseRule & { value: number, ok: boolean }} UseCaseCheck
 */

/** @type {Record<'streaming4k' | 'videoCalls' | 'gaming' | 'browsing', UseCaseRule[]>} */
export const USE_CASE_RULES = Object.freeze({
  // Netflix/YouTube радять ~25 Мбіт/с для 4K; втрати змушують плеєр знижувати якість
  streaming4k: [
    { metric: 'download', op: '>=', limit: 25 },
    { metric: 'loss', op: '<', limit: 2 },
  ],
  // HD-відео в обидва боки; затримка понад ~150 мс уже помітна в розмові (ITU-T G.114)
  videoCalls: [
    { metric: 'upload', op: '>=', limit: 3 },
    { metric: 'download', op: '>=', limit: 3 },
    { metric: 'ping', op: '<', limit: 150 },
    { metric: 'jitter', op: '<', limit: 30 },
  ],
  // Іграм швидкість майже не потрібна — важлива низька й рівна затримка без втрат
  gaming: [
    { metric: 'ping', op: '<', limit: 60 },
    { metric: 'jitter', op: '<', limit: 15 },
    { metric: 'loss', op: '<', limit: 1 },
  ],
  browsing: [{ metric: 'download', op: '>=', limit: 2 }],
});

const pass = (value, op, limit) => (op === '>=' ? value >= limit : value < limit);

/**
 * Перевірка кожного сценарію по кожній умові.
 * @param {Record<UseCaseMetric, number>} values
 * @returns {Record<string, { ok: boolean, checks: UseCaseCheck[] }>}
 */
export function useCaseChecks(values) {
  return Object.fromEntries(
    Object.entries(USE_CASE_RULES).map(([name, rules]) => {
      const checks = rules.map((r) => {
        const value = values[r.metric] ?? 0;
        return { ...r, value, ok: pass(value, r.op, r.limit) };
      });
      return [name, { ok: checks.every((c) => c.ok), checks }];
    }),
  );
}

/**
 * Найсильніше порушена умова — її показуємо коротко на самій позначці.
 * «У скільки разів гірше за поріг»: пінг 300 при порозі 60 (×5) важливіший за upload 2.5 при 3 (×1.2).
 * @param {UseCaseCheck[]} checks
 * @returns {UseCaseCheck | null}
 */
export function worstCheck(checks) {
  const severity = (c) => (c.op === '<' ? c.value / Math.max(c.limit, 1e-9) : c.limit / Math.max(c.value, 1e-9));
  return checks.filter((c) => !c.ok).sort((a, b) => severity(b) - severity(a))[0] ?? null;
}
