/**
 * PostgreSQL: пул з'єднань, міграції та репозиторій результатів.
 */
import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';

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
  return {
    /** @param {ResultInput} r */
    async insert(r) {
      const { rows } = await pool.query(
        `INSERT INTO results
          (server, download_mbps, upload_mbps, ping_ms, jitter_ms, loss_pct, grade, score,
           bufferbloat_ms, isp, city, country, light_mode)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
    async insert(r) {
      const row = { id: rows.length + 1, createdAt: new Date().toISOString(), ...r };
      rows.push(row);
      return { id: row.id, createdAt: row.createdAt };
    },
    async stats() {
      const avg = (k) => (rows.length ? Math.round((rows.reduce((s, r) => s + r[k], 0) / rows.length) * 10) / 10 : 0);
      const pings = rows.map((r) => r.ping).sort((a, b) => a - b);
      return {
        count: rows.length,
        avgDownload: avg('download'),
        avgUpload: avg('upload'),
        medianPing: pings.length ? pings[Math.floor((pings.length - 1) / 2)] : 0,
      };
    },
    async ping() {},
  };
}
