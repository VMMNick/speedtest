import { describe, it, expect } from 'vitest';
import { createTokenService } from '../src/tokens.js';

const make = (extra = {}) => {
  const clock = { t: 1_800_000_000_000 };
  const svc = createTokenService({ secret: 's3cret', minAgeMs: 5000, maxAgeMs: 60_000, now: () => clock.t, ...extra });
  return { svc, clock };
};

describe('токени результатів', () => {
  it('приймає токен, старший за minAge, рівно один раз', async () => {
    const { svc, clock } = make();
    const t = svc.issue();
    clock.t += 4999;
    expect(await svc.consume(t)).toEqual({ ok: false, reason: 'too-early' });
    clock.t += 1;
    expect(await svc.consume(t)).toEqual({ ok: true });
    expect(await svc.consume(t)).toEqual({ ok: false, reason: 'reused' });
  });

  it('прострочений токен не приймається', async () => {
    const { svc, clock } = make();
    const t = svc.issue();
    clock.t += 60_001;
    expect(await svc.consume(t)).toEqual({ ok: false, reason: 'expired' });
  });

  it('токен іншого сервера (інший секрет) або змінений час видачі — підпис не збігається', async () => {
    const a = make();
    const b = make({ secret: 'other' });
    const t = a.svc.issue();
    b.clock.t += 10_000;
    expect(await b.svc.consume(t)).toEqual({ ok: false, reason: 'signature' });
    const [issued, nonce, sig] = t.split('.');
    a.clock.t += 10_000;
    expect(await a.svc.consume(`${Number(issued) - 9000}.${nonce}.${sig}`)).toEqual({ ok: false, reason: 'signature' });
  });

  it('з Redis — реєстр використаних токенів спільний (SET NX)', async () => {
    const store = new Map();
    const redis = /** @type {any} */ ({
      set: async (key, _v, _px, _ms, nx) => (nx === 'NX' && store.has(key) ? null : (store.set(key, 1), 'OK')),
    });
    const one = make({ redis });
    const two = make({ redis });
    const t = one.svc.issue();
    one.clock.t += 6000;
    two.clock.t += 6000;
    expect(await one.svc.consume(t)).toEqual({ ok: true });
    expect(await two.svc.consume(t)).toEqual({ ok: false, reason: 'reused' }); // другий інстанс бачить те саме
  });

  it('недоступний Redis не ламає прийом — запасний реєстр у пам’яті', async () => {
    const redis = /** @type {any} */ ({
      set: async () => {
        throw new Error('down');
      },
    });
    const { svc, clock } = make({ redis });
    const t = svc.issue();
    clock.t += 6000;
    expect(await svc.consume(t)).toEqual({ ok: true });
    expect(await svc.consume(t)).toEqual({ ok: false, reason: 'reused' });
  });
});
