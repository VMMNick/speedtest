import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resultSchema } from '@speedtest/shared/result-schema';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { buildSpec, SPEC_PATH } from '../src/spec-snapshot.js';
import { TEST_ENV } from './fixtures.js';

describe('OpenAPI', () => {
  let app;
  let spec;
  beforeAll(async () => {
    app = await buildApp({ config: loadConfig(TEST_ENV), logger: false });
    await app.ready();
    spec = app.swagger();
  });
  afterAll(() => app.close());

  const operations = () =>
    Object.entries(spec.paths).flatMap(([path, ops]) =>
      Object.entries(ops).map(([method, op]) => ({ id: `${method.toUpperCase()} ${path}`, op })),
    );

  it('описує всі API-маршрути й не показує статику та сам Swagger UI', () => {
    expect(Object.keys(spec.paths).sort()).toEqual([
      '/api/analytics/cities',
      '/api/analytics/heatmap',
      '/api/analytics/providers',
      '/api/download',
      '/api/health',
      '/api/meta',
      '/api/ping',
      '/api/results',
      '/api/results/stats',
      '/api/results/token',
      '/api/status/incidents',
      '/api/status/providers',
      '/api/upload',
    ]);
  });

  it('кожна операція має тег, короткий опис і унікальний operationId', () => {
    const ids = new Set();
    for (const { id, op } of operations()) {
      expect(op.tags, id).toHaveLength(1);
      expect(op.summary, id).toBeTruthy();
      expect(op.operationId, id).toMatch(/^[a-z][A-Za-z]+$/);
      ids.add(op.operationId);
    }
    expect(ids.size).toBe(operations().length);
  });

  it('тіло POST /api/results — та сама спільна схема, що й у браузера', () => {
    const op = spec.paths['/api/results'].post;
    const body = op.requestBody.content['application/json'].schema;
    expect(body.required).toEqual(resultSchema.required);
    expect(Object.keys(body.properties)).toEqual(Object.keys(resultSchema.properties));
    expect(op.security).toEqual([{ resultToken: [] }]);
    expect(Object.keys(op.responses)).toEqual(expect.arrayContaining(['201', '400', '403', '429']));
  });

  it('знімок docs/openapi.json актуальний (інакше: npm run openapi -w @speedtest/server)', async () => {
    expect(readFileSync(SPEC_PATH, 'utf8').trim()).toBe(await buildSpec());
  });

  it('GET /api/docs віддає Swagger UI, /api/docs/json — специфікацію', async () => {
    const ui = await app.inject('/api/docs/');
    expect(ui.statusCode).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');
    const json = await app.inject('/api/docs/json');
    expect(json.statusCode).toBe(200);
    expect(json.json().info.title).toBe('Спідтест API');
  });
});
