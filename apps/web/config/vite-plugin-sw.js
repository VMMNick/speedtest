/**
 * Vite-плагін: генерує dist/sw.js зі списком файлів для precache.
 *
 * Без workbox — ~60 рядків власного service worker (config/sw-template.js).
 * Версія кешу = хеш списку файлів, тож кожна нова збірка інвалідує старий кеш.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Шрифти не precache-имо: потрібні лише 2 підмножини з 13, їх закешує runtime-кеш */
const SKIP = [/\.woff2?$/, /\.map$/, /\.md$/, /^sw\.js$/, /^robots\.txt$/];

/** Рекурсивний список файлів директорії (шляхи відносно неї, з «/») */
export function listFiles(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full, base) : [relative(base, full).split('\\').join('/')];
  });
}

/**
 * @param {string[]} files шляхи відносно кореня сайту
 * @returns {string[]} відносні URL для precache (+ сама сторінка)
 */
export function precacheList(files) {
  const list = files.filter((f) => !SKIP.some((re) => re.test(f))).sort();
  return ['./', ...list];
}

/** @returns {import('vite').Plugin} */
export default function serviceWorker({ publicDir }) {
  return {
    name: 'speedtest:sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = precacheList([...Object.keys(bundle), ...listFiles(publicDir)]);
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 10);
      const template = readFileSync(new URL('./sw-template.js', import.meta.url), 'utf8');
      const source =
        `const VERSION = ${JSON.stringify(version)};\n` +
        `const PRECACHE = ${JSON.stringify(files, null, 2)};\n\n` +
        template.replace(/^\/\* global[^*]*\*\/\n/, '');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
