/**
 * PNG-картка результату (1200×630 — стандартний розмір прев'ю для соцмереж).
 * Малюється на <canvas> без сторонніх бібліотек; модуль вантажиться ліниво.
 */
import { formatMbps, formatMs, valueToFraction } from './UIController.js';
import { CONFIG } from '../core/config.js';

const W = 1200;
const H = 630;
const COLORS = {
  bg1: '#0b1020',
  bg2: '#16204a',
  text: '#e8ecf8',
  muted: '#8f9abb',
  download: '#38bdf8',
  upload: '#c084fc',
  ping: '#fbbf24',
  good: '#4ade80',
  warn: '#fbbf24',
  bad: '#f87171',
  panel: 'rgba(24, 33, 72, 0.92)', // майже непрозорі — декоративна дуга не просвічує крізь цифри
};
const SANS = '"Inter Variable", Inter, system-ui, sans-serif';
const MONO = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * @param {import('../core/share.js').SharedResult} data
 * @param {{ site?: string }} [opts]
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderShareCard(data, { site = location.host + location.pathname } = {}) {
  // Шрифти мають бути завантажені до малювання, інакше canvas візьме системні
  await Promise.all([document.fonts.load(`700 40px ${SANS}`), document.fonts.load(`700 40px ${MONO}`)]).catch(() => {});

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Фон
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, COLORS.bg1);
  bg.addColorStop(1, COLORS.bg2);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Декоративна дуга датчика
  ctx.lineCap = 'round';
  ctx.lineWidth = 26;
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath();
  ctx.arc(W - 120, H + 40, 380, Math.PI, Math.PI * 1.5);
  ctx.stroke();
  const arcGrad = ctx.createLinearGradient(W - 500, H, W, 0);
  arcGrad.addColorStop(0, '#22d3ee');
  arcGrad.addColorStop(1, COLORS.download);
  ctx.strokeStyle = arcGrad;
  ctx.beginPath();
  // Та сама нелінійна шкала, що й на датчику
  const scale = data.d > 1000 ? CONFIG.gaugeScaleGigabit : CONFIG.gaugeScale;
  ctx.arc(W - 120, H + 40, 380, Math.PI, Math.PI * (1 + 0.5 * valueToFraction(data.d, scale)));
  ctx.stroke();

  // Шапка
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COLORS.text;
  ctx.font = `700 34px ${SANS}`;
  ctx.fillText('Спід', 64, 92);
  const w1 = ctx.measureText('Спід').width;
  ctx.fillStyle = COLORS.download;
  ctx.fillText('тест', 64 + w1, 92);

  ctx.textAlign = 'right';
  ctx.fillStyle = COLORS.muted;
  ctx.font = `500 22px ${SANS}`;
  const date = new Date(data.t).toLocaleString('uk-UA', { dateStyle: 'medium', timeStyle: 'short' });
  ctx.fillText([date, data.n].filter(Boolean).join(' · '), W - 64, 90);
  ctx.textAlign = 'left';

  // Головні числа
  const big = (x, label, color, value) => {
    ctx.fillStyle = color;
    ctx.font = `600 24px ${SANS}`;
    ctx.fillText(label, x, 190);
    ctx.fillStyle = COLORS.text;
    ctx.font = `700 132px ${MONO}`;
    ctx.fillText(formatMbps(value), x - 6, 320);
    ctx.fillStyle = COLORS.muted;
    ctx.font = `500 26px ${SANS}`;
    ctx.fillText('Мбіт/с', x, 362);
  };
  big(64, '↓ Завантаження', COLORS.download, data.d);
  big(560, '↑ Вивантаження', COLORS.upload, data.u);

  // Нижній ряд
  const gradeColor = data.g <= 'B' ? COLORS.good : data.g === 'C' ? COLORS.warn : COLORS.bad;
  const cells = [
    ['Пінг', `${formatMs(data.p)} мс`, COLORS.ping],
    ['Джиттер', `${formatMs(data.j)} мс`, COLORS.ping],
    ['Втрати', `${data.l.toFixed(1)} %`, COLORS.text],
    ['Стабільність', `${data.s} · ${data.g}`, gradeColor],
  ];
  const cw = (W - 128 - 3 * 20) / 4;
  cells.forEach(([label, value, color], i) => {
    const x = 64 + i * (cw + 20);
    ctx.fillStyle = COLORS.panel;
    roundRect(ctx, x, 418, cw, 110, 20);
    ctx.fill();
    ctx.fillStyle = COLORS.muted;
    ctx.font = `500 20px ${SANS}`;
    ctx.fillText(label, x + 22, 456);
    ctx.fillStyle = color;
    ctx.font = `700 38px ${MONO}`;
    ctx.fillText(value, x + 22, 504);
  });

  // Підвал
  ctx.fillStyle = COLORS.muted;
  ctx.font = `500 20px ${SANS}`;
  ctx.fillText(`Перевір свій інтернет: ${site}`, 64, 584);

  return canvas;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<Blob>}
 */
export function canvasToPng(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
}
