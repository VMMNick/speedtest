/**
 * Стан провайдерів: чи працює провайдер «як зазвичай» прямо зараз.
 *
 * Порівнюємо медіани за останні години (recent) з медіанами за базовий період (baseline)
 * для того самого провайдера. Чиста логіка без I/O — вікна рахує репозиторій,
 * а фонова задача (jobs.js) лише склеює одне з іншим.
 */

export const STATUS = /** @type {const} */ ({ ok: 'ok', degraded: 'degraded', unknown: 'unknown' });

/**
 * @typedef {object} StatusRules
 * @property {number} recentHours    «зараз» — останні N годин
 * @property {number} baselineDays   «як зазвичай» — попередні N днів (без вікна recent)
 * @property {number} minRecent      менше тестів за recent — стан невідомий
 * @property {number} minBaseline    менше тестів за baseline — нема з чим порівнювати
 * @property {number} downloadDrop   download нижче за baseline × це — деградація
 * @property {number} pingRise       пінг вище за baseline × це …
 * @property {number} pingRiseMinMs  … і щонайменше на стільки мс (2 → 5 мс — не проблема)
 */

/** @type {StatusRules} */
export const DEFAULT_RULES = Object.freeze({
  recentHours: 3,
  baselineDays: 14,
  minRecent: 3,
  minBaseline: 10,
  downloadDrop: 0.5,
  pingRise: 2,
  pingRiseMinMs: 20,
});

/**
 * @typedef {object} ProviderWindow
 * @property {string} isp
 * @property {number} recentSamples
 * @property {number} baselineSamples
 * @property {number | null} recentDownload
 * @property {number | null} baselineDownload
 * @property {number | null} recentPing
 * @property {number | null} baselinePing
 */

/**
 * @typedef {ProviderWindow & { status: 'ok' | 'degraded' | 'unknown', reasons: ('download' | 'ping')[] }} ProviderVerdict
 */

/**
 * @param {ProviderWindow} w
 * @param {StatusRules} [rules]
 * @returns {ProviderVerdict}
 */
export function evaluate(w, rules = DEFAULT_RULES) {
  if (w.recentSamples < rules.minRecent || w.baselineSamples < rules.minBaseline) {
    return { ...w, status: STATUS.unknown, reasons: [] };
  }
  /** @type {('download' | 'ping')[]} */
  const reasons = [];
  if (w.recentDownload < w.baselineDownload * rules.downloadDrop) reasons.push('download');
  if (w.recentPing > w.baselinePing * rules.pingRise && w.recentPing - w.baselinePing >= rules.pingRiseMinMs) {
    reasons.push('ping');
  }
  return { ...w, status: reasons.length ? STATUS.degraded : STATUS.ok, reasons };
}

/**
 * Що зробити з інцидентом при переході стану.
 * Деградація відкриває інцидент, повернення до норми — закриває.
 * «Невідомо» (мало свіжих тестів) інцидент не закриває: ми не знаємо, що проблему виправлено.
 * @param {string | undefined} prev попередній стан (undefined — провайдер новий)
 * @param {string} next
 * @returns {'open' | 'close' | null}
 */
export function incidentAction(prev, next) {
  if (next === STATUS.degraded && prev !== STATUS.degraded) return 'open';
  if (prev === STATUS.degraded && next === STATUS.ok) return 'close';
  return null;
}

/**
 * Одна перевірка: вікна з репозиторію → вердикти → збереження знімка й інцидентів.
 * @param {{ providerWindows: Function, providerStatus: Function, saveProviderStatus: Function }} repo
 * @param {{ now?: Date, rules?: StatusRules }} [opts]
 * @returns {Promise<{ checked: number, transitions: { isp: string, from?: string, to: string, action: 'open' | 'close' | null }[] }>}
 */
export async function checkProviders(repo, { now = new Date(), rules = DEFAULT_RULES } = {}) {
  const windows = await repo.providerWindows({ now, recentHours: rules.recentHours, baselineDays: rules.baselineDays });
  const verdicts = windows.map((w) => evaluate(w, rules));
  const previous = new Map((await repo.providerStatus()).map((p) => [p.isp, p.status]));
  const transitions = verdicts
    .filter((v) => previous.get(v.isp) !== v.status)
    .map((v) => ({
      isp: v.isp,
      from: previous.get(v.isp),
      to: v.status,
      action: incidentAction(previous.get(v.isp), v.status),
    }));
  await repo.saveProviderStatus(verdicts, transitions, now);
  return { checked: verdicts.length, transitions };
}
