/** Спільний набір даних для аналітики: однаковий для пам'яті та PostgreSQL */
const base = { server: 'cloudflare', upload: 50, jitter: 2, loss: 0, grade: 'B', score: 80, country: 'UA' };

const now = Date.now();
/** Понеділок 2026-10-05 21:30 UTC = вівторок 00:30 за Києвом (UTC+3) */
export const MONDAY_LATE_UTC = new Date('2026-10-05T21:30:00Z');

export const SEED = [
  // FastNet (Київ): 4 тести, медіана download 300
  ...[200, 280, 320, 400].map((download) => ({ ...base, isp: 'FastNet', city: 'Kyiv', download, ping: 10 })),
  // SlowNet (Київ): 3 тести, медіана 50
  ...[40, 50, 60].map((download) => ({ ...base, isp: 'SlowNet', city: 'Kyiv', download, ping: 40 })),
  // FastNet (Львів): 3 тести, медіана 500
  ...[450, 500, 550].map((download) => ({ ...base, isp: 'FastNet', city: 'Lviv', download, ping: 8 })),
  // TinyISP: лише 2 тести → прихований (k-анонімність, MIN_SAMPLES = 3)
  ...[900, 950].map((download) => ({ ...base, isp: 'TinyISP', city: 'Odesa', download, ping: 5 })),
].map((r, i) => ({
  result: r,
  // Перші 3 — у «понеділок пізно ввечері UTC», решта — годину тому
  createdAt: i < 3 ? new Date(Math.max(MONDAY_LATE_UTC.getTime(), now - 20 * 86_400_000)) : new Date(now - 3600_000),
}));

export async function seed(repo) {
  for (const { result, createdAt } of SEED) await repo.insert(result, { createdAt });
}
