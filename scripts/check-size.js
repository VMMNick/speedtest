/**
 * Бюджет розміру бандла (gzip). Запускається після `npm run build`.
 * Падає з кодом 1, якщо щось перевищило ліміт, — так CI ловить випадкове
 * «розростання» стартового JS (напр. статичний імпорт Chart.js).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
const KB = 1024;

/** Ліміти в байтах gzip */
const BUDGET = {
  'initial JS': 20 * KB, // те, що блокує перший показ
  'initial CSS': 12 * KB,
  'lazy chunks (each)': 70 * KB,
  worker: 10 * KB,
};

const gz = (file) => gzipSync(readFileSync(join(DIST, file))).length;
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const assets = readdirSync(join(DIST, 'assets'));

const initialJs = [...html.matchAll(/<script[^>]+src="[^"]*?(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
const preloads = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="[^"]*?(assets\/[^"]+\.js)"/g)].map(
  (m) => m[1],
);
const initialCss = [...html.matchAll(/<link[^>]+href="[^"]*?(assets\/[^"]+\.css)"/g)].map((m) => m[1]);
const initialSet = new Set([...initialJs, ...preloads].map((f) => f.replace('assets/', '')));
const lazy = assets.filter((f) => f.endsWith('.js') && !initialSet.has(f) && !f.startsWith('speed.worker'));
const worker = assets.filter((f) => f.startsWith('speed.worker') && f.endsWith('.js'));

const sum = (files) => files.reduce((s, f) => s + gz(f), 0);
const rows = [
  ['initial JS', sum([...initialJs, ...preloads]), BUDGET['initial JS'], [...initialJs, ...preloads].join(', ')],
  ['initial CSS', sum(initialCss), BUDGET['initial CSS'], initialCss.join(', ')],
  ...lazy.map((f) => ['lazy chunks (each)', gz(`assets/${f}`), BUDGET['lazy chunks (each)'], f]),
  ...worker.map((f) => ['worker', gz(`assets/${f}`), BUDGET.worker, f]),
];

let failed = false;
const fmt = (b) => `${(b / KB).toFixed(1)} KB`.padStart(9);
for (const [name, size, limit, files] of rows) {
  const ok = size <= limit;
  failed ||= !ok;
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(19)} ${fmt(size)} / ${fmt(limit)}  ${files}`);
}
if (failed) {
  console.error('\nБюджет розміру перевищено.');
  process.exit(1);
}
