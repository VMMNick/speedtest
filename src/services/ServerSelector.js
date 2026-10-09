/**
 * ServerSelector — обирає сервер із найменшою затримкою
 * та отримує метадані (місто, провайдер, IP).
 */
import { SERVERS } from '../core/config.js';
import { median } from '../core/MetricsCalculator.js';

export class ServerSelector {
  /**
   * @param {object} [opts]
   * @param {import('../core/types.js').Server[]} [opts.servers]
   * @param {typeof fetch} [opts.fetchImpl]
   * @param {() => number} [opts.now]
   */
  constructor({ servers = SERVERS, fetchImpl = undefined, now = undefined } = {}) {
    this.servers = servers;
    this.fetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.now = now ?? (() => performance.now());
  }

  /** Медіанний RTT до сервера або Infinity, якщо недоступний. */
  async probe(server, attempts = 3, timeoutMs = 2500) {
    const rtts = [];
    for (let i = 0; i < attempts; i++) {
      const c = new AbortController();
      const timer = setTimeout(() => c.abort(), timeoutMs);
      const t0 = this.now();
      try {
        const res = await this.fetch(server.pingUrl, { cache: 'no-store', signal: c.signal });
        await res.arrayBuffer();
        if (i > 0 || attempts === 1) rtts.push(this.now() - t0); // перший — прогрів з'єднання
      } catch {
        /* недоступний */
      } finally {
        clearTimeout(timer);
      }
    }
    return rtts.length ? median(rtts) : Infinity;
  }

  /** Паралельно пінгує всіх кандидатів і повертає найкращого. */
  async selectBest() {
    const probes = await Promise.all(this.servers.map(async (s) => ({ server: s, latency: await this.probe(s) })));
    probes.sort((a, b) => a.latency - b.latency);
    const best = probes[0];
    if (!best || !Number.isFinite(best.latency)) {
      return { server: this.servers[0], latency: null, reachable: false };
    }
    return { ...best, reachable: true };
  }

  /** Метадані з'єднання: точка присутності, місто, провайдер, IP. */
  async fetchMeta(server) {
    if (!server.metaUrl) return null;
    try {
      const res = await this.fetch(server.metaUrl, { cache: 'no-store' });
      if (!res.ok) return null;
      const m = await res.json();
      return {
        ip: text(m.clientIp),
        isp: text(m.asOrganization),
        asn: m.asn ?? null,
        city: text(m.city),
        country: text(m.country),
        colo: coloCode(m.colo),
      };
    } catch {
      return null;
    }
  }
}

/** Рядок або null — щоб в інтерфейс ніколи не потрапило «[object Object]» */
function text(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null;
}

/**
 * Код точки присутності Cloudflare. Раніше `colo` був рядком («WAW»),
 * тепер може приходити об'єктом ({ iata: 'WAW', city: 'Warsaw', … }).
 * @param {unknown} colo
 * @returns {string | null}
 */
export function coloCode(colo) {
  if (colo && typeof colo === 'object') {
    const o = /** @type {Record<string, unknown>} */ (colo);
    return text(o.iata) ?? text(o.code) ?? text(o.id) ?? text(o.city) ?? text(o.name);
  }
  return text(colo);
}
