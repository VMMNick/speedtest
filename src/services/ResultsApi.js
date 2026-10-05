/**
 * Надсилання анонімного результату на власний сервер (POST /api/results).
 * Працює лише у збірці з VITE_RESULTS_API=true і за згодою користувача.
 * IP-адреса не надсилається; провайдер/місто/країна — лише якщо їх повернув /meta.
 */

/**
 * Перетворює результат тесту на тіло запиту (суворо за схемою сервера).
 * @param {import('../core/types.js').TestResult} r
 * @param {{ isp?: string | null, city?: string | null, country?: string | null } | null} meta
 * @param {{ lightMode?: boolean }} [extra]
 */
export function toPayload(r, meta, { lightMode = false } = {}) {
  const round = (x) => Math.round(x * 100) / 100;
  /** @type {Record<string, unknown>} */
  const body = {
    server: r.server?.id === 'self' ? 'self' : 'cloudflare',
    download: round(r.download.mbps),
    upload: round(r.upload.mbps),
    ping: round(r.ping.median),
    jitter: round(r.ping.jitter),
    loss: round(r.ping.loss),
    grade: r.stability.grade,
    score: Math.round(r.stability.score),
    bufferbloat: round(r.bufferbloat?.delta ?? 0),
    lightMode,
  };
  if (meta?.isp) body.isp = String(meta.isp).slice(0, 100);
  if (meta?.city) body.city = String(meta.city).slice(0, 100);
  if (meta?.country && /^[A-Z]{2}$/.test(meta.country)) body.country = meta.country;
  return body;
}

/**
 * @param {object} payload
 * @param {string} base document.baseURI
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<boolean>} чи збережено
 */
export async function submitResult(payload, base, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(new URL('api/results', base).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true, // долетить, навіть якщо сторінку закриють
      signal: AbortSignal.timeout(5000),
    });
    return res.status === 201;
  } catch {
    return false;
  }
}
