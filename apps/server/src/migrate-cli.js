/** Ручний запуск міграцій: DATABASE_URL=… npm run migrate */
import { createPool, migrate } from './db.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Задайте DATABASE_URL');
  process.exit(1);
}
const pool = createPool(url);
const applied = await migrate(pool);
console.log(applied.length ? `Застосовано: ${applied.join(', ')}` : 'Нових міграцій немає');
await pool.end();
