/**
 * Специфікація з типовим конфігом (власні ендпоінти вимірювань увімкнено, БД у пам'яті) —
 * детермінована, тож її можна зберігати в репозиторії й порівнювати в тесті.
 */
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

export const SPEC_PATH = new URL('../../../docs/openapi.json', import.meta.url);

export async function buildSpec() {
  const app = await buildApp({ config: loadConfig({ RESULTS_TOKEN_SECRET: 'spec' }), logger: false });
  await app.ready();
  const spec = JSON.stringify(app.swagger(), null, 2);
  await app.close();
  return spec;
}
