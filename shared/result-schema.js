/**
 * Контракт «клієнт ↔ сервер» для анонімних результатів (POST /api/results).
 *
 * Єдине джерело правди: сервер валідує тіло запиту цією JSON Schema,
 * а фронтенд (`src/services/ResultsApi.js`) формує тіло за тими ж межами.
 * Модуль не має залежностей — його імпортують і браузер, і Node.
 */

/** Межі числових полів (включно) */
export const RESULT_LIMITS = Object.freeze({
  download: 100_000, // Мбіт/с
  upload: 100_000,
  ping: 60_000, // мс
  jitter: 60_000,
  loss: 100, // %
  score: 100,
  bufferbloat: 60_000,
});

/** Заголовок з одноразовим токеном, отриманим з GET /api/results/token на старті тесту */
export const RESULT_TOKEN_HEADER = 'x-result-token';

/** Максимальна довжина текстових полів */
export const TEXT_MAX = 100;

export const SERVER_KINDS = /** @type {const} */ (['self', 'cloudflare']);
export const GRADES = /** @type {const} */ (['A', 'B', 'C', 'D', 'F']);
export const COUNTRY_RE = /^[A-Z]{2}$/;

const num = (max) => ({ type: 'number', minimum: 0, maximum: max });
const text = { type: 'string', maxLength: TEXT_MAX };

export const resultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['server', 'download', 'upload', 'ping', 'jitter', 'loss', 'grade', 'score'],
  properties: {
    server: { type: 'string', enum: [...SERVER_KINDS] },
    download: num(RESULT_LIMITS.download),
    upload: num(RESULT_LIMITS.upload),
    ping: num(RESULT_LIMITS.ping),
    jitter: num(RESULT_LIMITS.jitter),
    loss: num(RESULT_LIMITS.loss),
    grade: { type: 'string', enum: [...GRADES] },
    score: num(RESULT_LIMITS.score),
    bufferbloat: num(RESULT_LIMITS.bufferbloat),
    isp: text,
    city: text,
    country: { type: 'string', pattern: COUNTRY_RE.source },
    lightMode: { type: 'boolean' },
  },
};
