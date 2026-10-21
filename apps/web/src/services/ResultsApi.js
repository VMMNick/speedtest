/**
 * Надсилання анонімного результату на власний сервер (POST /api/results).
 * Працює лише у збірці з VITE_RESULTS_API=true і за згодою користувача.
 * IP-адреса не надсилається; провайдер/місто/країна — лише якщо їх повернув /meta.
 */

import { RESULT_LIMITS, TEXT_MAX, COUNTRY_RE, RESULT_TOKEN_HEADER } from '@speedtest/shared/result-schema';

/** Округлення до сотих і обмеження межами схеми — сервер не відхилить запит через викид */
const fit = (x, max) => Math.min(max, Math.max(0, Math.round((Number(x) || 0) * 100) / 100));

/** Лише непорожній рядок, обрізаний до межі схеми (об'єкт не стане «[object Object]») */
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, TEXT_MAX) : null);

/**
 * Перетворює результат тесту на тіло запиту за спільною схемою (packages/shared/result-schema.js).
 * @param {import('../core/types.js').TestResult} r
 * @param {{ isp?: string | null, city?: string | null, country?: string | null } | null} meta
 * @param {{ lightMode?: boolean }} [extra]
 */
export function toPayload(r, meta, { lightMode = false } = {}) {
  /** @type {Record<string, unknown>} */
  const body = {
    server: r.server?.id === 'self' ? 'self' : 'cloudflare',
    download: fit(r.download.mbps, RESULT_LIMITS.download),
    upload: fit(r.upload.mbps, RESULT_LIMITS.upload),
    ping: fit(r.ping.median, RESULT_LIMITS.ping),
    jitter: fit(r.ping.jitter, RESULT_LIMITS.jitter),
    loss: fit(r.ping.loss, RESULT_LIMITS.loss),
    grade: r.stability.grade,
    score: Math.round(fit(r.stability.score, RESULT_LIMITS.score)),
    bufferbloat: fit(r.bufferbloat?.delta ?? 0, RESULT_LIMITS.bufferbloat),
    lightMode,
  };
  const isp = text(meta?.isp);
  const city = text(meta?.city);
  if (isp) body.isp = isp;
  if (city) body.city = city;
  if (typeof meta?.country === 'string' && COUNTRY_RE.test(meta.country)) body.country = meta.country;
  return body;
}

/**
 * Одноразовий токен результату — береться на старті тесту, повертається разом із результатом.
 * Сервер приймає результат лише з токеном, виданим щонайменше кілька секунд тому (див. server/src/tokens.js).
 * @param {string} base document.baseURI
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string | null>} null — сервер недоступний (тоді результат просто не надсилається)
 */
export async function requestToken(base, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(new URL('api/results/token', base).toString(), {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const { token } = await res.json();
    return typeof token === 'string' ? token : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} payload
 * @param {string} base document.baseURI
 * @param {string} token з requestToken()
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<boolean>} чи збережено
 */
export async function submitResult(payload, base, token, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(new URL('api/results', base).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', [RESULT_TOKEN_HEADER]: token },
      body: JSON.stringify(payload),
      keepalive: true, // долетить, навіть якщо сторінку закриють
      signal: AbortSignal.timeout(5000),
    });
    return res.status === 201;
  } catch {
    return false;
  }
}
