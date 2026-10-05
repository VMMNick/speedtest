/**
 * Поділитися результатом через посилання.
 *
 * Результат кодується в hash (#r=…) — на сервер нічого не відправляється
 * і нічого не зберігається: усе посилання самодостатнє.
 * IP-адреса та провайдер у посилання НЕ потрапляють.
 */

const VERSION = 1;
const GRADES = ['A', 'B', 'C', 'D', 'F'];

/**
 * @typedef {object} SharedResult
 * @property {number} t   timestamp, мс
 * @property {number} d   download, Мбіт/с
 * @property {number} u   upload, Мбіт/с
 * @property {number} p   пінг (медіана), мс
 * @property {number} j   джиттер, мс
 * @property {number} l   втрати, %
 * @property {number} s   стабільність 0–100
 * @property {string} g   оцінка A–F
 * @property {string} [n] назва сервера
 */

const round = (x, digits = 1) => Math.round(x * 10 ** digits) / 10 ** digits;

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/**
 * Повний результат тесту → компактний рядок для посилання.
 * @param {import('./types.js').TestResult} r
 */
export function encodeResult(r) {
  /** @type {SharedResult & { v: number }} */
  const data = {
    v: VERSION,
    t: r.timestamp,
    d: round(r.download.mbps),
    u: round(r.upload.mbps),
    p: round(r.ping.median),
    j: round(r.ping.jitter),
    l: round(r.ping.loss),
    s: Math.round(r.stability.score),
    g: r.stability.grade,
    n: r.server?.name,
  };
  return toBase64Url(JSON.stringify(data));
}

const inRange = (x, lo, hi) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;

/**
 * Рядок із посилання → результат, або null якщо дані пошкоджені чи підозрілі.
 * Дані з URL — недовірені: перевіряємо типи й діапазони, рядки обрізаємо.
 * @param {string} str
 * @returns {SharedResult | null}
 */
export function decodeResult(str) {
  if (typeof str !== 'string' || !str || str.length > 1000) return null;
  let data;
  try {
    data = JSON.parse(fromBase64Url(str));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || data.v !== VERSION) return null;
  const ok =
    inRange(data.t, 1_500_000_000_000, 10_000_000_000_000) &&
    inRange(data.d, 0, 100_000) &&
    inRange(data.u, 0, 100_000) &&
    inRange(data.p, 0, 60_000) &&
    inRange(data.j, 0, 60_000) &&
    inRange(data.l, 0, 100) &&
    inRange(data.s, 0, 100) &&
    GRADES.includes(data.g);
  if (!ok) return null;
  const name = typeof data.n === 'string' ? data.n.slice(0, 40) : undefined;
  return { t: data.t, d: data.d, u: data.u, p: data.p, j: data.j, l: data.l, s: data.s, g: data.g, n: name };
}

/**
 * Посилання на результат на основі поточної адреси сторінки.
 * @param {import('./types.js').TestResult} r
 * @param {string} pageUrl
 */
export function shareUrl(r, pageUrl) {
  const url = new URL(pageUrl);
  url.hash = `r=${encodeResult(r)}`;
  return url.toString();
}

/**
 * Дістає результат із location.hash.
 * @param {string} hash напр. "#r=eyJ2Ijox…"
 * @returns {SharedResult | null | undefined} undefined — у hash немає результату; null — є, але пошкоджений
 */
export function parseShareHash(hash) {
  const m = /^#r=([A-Za-z0-9_-]+)$/.exec(hash || '');
  if (!m) return hash?.startsWith('#r=') ? null : undefined;
  return decodeResult(m[1]);
}
