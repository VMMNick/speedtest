/**
 * Vite-плагін: додає Content-Security-Policy як <meta> у продакшн-збірку.
 *
 * GitHub Pages не дозволяє задавати HTTP-заголовки, тому CSP передається через meta.
 * Хеші inline-скриптів (напр. встановлення теми до першого відмальовування)
 * рахуються автоматично з фінального HTML — їх не треба оновлювати вручну.
 * У dev-режимі CSP не додається: HMR-клієнт Vite використовує inline-стилі.
 */
import { createHash } from 'node:crypto';

/** Джерела, з якими застосунок має право спілкуватися. */
export const CSP_SOURCES = {
  connect: ['https://speed.cloudflare.com'],
  styles: ['https://fonts.googleapis.com'],
  fonts: ['https://fonts.gstatic.com'],
};

const sha256 = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

/**
 * @param {string} html
 * @returns {string} значення CSP для цього HTML
 */
export function buildPolicy(html) {
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .filter((code) => code.trim());

  const directives = {
    'default-src': ["'none'"],
    'script-src': ["'self'", ...inlineScripts.map(sha256)],
    'worker-src': ["'self'"],
    'style-src': ["'self'", ...CSP_SOURCES.styles],
    'font-src': CSP_SOURCES.fonts,
    'img-src': ["'self'", 'data:'],
    'connect-src': ["'self'", ...CSP_SOURCES.connect],
    'manifest-src': ["'self'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
    'object-src': ["'none'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
}

/** @returns {import('vite').Plugin} */
export default function cspPlugin() {
  return {
    name: 'speedtest:csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const policy = buildPolicy(html);
        const tags = [
          `<meta http-equiv="Content-Security-Policy" content="${policy}" />`,
          `<meta name="referrer" content="strict-origin-when-cross-origin" />`,
        ].join('\n    ');
        // CSP має стояти якомога раніше — до будь-яких скриптів і стилів
        return html.replace(/(<meta charset="[^"]*"\s*\/?>)/i, `$1\n    ${tags}`);
      },
    },
  };
}
