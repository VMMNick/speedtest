/**
 * Знімок OpenAPI-специфікації → docs/openapi.json (відкривається в Swagger Editor, Postman, генераторах клієнтів).
 * Тест tests/openapi.test.js падає, якщо знімок застарів: `npm run openapi` і закомітити.
 */
import { writeFileSync } from 'node:fs';
import { buildSpec, SPEC_PATH } from '../src/spec-snapshot.js';

writeFileSync(SPEC_PATH, (await buildSpec()) + '\n');
process.stdout.write(`OpenAPI → ${SPEC_PATH.pathname}\n`);
