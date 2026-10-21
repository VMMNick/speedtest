/**
 * Схема архітектури для README: docs/media/architecture-{light,dark}.svg
 *
 *   node scripts/architecture-svg.js
 *
 * Mermaid на GitHub розкладає цю схему з перехрещеннями, тому вона намальована вручну.
 * Дві теми — README підставляє потрібну через <picture> і prefers-color-scheme.
 */
import { writeFileSync } from 'node:fs';

const THEMES = {
  light: { bg: '#ffffff', panel: '#f6f8fa', edge: '#8c959f', ink: '#1f2328', quiet: '#59636e', accent: '#0969da' },
  dark: { bg: '#0d1117', panel: '#151b23', edge: '#6e7681', ink: '#e6edf3', quiet: '#9198a1', accent: '#4493f8' },
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function svg(c) {
  const box = (x, y, w, h, name, lines = [], accent = false) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${accent ? c.accent : 'none'}" fill-opacity="${accent ? 0.1 : 1}" stroke="${accent ? c.accent : c.edge}" stroke-width="${accent ? 1.75 : 1.25}"/>` +
    `<text x="${x + 16}" y="${y + 24}" font-weight="600" fill="${c.ink}">${esc(name)}</text>` +
    lines
      .map((l, i) => `<text x="${x + 16}" y="${y + 42 + 16 * i}" font-size="11.5" fill="${c.quiet}">${esc(l)}</text>`)
      .join('');
  const label = (x, y, t, anchor = 'middle') =>
    `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="11.5" fill="${c.quiet}">${esc(t)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 412" width="760" font-family="-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="13">
<rect width="760" height="412" rx="12" fill="${c.bg}"/>
<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${c.edge}"/></marker></defs>
<text x="24" y="34" font-size="15" font-weight="600" fill="${c.ink}">${esc('Байти тесту йдуть до Cloudflare, сервер отримує лише результат')}</text>
<rect x="24" y="60" width="260" height="236" rx="10" fill="${c.panel}" stroke="${c.edge}" stroke-width="1"/>
<text x="40" y="84" font-weight="600" fill="${c.ink}">Браузер</text>
<g fill="none" stroke="${c.edge}" stroke-width="1.25">
<path d="M154 174V204" marker-start="url(#a)" marker-end="url(#a)"/>
<path d="M268 138H440" marker-end="url(#a)"/>
<path d="M268 242H440" marker-end="url(#a)"/>
<path d="M510 278V328" marker-end="url(#a)"/>
<path d="M666 278V328" marker-end="url(#a)"/>
<path d="M284 356H440" stroke-dasharray="4 4" marker-end="url(#a)"/>
</g>
${box(40, 100, 228, 74, 'Web Worker', ['NetworkEngine: пінг,', 'download, upload, bufferbloat'])}
${box(40, 204, 228, 74, 'Інтерфейс', ['датчик, графіки, підсумок', 'історія в IndexedDB'])}
${box(440, 100, 296, 74, 'Cloudflare speed API', ['__down · __up · meta', 'anycast, найближча точка присутності'], true)}
${box(440, 204, 296, 74, 'Fastify на Render', ['/api/results · /api/analytics', 'JSON Schema спільна з браузером'])}
${box(440, 328, 140, 58, 'PostgreSQL', ['Neon'])}
${box(596, 328, 140, 58, 'Redis', ['кеш і rate limit'])}
${box(24, 328, 260, 58, 'GitHub Actions', ['щоночі pg_dump → артефакт на 30 днів'])}
${label(164, 194, 'postMessage', 'start')}
${label(354, 130, 'байти тесту')}
${label(354, 234, 'результат, за згодою')}
${label(362, 348, 'бекап')}
</svg>
`;
}

for (const [name, c] of Object.entries(THEMES)) {
  writeFileSync(`docs/media/architecture-${name}.svg`, svg(c));
  console.log(`✓ docs/media/architecture-${name}.svg`);
}
