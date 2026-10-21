/**
 * Одноразові токени для POST /api/results — захист аналітики від підкинутих результатів.
 *
 * Браузер бере токен на старті тесту (GET /api/results/token) і повертає його разом із результатом.
 * Сервер приймає результат, лише якщо токен:
 *   - підписаний цим сервером (HMAC-SHA256),
 *   - старший за minAgeMs (справжній тест триває щонайменше кілька секунд),
 *   - молодший за maxAgeMs,
 *   - ще не використаний (один токен — один результат).
 *
 * Це не криптографічна гарантія чесності вимірювань — навмисний зловмисник може пройти той самий
 * шлях, — але засипати рейтинг фальшивками стає повільно й дорого: кожен результат вимагає
 * окремого токена, очікування і проходить rate limit на обох ендпоінтах.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const b64 = (buf) => buf.toString('base64url');

/**
 * @param {object} opts
 * @param {string} opts.secret спільний для всіх інстансів (RESULTS_TOKEN_SECRET)
 * @param {number} opts.minAgeMs
 * @param {number} opts.maxAgeMs
 * @param {import('ioredis').Redis} [opts.redis] спільний реєстр використаних токенів; без нього — пам'ять процесу
 * @param {() => number} [opts.now]
 */
export function createTokenService({ secret, minAgeMs, maxAgeMs, redis = undefined, now = Date.now }) {
  const sign = (payload) => b64(createHmac('sha256', secret).update(payload).digest()).slice(0, 32);
  /** Використані токени без Redis: nonce → час, коли запис можна забути */
  const usedLocal = new Map();

  /** true — токен щойно позначено використаним; false — його вже використали раніше */
  async function markUsed(nonce) {
    if (redis) {
      try {
        const ok = await redis.set(`speedtest:token:${nonce}`, '1', 'PX', maxAgeMs, 'NX');
        return ok === 'OK';
      } catch {
        /* Redis недоступний — падаємо на пам'ять процесу */
      }
    }
    const t = now();
    for (const [key, until] of usedLocal) if (until < t) usedLocal.delete(key);
    if (usedLocal.has(nonce)) return false;
    usedLocal.set(nonce, t + maxAgeMs);
    return true;
  }

  return {
    minAgeMs,
    maxAgeMs,

    /** @returns {string} `<час видачі>.<nonce>.<підпис>` */
    issue() {
      const payload = `${now()}.${b64(randomBytes(12))}`;
      return `${payload}.${sign(payload)}`;
    },

    /**
     * Перевіряє токен і «гасить» його.
     * @param {unknown} token
     * @returns {Promise<{ ok: true } | { ok: false, reason: 'missing' | 'malformed' | 'signature' | 'too-early' | 'expired' | 'reused' }>}
     */
    async consume(token) {
      if (typeof token !== 'string' || !token) return { ok: false, reason: 'missing' };
      const parts = token.split('.');
      if (parts.length !== 3 || !/^\d{10,}$/.test(parts[0])) return { ok: false, reason: 'malformed' };
      const [issued, nonce, sig] = parts;
      const expected = Buffer.from(sign(`${issued}.${nonce}`));
      const given = Buffer.from(sig);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        return { ok: false, reason: 'signature' };
      }
      const age = now() - Number(issued);
      if (age < minAgeMs) return { ok: false, reason: 'too-early' };
      if (age > maxAgeMs) return { ok: false, reason: 'expired' };
      if (!(await markUsed(nonce))) return { ok: false, reason: 'reused' };
      return { ok: true };
    },
  };
}
