/**
 * UIController — усе, що стосується DOM: датчик, картки метрик,
 * стан кнопок, модалка історії, тости.
 * Не містить бізнес-логіки — лише відображає стан, який передає app.js.
 */
import { CONFIG } from '../core/config.js';
import { planShare, sparklinePoints } from '../core/insights.js';

/** @returns {HTMLElement} */
const $ = (sel, root = document) => root.querySelector(sel);

const CX = 150;
const CY = 150;
const R = 118;
const START_DEG = 135;
const SWEEP_DEG = 270;

const PING_SCALE = [0, 5, 10, 20, 30, 50, 75, 100, 150, 250, 500, 1000];

const PHASE_LABELS = {
  idle: 'Готовий',
  connecting: 'Пошук сервера…',
  ping: 'Пінг',
  download: 'Завантаження',
  upload: 'Вивантаження',
  done: 'Готово',
};

export const formatMbps = (v) => {
  if (v == null || Number.isNaN(v)) return '—';
  // ≥ 100 — цілі числа (у т. ч. гігабітні канали: «1234», а не «1.23k» — так однозначніше й парситься)
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
};
export const formatMs = (v) => (v == null || Number.isNaN(v) ? '—' : v >= 100 ? v.toFixed(0) : v.toFixed(1));
export const formatBytes = (b) => {
  if (!b) return '0 Б';
  const u = ['Б', 'КБ', 'МБ', 'ГБ'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
};

const polar = (deg, r = R) => {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
};

/**
 * Шкала датчика: пінг — своя; швидкість — до 1 Гбіт/с, а якщо значення більше —
 * мультигігабітна (до 10 Гбіт/с).
 * @param {'ping' | 'speed'} kind
 * @param {number} value
 */
export function scaleFor(kind, value = 0) {
  if (kind === 'ping') return PING_SCALE;
  return value > CONFIG.gaugeScale[CONFIG.gaugeScale.length - 1] ? CONFIG.gaugeScaleGigabit : CONFIG.gaugeScale;
}

/** Значення → частка шкали (0..1) з нелінійною шкалою. */
export function valueToFraction(value, scale) {
  if (value <= scale[0]) return 0;
  const last = scale.length - 1;
  if (value >= scale[last]) return 1;
  for (let i = 0; i < last; i++) {
    if (value <= scale[i + 1]) {
      const local = (value - scale[i]) / (scale[i + 1] - scale[i]);
      return (i + local) / last;
    }
  }
  return 1;
}

export class UIController {
  constructor() {
    this.el = {
      gauge: $('#gauge'),
      track: $('#gauge-track'),
      progress: $('#gauge-progress'),
      ticks: $('#gauge-ticks'),
      needle: $('#gauge-needle'),
      phase: $('#gauge-phase'),
      value: $('#gauge-value'),
      unit: $('#gauge-unit'),
      start: $('#btn-start'),
      stop: $('#btn-stop'),
      steps: $('#phase-steps'),
      phaseBar: $('#phase-progress'),
      serverName: $('#server-name'),
      serverIsp: $('#server-isp'),
      serverIp: $('#server-ip'),
      summary: $('#summary'),
      toasts: $('#toasts'),
      modal: /** @type {HTMLDialogElement} */ ($('#history-modal')),
      historyBody: $('#history-body'),
      historyEmpty: $('#history-empty'),
      historyStats: $('#history-stats'),
      soundBtn: $('#btn-sound'),
    };
    this.scale = CONFIG.gaugeScale;
    this.displayed = 0;
    this.target = 0;
    this.raf = null;
    this._buildGauge(this.scale);

    this.el.modal.addEventListener('click', (e) => {
      const target = /** @type {Element} */ (e.target);
      if (target === this.el.modal || target.closest('[data-close]')) this.closeHistory();
    });
  }

  // ───────────── Датчик ─────────────

  _arcPath(fromFrac, toFrac, r = R) {
    const a0 = START_DEG + SWEEP_DEG * fromFrac;
    const a1 = START_DEG + SWEEP_DEG * toFrac;
    const [x0, y0] = polar(a0, r);
    const [x1, y1] = polar(a1, r);
    const large = a1 - a0 > 180 ? 1 : 0;
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }

  _buildGauge(scale) {
    const d = this._arcPath(0, 1);
    this.el.track.setAttribute('d', d);
    this.el.progress.setAttribute('d', d);
    const last = scale.length - 1;
    const ns = 'http://www.w3.org/2000/svg';
    this.el.ticks.replaceChildren(
      ...scale.flatMap((v, i) => {
        const deg = START_DEG + (SWEEP_DEG * i) / last;
        const [x1, y1] = polar(deg, R - 16);
        const [x2, y2] = polar(deg, R - 24);
        const [tx, ty] = polar(deg, R - 38);
        const line = document.createElementNS(ns, 'line');
        Object.entries({ x1, y1, x2, y2 }).forEach(([k, val]) => line.setAttribute(k, val.toFixed(2)));
        const text = document.createElementNS(ns, 'text');
        text.setAttribute('x', tx.toFixed(2));
        text.setAttribute('y', ty.toFixed(2));
        text.textContent = v >= 1000 ? `${v / 1000}k` : v;
        return [line, text];
      }),
    );
  }

  setGaugeScale(kind, value = 0) {
    this.scaleKind = kind;
    const scale = scaleFor(kind, value);
    if (scale === this.scale) return;
    this.scale = scale;
    this._buildGauge(scale);
  }

  /** Плавно анімує датчик до значення. */
  setGaugeValue(value, { decimals = 'mbps' } = {}) {
    this.target = Math.max(0, value || 0);
    this.format = decimals === 'ms' ? formatMs : formatMbps;
    // Автоперемикання на мультигігабітну шкалу (лише вгору — до наступної фази)
    if (this.scaleKind === 'speed' && this.target > this.scale[this.scale.length - 1]) {
      this.setGaugeScale('speed', this.target);
    }
    if (!this.raf) this.raf = requestAnimationFrame(() => this._animate());
  }

  _animate() {
    const diff = this.target - this.displayed;
    this.displayed += Math.abs(diff) < 0.01 ? diff : diff * 0.18;
    const frac = valueToFraction(this.displayed, this.scale);
    this.el.progress.setAttribute('stroke-dasharray', `${(frac * 100).toFixed(2)} 100`);
    this.el.progress.style.opacity = frac > 0.002 ? '1' : '0'; // без «крапок» від round linecap на нулі
    this.el.needle.style.transform = `rotate(${(frac * SWEEP_DEG - 135).toFixed(2)}deg)`;
    this.el.value.textContent = this.format(this.displayed);
    this.raf = this.displayed === this.target ? null : requestAnimationFrame(() => this._animate());
  }

  setPhase(phase) {
    this.el.gauge.dataset.phase = phase;
    this.el.phase.textContent = PHASE_LABELS[phase] ?? phase;
    this.el.unit.textContent = phase === 'ping' ? 'мс' : 'Мбіт/с';
    this.setGaugeScale(phase === 'ping' ? 'ping' : 'speed');

    const order = ['ping', 'download', 'upload'];
    const current = order.indexOf(phase);
    this.el.steps.querySelectorAll('li').forEach((li, i) => {
      li.classList.toggle('is-active', i === current);
      li.classList.toggle('is-done', phase === 'done' || (current > -1 && i < current));
    });
    if (['ping', 'download', 'upload'].includes(phase)) {
      this.displayed = 0;
      this.setGaugeValue(0);
      this.setPhaseProgress(0);
    }
  }

  setPhaseProgress(p) {
    const phase = this.el.gauge.dataset.phase;
    const offsets = { ping: 0, download: 1, upload: 2 };
    const total = phase in offsets ? (offsets[phase] + p) / 3 : phase === 'done' ? 1 : 0;
    this.el.phaseBar.style.transform = `scaleX(${total})`;
  }

  setRunning(running) {
    document.body.classList.toggle('is-running', running);
    this.el.start.hidden = running;
    this.el.stop.hidden = !running;
    if (running) {
      this.el.summary.hidden = true;
      this.resetMetrics();
    }
  }

  setStartLabel(text) {
    this.el.start.querySelector('.start-btn__label').textContent = text;
  }

  // ───────────── Метрики ─────────────

  setMetric(name, value, sub = '') {
    const card = document.querySelector(`[data-metric="${name}"]`);
    if (!card) return;
    const formatter = ['download', 'upload'].includes(name) ? formatMbps : name === 'stability' ? String : formatMs;
    card.querySelector('[data-value]').textContent = value == null ? '—' : formatter(value);
    card.querySelector('[data-sub]').textContent = sub;
    card.classList.toggle('is-filled', value != null);
  }

  setMetricLive(name, on) {
    document.querySelector(`[data-metric="${name}"]`)?.classList.toggle('is-live', on);
  }

  // ───────────── Порівняння, спарклайн, тариф ─────────────

  /**
   * Бейджі «↑ 12%» на картках відносно попереднього тесту.
   * @param {Record<string, import('../core/insights.js').Delta> | null} cmp
   */
  showDeltas(cmp) {
    for (const key of ['download', 'upload', 'ping', 'jitter']) {
      const el = $(`[data-metric="${key}"] [data-delta]`);
      const d = cmp?.[key];
      el.hidden = !d;
      if (!d) continue;
      el.dataset.trend = d.trend;
      el.textContent = d.trend === 'same' ? '≈ без змін' : `${d.delta > 0 ? '↑' : '↓'} ${Math.abs(d.pct).toFixed(0)}%`;
      el.title = 'Порівняно з попереднім тестом';
    }
  }

  /** @param {number[]} values */
  setSparkline(values) {
    $('[data-metric="ping"] [data-spark] polyline').setAttribute('points', sparklinePoints(values, 100, 24));
  }

  /**
   * Частка від тарифу провайдера.
   * @param {number | null} mbps   фактичне завантаження
   * @param {number | null} planMbps
   */
  showPlan(mbps, planMbps) {
    const box = $('#plan-result');
    const share = planShare(mbps, planMbps);
    box.hidden = !share;
    if (!share) return;
    box.dataset.level = share.level;
    $('#plan-fill').style.transform = `scaleX(${Math.min(1, share.pct / 100)})`;
    const verdict = share.level === 'good' ? 'у нормі' : share.level === 'ok' ? 'помітно нижче' : 'значно нижче';
    const strong = document.createElement('strong');
    strong.textContent = `${share.pct.toFixed(0)}%`;
    $('#plan-text').replaceChildren(
      'Завантаження — ',
      strong,
      ` від тарифу (${formatMbps(mbps)} з ${formatMbps(planMbps)} Мбіт/с), ${verdict}`,
    );
  }

  resetMetrics() {
    ['download', 'upload', 'ping', 'jitter', 'loss', 'stability'].forEach((m) => {
      this.setMetric(m, null);
      this.setMetricLive(m, false);
    });
    $('[data-metric="stability"]').dataset.grade = '';
    this.showDeltas(null);
    this.setSparkline([]);
  }

  /**
   * Відображає підсумок після завершення тесту.
   * @param {import('../core/types.js').TestResult} r
   */
  showResults(r) {
    this.setMetric('ping', r.ping.median, `мін ${formatMs(r.ping.min)} · макс ${formatMs(r.ping.max)}`);
    this.setMetric(
      'jitter',
      r.ping.jitter,
      r.ping.jitter < 5 ? 'Відмінно' : r.ping.jitter < 20 ? 'Нормально' : 'Високий',
    );
    this.setMetric('loss', r.ping.loss, r.ping.loss === 0 ? 'Без втрат' : 'Частина запитів без відповіді');
    for (const dir of /** @type {const} */ (['download', 'upload'])) {
      const d = r[dir];
      const parts = [
        d.mbpsAvg != null ? `сер. ${formatMbps(d.mbpsAvg)}` : null,
        formatBytes(d.bytes),
        `${(d.durationMs / 1000).toFixed(1)} с`,
        d.stoppedEarly ? 'достроково' : null,
      ].filter(Boolean);
      this.setMetric(dir, d.mbps, parts.join(' · '));
      $(`[data-metric="${dir}"] [data-sub]`).title = d.stoppedEarly
        ? 'Швидкість стабілізувалась — фазу завершено раніше. Значення — 90-й перцентиль, «сер.» — середня.'
        : 'Значення — 90-й перцентиль швидкості, «сер.» — середня.';
    }
    this.setMetric('stability', r.stability.score, `Оцінка ${r.stability.grade}`);
    $('[data-metric="stability"]').dataset.grade = r.stability.grade;

    $('#summary-grade').textContent = r.stability.grade;
    $('#summary-grade').dataset.grade = r.stability.grade;
    $('#sum-loaded-dl').textContent = `${formatMs(r.download.loadedLatency.median)} мс`;
    $('#sum-loaded-ul').textContent = `${formatMs(r.upload.loadedLatency.median)} мс`;
    $('#sum-bloat').textContent = `+${formatMs(r.bufferbloat.delta)} мс · ${r.bufferbloat.grade}`;
    $('#sum-bytes').textContent = formatBytes(r.download.bytes + r.upload.bytes);

    const labels = {
      streaming4k: 'Стрімінг 4K',
      videoCalls: 'Відеодзвінки',
      gaming: 'Онлайн-ігри',
      browsing: 'Веб-серфінг',
    };
    $('#usecases').replaceChildren(
      ...Object.entries(r.useCases).map(([k, ok]) => {
        const li = document.createElement('li');
        li.className = ok ? 'ok' : 'bad';
        li.innerHTML = `<span aria-hidden="true">${ok ? '✓' : '✕'}</span> ${labels[k]}`;
        li.setAttribute('aria-label', `${labels[k]}: ${ok ? 'підходить' : 'не підходить'}`);
        return li;
      }),
    );
    this.el.summary.hidden = false;
  }

  // ───────────── Сервер ─────────────

  showServer(server, meta, latency) {
    const loc = meta?.city ? `${meta.city}${meta.colo ? ` (${meta.colo})` : ''}` : (meta?.colo ?? '');
    this.el.serverName.textContent =
      [server.name, loc].filter(Boolean).join(' · ') + (latency ? ` · ${formatMs(latency)} мс` : '');
    this.el.serverIsp.textContent = meta?.isp ?? '—';
    this.el.serverIp.textContent = meta?.ip ?? '—';
  }

  setSound(on) {
    this.el.soundBtn.setAttribute('aria-pressed', String(on));
  }

  // ───────────── Історія ─────────────

  openHistory() {
    if (!this.el.modal.open) this.el.modal.showModal();
  }

  closeHistory() {
    this.el.modal.close();
  }

  /**
   * @param {import('../core/types.js').TestResult[]} entries
   * @param {{ onDelete?: (id: number) => void, filtered?: boolean }} [opts]
   */
  renderHistory(entries, { onDelete = undefined, filtered = false } = {}) {
    this.el.historyEmpty.hidden = entries.length > 0;
    this.el.historyEmpty.textContent = filtered
      ? 'За цей період тестів немає.'
      : 'Ще немає жодного тесту. Натисніть «Старт».';
    this.el.historyBody.replaceChildren(
      ...entries.map((e) => {
        const tr = document.createElement('tr');
        const cells = [
          new Date(e.timestamp).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' }),
          formatMbps(e.download?.mbps),
          formatMbps(e.upload?.mbps),
          `${formatMs(e.ping?.median)} мс`,
          `${formatMs(e.ping?.jitter)} мс`,
        ];
        cells.forEach((c, i) => {
          const td = document.createElement('td');
          td.textContent = c;
          if (i) td.className = 'mono';
          tr.append(td);
        });
        const gradeTd = document.createElement('td');
        gradeTd.innerHTML = `<span class="grade grade--sm" data-grade="${e.stability?.grade ?? ''}">${e.stability?.grade ?? '—'}</span>`;
        const actionTd = document.createElement('td');
        const del = document.createElement('button');
        del.className = 'icon-btn icon-btn--sm';
        del.type = 'button';
        del.title = 'Видалити запис';
        del.innerHTML = '<span aria-hidden="true">🗑</span><span class="sr-only">Видалити</span>';
        del.addEventListener('click', () => onDelete?.(e.id));
        actionTd.append(del);
        tr.append(gradeTd, actionTd);
        return tr;
      }),
    );

    if (!entries.length) {
      this.el.historyStats.replaceChildren();
      return;
    }
    const avg = (fn) => entries.reduce((s, e) => s + (fn(e) || 0), 0) / entries.length;
    const best = Math.max(...entries.map((e) => e.download?.mbps || 0));
    const stats = [
      ['Тестів', entries.length],
      ['Сер. ↓', `${formatMbps(avg((e) => e.download?.mbps))} Мбіт/с`],
      ['Сер. ↑', `${formatMbps(avg((e) => e.upload?.mbps))} Мбіт/с`],
      ['Сер. пінг', `${formatMs(avg((e) => e.ping?.median))} мс`],
      ['Рекорд ↓', `${formatMbps(best)} Мбіт/с`],
    ];
    this.el.historyStats.replaceChildren(
      ...stats.map(([k, v]) => {
        const d = document.createElement('div');
        d.innerHTML = `<span class="label"></span><strong class="mono"></strong>`;
        d.querySelector('.label').textContent = String(k);
        d.querySelector('strong').textContent = String(v);
        return d;
      }),
    );
  }

  /** Озвучення для скрінрідерів — лише підсумки фаз, не кожен кадр датчика. */
  announce(text) {
    const el = document.getElementById('sr-announcer');
    if (!el) return;
    el.textContent = '';
    // Пауза, щоб однаковий текст поспіль теж був озвучений
    setTimeout(() => (el.textContent = text), 50);
  }

  // ───────────── Тости ─────────────

  /**
   * @param {string} message
   * @param {'info' | 'success' | 'error'} [kind]
   * @param {number} [ttl] мс; 0 — не зникає сам
   * @param {{ label: string, onClick: () => void }} [action] кнопка в тості
   */
  toast(message, kind = 'info', ttl = 4500, action = undefined) {
    const t = document.createElement('div');
    t.className = `toast toast--${kind}`;
    const text = document.createElement('span');
    text.textContent = message;
    t.append(text);
    const close = () => {
      t.classList.add('is-leaving');
      setTimeout(() => t.remove(), 300);
    };
    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast__action';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        close();
        action.onClick();
      });
      t.append(btn);
    }
    this.el.toasts.append(t);
    if (ttl > 0) setTimeout(close, ttl);
  }

  // ───────────── Результат із посилання ─────────────

  /** @param {import('../core/share.js').SharedResult} d */
  showShared(d) {
    document.body.classList.add('is-shared');
    const when = new Date(d.t).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
    $('#shared-meta').textContent = ` (${[when, d.n].filter(Boolean).join(' · ')})`;
    $('#shared-banner').hidden = false;
    const note = 'з посилання';
    this.setMetric('download', d.d, note);
    this.setMetric('upload', d.u, note);
    this.setMetric('ping', d.p, note);
    this.setMetric('jitter', d.j, note);
    this.setMetric('loss', d.l, note);
    this.setMetric('stability', d.s, `Оцінка ${d.g}`);
    $('[data-metric="stability"]').dataset.grade = d.g;
  }

  hideShared() {
    document.body.classList.remove('is-shared');
    $('#shared-banner').hidden = true;
  }
}
