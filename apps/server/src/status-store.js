/**
 * Сховище стану провайдерів: вікна для перевірки, знімок стану, інциденти, очищення старих результатів.
 * Дві реалізації з однаковою поведінкою (як і для результатів у db.js): PostgreSQL і пам'ять.
 * Інтеграційний тест порівнює їх на тих самих даних.
 */
import { percentileCont } from './percentile.js';

const round1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
const iso = (d) => (d ? new Date(d).toISOString() : null);

/**
 * @typedef {import('./status.js').ProviderVerdict} ProviderVerdict
 * @typedef {{ isp: string, from?: string, to: string, action: 'open' | 'close' | null }} Transition
 */

/** @param {import('pg').Pool} pool */
export function pgStatusStore(pool) {
  return {
    /** Медіани «зараз» і «як зазвичай» для кожного провайдера з результатами за період */
    async providerWindows({ now = new Date(), recentHours, baselineDays }) {
      const { rows } = await pool.query(
        `WITH w AS (
           SELECT isp, download_mbps, ping_ms,
                  created_at >= $1::timestamptz - make_interval(hours => $2) AS is_recent
             FROM results
            WHERE isp IS NOT NULL
              AND created_at >  $1::timestamptz - make_interval(days => $3)
              AND created_at <= $1::timestamptz
         )
         SELECT isp,
                count(*) FILTER (WHERE is_recent)::int     AS "recentSamples",
                count(*) FILTER (WHERE NOT is_recent)::int AS "baselineSamples",
                round((percentile_cont(0.5) WITHIN GROUP (ORDER BY download_mbps) FILTER (WHERE is_recent))::numeric, 1)::float     AS "recentDownload",
                round((percentile_cont(0.5) WITHIN GROUP (ORDER BY download_mbps) FILTER (WHERE NOT is_recent))::numeric, 1)::float AS "baselineDownload",
                round((percentile_cont(0.5) WITHIN GROUP (ORDER BY ping_ms) FILTER (WHERE is_recent))::numeric, 1)::float           AS "recentPing",
                round((percentile_cont(0.5) WITHIN GROUP (ORDER BY ping_ms) FILTER (WHERE NOT is_recent))::numeric, 1)::float       AS "baselinePing"
           FROM w
          GROUP BY isp
          ORDER BY isp`,
        [now, recentHours, baselineDays],
      );
      return rows;
    },

    /** Останній збережений знімок */
    async providerStatus() {
      const { rows } = await pool.query(
        `SELECT isp, status,
                recent_download AS "recentDownload", baseline_download AS "baselineDownload",
                recent_ping AS "recentPing", baseline_ping AS "baselinePing",
                recent_samples AS "recentSamples", baseline_samples AS "baselineSamples",
                checked_at AS "checkedAt", since
           FROM provider_status
          ORDER BY isp`,
      );
      return rows.map((r) => ({ ...r, checkedAt: iso(r.checkedAt), since: iso(r.since) }));
    },

    /**
     * Зберігає знімок і відкриває/закриває інциденти — атомарно.
     * Провайдери, яких більше немає у вікнах (немає тестів за базовий період), прибираються.
     * @param {ProviderVerdict[]} verdicts
     * @param {Transition[]} transitions
     * @param {Date} now
     */
    async saveProviderStatus(verdicts, transitions, now) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const v of verdicts) {
          await client.query(
            `INSERT INTO provider_status AS s
               (isp, status, recent_download, baseline_download, recent_ping, baseline_ping,
                recent_samples, baseline_samples, checked_at, since)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
             ON CONFLICT (isp) DO UPDATE SET
               status = EXCLUDED.status,
               recent_download = EXCLUDED.recent_download, baseline_download = EXCLUDED.baseline_download,
               recent_ping = EXCLUDED.recent_ping, baseline_ping = EXCLUDED.baseline_ping,
               recent_samples = EXCLUDED.recent_samples, baseline_samples = EXCLUDED.baseline_samples,
               checked_at = EXCLUDED.checked_at,
               since = CASE WHEN s.status = EXCLUDED.status THEN s.since ELSE EXCLUDED.since END`,
            [
              v.isp,
              v.status,
              v.recentDownload,
              v.baselineDownload,
              v.recentPing,
              v.baselinePing,
              v.recentSamples,
              v.baselineSamples,
              now,
            ],
          );
        }
        const isps = verdicts.map((v) => v.isp);
        await client.query('DELETE FROM provider_status WHERE NOT (isp = ANY($1::text[]))', [isps]);
        await client.query(
          'UPDATE provider_incidents SET ended_at = $2 WHERE ended_at IS NULL AND NOT (isp = ANY($1::text[]))',
          [isps, now],
        );

        const byIsp = new Map(verdicts.map((v) => [v.isp, v]));
        for (const t of transitions) {
          const v = byIsp.get(t.isp);
          if (t.action === 'open') {
            await client.query(
              `INSERT INTO provider_incidents
                 (isp, started_at, reasons, recent_download, baseline_download, recent_ping, baseline_ping)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (isp) WHERE ended_at IS NULL DO NOTHING`,
              [t.isp, now, v.reasons, v.recentDownload, v.baselineDownload, v.recentPing, v.baselinePing],
            );
          } else if (t.action === 'close') {
            await client.query('UPDATE provider_incidents SET ended_at = $2 WHERE isp = $1 AND ended_at IS NULL', [
              t.isp,
              now,
            ]);
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    /** Інциденти, що почалися за останні N днів, і всі ще відкриті */
    async incidents({ days = 30, now = new Date() } = {}) {
      const { rows } = await pool.query(
        `SELECT id::int, isp, started_at AS "startedAt", ended_at AS "endedAt", reasons,
                recent_download AS "recentDownload", baseline_download AS "baselineDownload",
                recent_ping AS "recentPing", baseline_ping AS "baselinePing"
           FROM provider_incidents
          WHERE ended_at IS NULL OR started_at > $1::timestamptz - make_interval(days => $2)
          ORDER BY started_at DESC, id DESC
          LIMIT 50`,
        [now, days],
      );
      return rows.map((r) => ({ ...r, startedAt: iso(r.startedAt), endedAt: iso(r.endedAt) }));
    },

    /** Політика зберігання: анонімні результати старші за N днів видаляються */
    async deleteResultsOlderThan(days, now = new Date()) {
      const { rowCount } = await pool.query(
        'DELETE FROM results WHERE created_at < $1::timestamptz - make_interval(days => $2)',
        [now, days],
      );
      return rowCount ?? 0;
    },
  };
}

/**
 * Та сама поведінка в пам'яті — над масивом результатів memoryRepository.
 * @param {{ download: number, ping: number, isp?: string, createdAt: string }[]} results
 */
export function memoryStatusStore(results) {
  /** @type {Map<string, any>} */
  const status = new Map();
  /** @type {any[]} */
  const incidents = [];
  const median = (list) => (list.length ? round1(percentileCont(list, 0.5)) : null);

  return {
    async providerWindows({ now = new Date(), recentHours, baselineDays }) {
      const t = now.getTime();
      const from = t - baselineDays * 86_400_000;
      const recentFrom = t - recentHours * 3_600_000;
      const groups = new Map();
      for (const r of results) {
        const at = Date.parse(r.createdAt);
        if (!r.isp || at <= from || at > t) continue;
        if (!groups.has(r.isp)) groups.set(r.isp, { recent: [], base: [] });
        groups.get(r.isp)[at >= recentFrom ? 'recent' : 'base'].push(r);
      }
      return [...groups]
        .map(([isp, { recent, base }]) => ({
          isp,
          recentSamples: recent.length,
          baselineSamples: base.length,
          recentDownload: median(recent.map((r) => r.download)),
          baselineDownload: median(base.map((r) => r.download)),
          recentPing: median(recent.map((r) => r.ping)),
          baselinePing: median(base.map((r) => r.ping)),
        }))
        .sort((a, b) => (a.isp < b.isp ? -1 : a.isp > b.isp ? 1 : 0));
    },

    async providerStatus() {
      return [...status.values()].sort((a, b) => (a.isp < b.isp ? -1 : 1)).map((s) => ({ ...s }));
    },

    async saveProviderStatus(verdicts, transitions, now) {
      const at = now.toISOString();
      const keep = new Set(verdicts.map((v) => v.isp));
      for (const v of verdicts) {
        const prev = status.get(v.isp);
        status.set(v.isp, {
          isp: v.isp,
          status: v.status,
          recentDownload: v.recentDownload,
          baselineDownload: v.baselineDownload,
          recentPing: v.recentPing,
          baselinePing: v.baselinePing,
          recentSamples: v.recentSamples,
          baselineSamples: v.baselineSamples,
          checkedAt: at,
          since: prev && prev.status === v.status ? prev.since : at,
        });
      }
      for (const isp of status.keys()) if (!keep.has(isp)) status.delete(isp);
      for (const i of incidents) if (!i.endedAt && !keep.has(i.isp)) i.endedAt = at;

      const byIsp = new Map(verdicts.map((v) => [v.isp, v]));
      for (const t of transitions) {
        const open = incidents.find((i) => i.isp === t.isp && !i.endedAt);
        const v = byIsp.get(t.isp);
        if (t.action === 'open' && !open) {
          incidents.push({
            id: incidents.length + 1,
            isp: t.isp,
            startedAt: at,
            endedAt: null,
            reasons: v.reasons,
            recentDownload: v.recentDownload,
            baselineDownload: v.baselineDownload,
            recentPing: v.recentPing,
            baselinePing: v.baselinePing,
          });
        } else if (t.action === 'close' && open) {
          open.endedAt = at;
        }
      }
    },

    async incidents({ days = 30, now = new Date() } = {}) {
      const from = now.getTime() - days * 86_400_000;
      return incidents
        .filter((i) => !i.endedAt || Date.parse(i.startedAt) > from)
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || b.id - a.id)
        .slice(0, 50)
        .map((i) => ({ ...i }));
    },

    async deleteResultsOlderThan(days, now = new Date()) {
      const limit = now.getTime() - days * 86_400_000;
      const before = results.length;
      for (let i = results.length - 1; i >= 0; i--) if (Date.parse(results[i].createdAt) < limit) results.splice(i, 1);
      return before - results.length;
    },
  };
}
