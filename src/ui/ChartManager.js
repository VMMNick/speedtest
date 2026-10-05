/**
 * ChartManager — графіки на Chart.js:
 *   • живий графік швидкості під час тесту (download / upload накладаються по осі часу)
 *   • графік історії у модалці
 */
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, Legend);

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function palette() {
  return {
    download: cssVar('--color-download'),
    upload: cssVar('--color-upload'),
    ping: cssVar('--color-ping'),
    grid: cssVar('--color-grid'),
    text: cssVar('--color-text-muted'),
    font: cssVar('--font-sans'),
  };
}

function gradient(ctx, area, color) {
  if (!area) return color;
  const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
  g.addColorStop(0, color + '55');
  g.addColorStop(1, color + '00');
  return g;
}

const mbpsFmt = (v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));

export class ChartManager {
  constructor() {
    this.live = null;
    this.history = null;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  _baseOptions(p) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: /** @type {false | { duration: number }} */ (this.reducedMotion ? false : { duration: 250 }),
      interaction: { mode: /** @type {const} */ ('index'), intersect: false },
      plugins: {
        legend: { labels: { color: p.text, font: { family: p.font }, usePointStyle: true, boxHeight: 6 } },
        tooltip: {
          callbacks: { label: (c) => `${c.dataset.label}: ${mbpsFmt(c.parsed.y)} Мбіт/с` },
        },
      },
      scales: {
        x: { grid: { color: p.grid }, ticks: { color: p.text, font: { family: p.font } } },
        y: {
          beginAtZero: true,
          grid: { color: p.grid },
          ticks: { color: p.text, font: { family: p.font } },
          title: { display: true, text: 'Мбіт/с', color: p.text },
        },
      },
    };
  }

  _dataset(label, color) {
    return {
      label,
      data: [],
      borderColor: color,
      backgroundColor: (c) => gradient(c.chart.ctx, c.chart.chartArea, color),
      fill: true,
      tension: 0.35,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
    };
  }

  // ───────────── Живий графік ─────────────

  initLive(canvas) {
    const p = palette();
    const opts = this._baseOptions(p);
    opts.scales.x = {
      ...opts.scales.x,
      type: 'linear',
      min: 0,
      suggestedMax: 10,
      title: { display: true, text: 'секунди', color: p.text },
      ticks: { ...opts.scales.x.ticks, callback: (v) => `${v}s` },
    };
    opts.plugins.tooltip.callbacks.title = (items) => `${items[0]?.parsed.x.toFixed(1)} с`;
    // Дані приходять кожні 200 мс — анімація Chart.js тут лише заважає (і ламає resize)
    opts.animation = false;
    this.live = new Chart(canvas, {
      type: 'line',
      data: { datasets: [this._dataset('Завантаження', p.download), this._dataset('Вивантаження', p.upload)] },
      options: opts,
    });
  }

  resetLive() {
    if (!this.live) return;
    this.live.data.datasets.forEach((d) => (d.data = []));
    this.live.update('none');
  }

  pushLive(phase, tMs, mbps) {
    if (!this.live) return;
    const idx = phase === 'download' ? 0 : phase === 'upload' ? 1 : -1;
    if (idx < 0) return;
    this.live.data.datasets[idx].data.push({ x: tMs / 1000, y: mbps });
    this.live.update('none');
  }

  // ───────────── Історія ─────────────

  renderHistory(canvas, entries) {
    const p = palette();
    const ordered = [...entries].reverse(); // від старих до нових
    const labels = ordered.map((e) =>
      new Date(e.timestamp).toLocaleString('uk-UA', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    );
    const dl = this._dataset('Завантаження', p.download);
    dl.data = ordered.map((e) => e.download?.mbps ?? 0);
    dl.pointRadius = 3;
    const ul = this._dataset('Вивантаження', p.upload);
    ul.data = ordered.map((e) => e.upload?.mbps ?? 0);
    ul.pointRadius = 3;

    this.history?.destroy();
    this.history = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets: [dl, ul] },
      options: this._baseOptions(p),
    });
  }

  /** Перефарбувати графіки після зміни теми. */
  updateTheme() {
    const p = palette();
    for (const chart of [this.live, this.history]) {
      if (!chart) continue;
      const colors = [p.download, p.upload];
      chart.data.datasets.forEach((d, i) => {
        d.borderColor = colors[i];
        d.backgroundColor = (c) => gradient(c.chart.ctx, c.chart.chartArea, colors[i]);
      });
      chart.options.plugins.legend.labels.color = p.text;
      for (const axis of Object.values(chart.options.scales)) {
        axis.grid.color = p.grid;
        axis.ticks.color = p.text;
        if (axis.title) axis.title.color = p.text;
      }
      chart.update('none');
    }
  }
}
