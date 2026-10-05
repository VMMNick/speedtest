/**
 * PostgreSQL: пул з'єднань, міграції та репозиторій результатів.
 */
import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { resolveTimeZone } from './timezones.js';

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url);
/** Довільне число для pg_advisory_lock: кілька інстансів не запустять міграції одночасно */
const MIGRATION_LOCK = 4_242_001;

export function createPool(databaseUrl) {
  return new pg.Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30_000 });
}

/**
 * Застосовує ще не застосовані *.sql з migrations/ по черзі, кожну — в транзакції.
 * @returns {Promise<string[]>} імена застосованих міграцій
 */
export async function migrate(pool, log = console) {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
        log.info?.(`migration applied: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {});
    client.release();
  }
  return applied;
}

/**
 * @typedef {object} ResultInput
 * @property {string} server
 * @property {number} download
 * @property {number} upload
 * @property {number} ping
 * @property {number} jitter
 * @property {number} loss
 * @property {string} grade
 * @property {number} score
 * @property {number} [bufferbloat]
 * @property {string} [isp]
 * @property {string} [city]
 * @property {string} [country]
 * @property {boolean} [lightMode]
 */

/** Репозиторій поверх PostgreSQL */
export function pgRepository(pool) {
  /** @type {Promise<Set<string>> | null} назви поясів, які знає ця БД (кешуються) */
  let zones = null;
  const knownZones = () =>
    (zones ??= pool
      .query('SELECT name FROM pg_timezone_names')
      .then(({ rows }) => new Set(['UTC', ...rows.map((r) => r.name)])));

  return {
    /** @param {ResultInput} r @param {{ createdAt?: Date }} [opts] createdAt — лише для тестів/імпорту */
    async insert(r, { createdAt = null } = {}) {
      const { rows } = await pool.query(
        `INSERT INTO results
          (server, download_mbps, upload_mbps, ping_ms, jitter_ms, loss_pct, grade, score,
           bufferbloat_ms, isp, city, country, light_mode, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, coalesce($14::timestamptz, now()))
         RETURNING id, created_at`,
        [
          r.server,
          r.download,
          r.upload,
          r.ping,
          r.jitter,
          r.loss,
          r.grade,
          Math.round(r.score),
          r.bufferbloat ?? null,
          r.isp ?? null,
          r.city ?? null,
          r.country ?? null,
          Boolean(r.lightMode),
          createdAt,
        ],
      );
      return { id: Number(rows[0].id), createdAt: rows[0].created_at.toISOString() };
    },

    /** Зведення за останні N днів */
    async stats(days = 30) {
      const { rows } = await pool.query(
        `SELECT count(*)::int                                            AS count,
                coalesce(round(avg(download_mbps)::numeric, 1), 0)::float AS "avgDownload",
                coalesce(round(avg(upload_mbps)::numeric, 1), 0)::float   AS "avgUpload",
                coalesce(round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ping_ms)::numeric, 1), 0)::float AS "medianPing"
           FROM results
          WHERE created_at > now() - make_interval(days => $1)`,
        [days],
      );
      return rows[0];
    },

    /** Рейтинг провайдерів (групи з < minSamples тестів приховуються — k-анонімність) */
    async providers({ days = 30, city = null, minSamples = 3 } = {}) {
      const { rows } = await pool.query(
        `SELECT isp,
                count(*)::int AS samples,
                round(percentile_cont(0.5) WITHIN GROUP (ORDER BY download_mbps)::numeric, 1)::float AS "medianDownload",
                round(percentile_cont(0.9) WITHIN GROUP (ORDER BY download_mbps)::numeric, 1)::float AS "p90Download",
                round(percentile_cont(0.5) WITHIN GROUP (ORDER BY upload_mbps)::numeric, 1)::float   AS "medianUpload",
                round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ping_ms)::numeric, 1)::float       AS "medianPing",
                round(avg(score))::int AS "avgScore"
           FROM results
          WHERE created_at > now() - make_interval(days => $1)
            AND isp IS NOT NULL
            AND ($2::text IS NULL OR city = $2)
          GROUP BY isp
         HAVING count(*) >= $3
          ORDER BY "medianDownload" DESC, samples DESC
          LIMIT 50`,
        [days, city, minSamples],
      );
      return rows;
    },

    /** Міста для фільтра */
    async cities({ days = 30, minSamples = 3 } = {}) {
      const { rows } = await pool.query(
        `SELECT city, max(country) AS country, count(*)::int AS samples
           FROM results
          WHERE created_at > now() - make_interval(days => $1) AND city IS NOT NULL
          GROUP BY city
         HAVING count(*) >= $2
          ORDER BY samples DESC, city
          LIMIT 100`,
        [days, minSamples],
      );
      return rows;
    },

    /** Медіанна швидкість за днем тижня (1 = Пн … 7 = Нд) і годиною — у часовому поясі клієнта */
    async heatmap({ days = 30, tz = 'UTC', isp = null, city = null } = {}) {
      tz = resolveTimeZone(tz, await knownZones());
      const { rows } = await pool.query(
        `SELECT extract(isodow FROM created_at AT TIME ZONE $2)::int AS dow,
                extract(hour   FROM created_at AT TIME ZONE $2)::int AS hour,
                count(*)::int AS samples,
                round(percentile_cont(0.5) WITHIN GROUP (ORDER BY download_mbps)::numeric, 1)::float AS "medianDownload"
           FROM results
          WHERE created_at > now() - make_interval(days => $1)
            AND ($3::text IS NULL OR isp = $3)
            AND ($4::text IS NULL OR city = $4)
          GROUP BY 1, 2
          ORDER BY 1, 2`,
        [days, tz, isp, city],
      );
      return rows;
    },

    async ping() {
      await pool.query('SELECT 1');
    },
  };
}

/** Репозиторій у пам'яті — для запуску без БД і для тестів */
export function memoryRepository() {
  const rows = [];
  return {
    rows,
    /** @param {ResultInput} r @param {{ createdAt?: Date }} [opts] createdAt — для тестів */
    async insert(r, { createdAt = new Date() } = {}) {
      const row = { id: rows.length + 1, ...r, createdAt: createdAt.toISOString() };
      rows.push(row);
      return { id: row.id, createdAt: row.createdAt };
    },
    async stats() {
      const avg = (k) => (rows.length ? Math.round((rows.reduce((s, r) => s + r[k], 0) / rows.length) * 10) / 10 : 0);
      return {
        count: rows.length,
        avgDownload: avg('download'),
        avgUpload: avg('upload'),
        medianPing: round1(
          percentileCont(
            rows.map((r) => r.ping),
            0.5,
          ),
        ),
      };
    },
    async providers({ days = 30, city = null, minSamples = 3 } = {}) {
      const groups = groupBy(
        recent(rows, days).filter((r) => r.isp && (!city || r.city === city)),
        (r) => r.isp,
      );
      return [...groups]
        .filter(([, list]) => list.length >= minSamples)
        .map(([isp, list]) => ({
          isp,
          samples: list.length,
          medianDownload: round1(
            percentileCont(
              list.map((r) => r.download),
              0.5,
            ),
          ),
          p90Download: round1(
            percentileCont(
              list.map((r) => r.download),
              0.9,
            ),
          ),
          medianUpload: round1(
            percentileCont(
              list.map((r) => r.upload),
              0.5,
            ),
          ),
          medianPing: round1(
            percentileCont(
              list.map((r) => r.ping),
              0.5,
            ),
          ),
          avgScore: Math.round(list.reduce((s, r) => s + r.score, 0) / list.length),
        }))
        .sort((a, b) => b.medianDownload - a.medianDownload || b.samples - a.samples)
        .slice(0, 50);
    },
    async cities({ days = 30, minSamples = 3 } = {}) {
      const groups = groupBy(
        recent(rows, days).filter((r) => r.city),
        (r) => r.city,
      );
      return [...groups]
        .filter(([, list]) => list.length >= minSamples)
        .map(([city, list]) => ({ city, country: list.find((r) => r.country)?.country ?? null, samples: list.length }))
        .sort((a, b) => b.samples - a.samples || a.city.localeCompare(b.city));
    },
    async heatmap({ days = 30, tz = 'UTC', isp = null, city = null } = {}) {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        weekday: 'short',
        hour: 'numeric',
        hourCycle: 'h23',
      });
      const DOW = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
      const groups = groupBy(
        recent(rows, days).filter((r) => (!isp || r.isp === isp) && (!city || r.city === city)),
        (r) => {
          const parts = Object.fromEntries(fmt.formatToParts(new Date(r.createdAt)).map((p) => [p.type, p.value]));
          return `${DOW[parts.weekday]}:${Number(parts.hour)}`;
        },
      );
      return [...groups]
        .map(([key, list]) => {
          const [dow, hour] = key.split(':').map(Number);
          return {
            dow,
            hour,
            samples: list.length,
            medianDownload: round1(
              percentileCont(
                list.map((r) => r.download),
                0.5,
              ),
            ),
          };
        })
        .sort((a, b) => a.dow - b.dow || a.hour - b.hour);
    },
    async ping() {},
  };
}

// ───────── допоміжне для репозиторію в пам'яті (поведінка = SQL) ─────────

const round1 = (x) => Math.round(x * 10) / 10;

/** Як percentile_cont у PostgreSQL: лінійна інтерполяція між сусідніми значеннями */
export function percentileCont(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function groupBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

const recent = (rows, days) => rows.filter((r) => Date.now() - Date.parse(r.createdAt) < days * 86_400_000);
