/**
 * Сторінка аналітики (лише у self-hosted збірці): рейтинг провайдерів
 * і теплова карта медіанної швидкості за днем тижня × годиною.
 * Без Chart.js — таблиця з барами та CSS-сітка, тож сторінка легка.
 */
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import { ThemeManager } from './ui/ThemeManager.js';
import { StorageManager } from './services/StorageManager.js';
import { formatMbps, formatMs } from './ui/UIController.js';
import { t, setLang, getLang, detectLang, applyDom, getLocale } from './i18n/index.js';
import { heatBins, binOf, bestAndWorst } from './core/heatmap.js';

const $ = (sel) => /** @type {HTMLElement} */ (document.querySelector(sel));
const storage = new StorageManager();
let settings = storage.getSettings();

const theme = new ThemeManager({
  initial: settings.theme,
  onSave: (mode) => (settings = storage.saveSettings({ theme: mode })),
});

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const filters = {
  days: () => /** @type {HTMLSelectElement} */ ($('#f-days')).value,
  city: () => /** @type {HTMLSelectElement} */ ($('#f-city')).value,
  isp: () => /** @type {HTMLSelectElement} */ ($('#f-isp')).value,
};

/** @type {{ stats?: any, providers?: any[], cities?: any[], heatmap?: any[] }} */
let data = {};

async function api(path, params) {
  const url = new URL(`api/${path}`, document.baseURI);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ───────────── Завантаження даних ─────────────

async function loadAll() {
  document.body.classList.add('is-loading');
  try {
    const days = filters.days();
    const city = filters.city();
    const [stats, providers, cities] = await Promise.all([
      api('results/stats', { days }),
      api('analytics/providers', { days, city }),
      api('analytics/cities', { days }),
    ]);
    data = { ...data, stats, providers, cities };
    renderCities();
    renderKpis();
    renderProviders();
    renderIspFilter();
    await loadHeatmap();
  } catch (e) {
    toast(t('analytics.loadError', { message: e.message }));
  } finally {
    document.body.classList.remove('is-loading');
  }
}

async function loadHeatmap() {
  data.heatmap = await api('analytics/heatmap', {
    days: filters.days(),
    city: filters.city(),
    isp: filters.isp(),
    tz,
  });
  renderHeatmap();
}

// ───────────── Рендер ─────────────

function renderKpis() {
  const s = data.stats ?? {};
  $('#kpi-count').textContent = s.count ?? '—';
  $('#kpi-down').textContent = s.count ? `${formatMbps(s.avgDownload)} ${t('unit.mbps')}` : '—';
  $('#kpi-up').textContent = s.count ? `${formatMbps(s.avgUpload)} ${t('unit.mbps')}` : '—';
  $('#kpi-ping').textContent = s.count ? `${formatMs(s.medianPing)} ${t('unit.ms')}` : '—';
}

function renderCities() {
  const select = /** @type {HTMLSelectElement} */ ($('#f-city'));
  const current = select.value;
  const options = (data.cities ?? []).map((c) => {
    const o = document.createElement('option');
    o.value = c.city;
    o.textContent = `${c.city}${c.country ? `, ${c.country}` : ''} (${c.samples})`;
    return o;
  });
  const all = document.createElement('option');
  all.value = '';
  all.textContent = t('analytics.allCities');
  select.replaceChildren(all, ...options);
  // Вибране місто могло «зникнути» з нового періоду
  select.value = options.some((o) => o.value === current) ? current : '';
}

function renderIspFilter() {
  const select = /** @type {HTMLSelectElement} */ ($('#f-isp'));
  const current = select.value;
  const all = document.createElement('option');
  all.value = '';
  all.textContent = t('analytics.allIsps');
  const options = (data.providers ?? []).map((p) => {
    const o = document.createElement('option');
    o.value = p.isp;
    o.textContent = p.isp;
    return o;
  });
  select.replaceChildren(all, ...options);
  select.value = options.some((o) => o.value === current) ? current : '';
}

function renderProviders() {
  const rows = data.providers ?? [];
  $('#providers-empty').hidden = rows.length > 0;
  const max = Math.max(1, ...rows.map((r) => r.p90Download));
  $('#providers-body').replaceChildren(
    ...rows.map((r, i) => {
      const tr = document.createElement('tr');
      const cell = (text, cls = 'num mono') => {
        const td = document.createElement('td');
        td.className = cls;
        td.textContent = text;
        return td;
      };
      // Бар медіани + тонка позначка P90: видно і типову швидкість, і «стелю»
      const barTd = document.createElement('td');
      barTd.className = 'providers__bar-col';
      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('div');
      fill.className = 'bar__fill';
      fill.style.width = `${(r.medianDownload / max) * 100}%`;
      const p90 = document.createElement('div');
      p90.className = 'bar__p90';
      p90.style.left = `${(r.p90Download / max) * 100}%`;
      const label = document.createElement('span');
      label.className = 'bar__label mono';
      label.textContent = `${formatMbps(r.medianDownload)} ${t('unit.mbps')}`;
      bar.append(fill, p90);
      barTd.append(bar, label);

      tr.append(
        cell(String(i + 1), 'mono rank'),
        cell(r.isp, 'isp'),
        barTd,
        cell(formatMbps(r.p90Download)),
        cell(formatMbps(r.medianUpload)),
        cell(`${formatMs(r.medianPing)} ${t('unit.ms')}`),
        cell(String(r.samples)),
      );
      return tr;
    }),
  );
}

/** Назви днів тижня 1 (Пн) … 7 (Нд) у поточній мові */
function weekdayNames(style = 'short') {
  const fmt = new Intl.DateTimeFormat(getLocale(), {
    weekday: /** @type {'short' | 'long'} */ (style),
    timeZone: 'UTC',
  });
  // 2024-01-01 — понеділок
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 1 + i))));
}

function renderHeatmap() {
  $('#tooltip').hidden = true; // клітинки під курсором зараз зникнуть
  const cells = data.heatmap ?? [];
  const byKey = new Map(cells.map((c) => [`${c.dow}:${c.hour}`, c]));
  const bins = heatBins(cells.map((c) => c.medianDownload));
  const days = weekdayNames();
  const daysLong = weekdayNames('long');
  const grid = $('#heatmap');
  const nodes = [];

  // Шапка годин (кожні 3 години — щоб не тіснило)
  nodes.push(Object.assign(document.createElement('span'), { className: 'heatmap__corner' }));
  for (let h = 0; h < 24; h++) {
    nodes.push(
      Object.assign(document.createElement('span'), {
        className: 'heatmap__hour mono',
        textContent: h % 3 === 0 ? String(h).padStart(2, '0') : '',
      }),
    );
  }
  for (let d = 1; d <= 7; d++) {
    nodes.push(Object.assign(document.createElement('span'), { className: 'heatmap__day', textContent: days[d - 1] }));
    for (let h = 0; h < 24; h++) {
      const c = byKey.get(`${d}:${h}`);
      const el = document.createElement('span');
      el.className = 'heatmap__cell';
      if (c) {
        el.dataset.bin = String(binOf(c.medianDownload, bins));
        el.dataset.tip = t('analytics.cellTip', {
          day: daysLong[d - 1],
          from: String(h).padStart(2, '0'),
          to: String((h + 1) % 24).padStart(2, '0'),
          value: formatMbps(c.medianDownload),
          samples: c.samples,
        });
      } else {
        el.dataset.empty = '';
      }
      nodes.push(el);
    }
  }
  grid.replaceChildren(...nodes);

  // Легенда: 5 відтінків одного кольору + «немає даних»
  $('#legend').replaceChildren(
    ...bins.map((b) => {
      const item = document.createElement('span');
      item.className = 'legend__item';
      const sw = document.createElement('span');
      sw.className = 'legend__swatch';
      sw.dataset.bin = String(b.index);
      item.append(sw, `${formatMbps(b.from)}–${formatMbps(b.to)}`);
      return item;
    }),
    (() => {
      const item = document.createElement('span');
      item.className = 'legend__item';
      const sw = document.createElement('span');
      sw.className = 'legend__swatch';
      sw.dataset.empty = '';
      item.append(sw, t('analytics.noData'));
      return item;
    })(),
  );

  const total = cells.reduce((s, c) => s + c.samples, 0);
  $('#heatmap-note').textContent = t('analytics.heatmapNote', { tz, samples: total });

  // Висновок текстом — і для скрінрідерів (role="img"), і для тих, хто не розрізняє відтінки
  const { best, worst } = bestAndWorst(cells);
  const describe = (c) =>
    t('analytics.slot', {
      day: daysLong[c.dow - 1],
      from: String(c.hour).padStart(2, '0'),
      to: String((c.hour + 1) % 24).padStart(2, '0'),
      value: formatMbps(c.medianDownload),
    });
  const insight = best
    ? t('analytics.insight', { best: describe(best), worst: describe(worst) })
    : t('analytics.empty');
  $('#heatmap-insight').textContent = insight;
  grid.setAttribute('aria-label', `${t('analytics.heatmap')}. ${insight}`);
}

// ───────────── Підказка над клітинкою ─────────────

function bindTooltip() {
  const tip = $('#tooltip');
  const grid = $('#heatmap');
  grid.addEventListener('pointermove', (e) => {
    const cell = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.heatmap__cell'));
    if (!cell?.dataset.tip) {
      tip.hidden = true;
      return;
    }
    tip.textContent = cell.dataset.tip;
    tip.hidden = false;
    const r = cell.getBoundingClientRect();
    const x = Math.min(
      window.innerWidth - tip.offsetWidth - 8,
      Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2),
    );
    tip.style.transform = `translate(${x}px, ${r.top - tip.offsetHeight - 8 + window.scrollY}px)`;
  });
  grid.addEventListener('pointerleave', () => (tip.hidden = true));
}

// ───────────── Мова, тема, тости ─────────────

function applyLanguage(lang) {
  setLang(lang);
  document.documentElement.lang = getLang();
  document.title = t('analytics.pageTitle');
  applyDom(document);
  if (data.stats) {
    renderCities();
    renderKpis();
    renderProviders();
    renderIspFilter();
    renderHeatmap();
  }
}

function toast(message) {
  const el = Object.assign(document.createElement('div'), { className: 'toast toast--error', textContent: message });
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 6000);
}

function init() {
  applyLanguage(settings.lang ?? detectLang(navigator.languages));
  $('#btn-theme').addEventListener('click', () => theme.toggle());
  $('#btn-lang').addEventListener('click', () => {
    const next = getLang() === 'uk' ? 'en' : 'uk';
    settings = storage.saveSettings({ lang: next });
    applyLanguage(next);
  });
  $('#f-days').addEventListener('change', loadAll);
  $('#f-city').addEventListener('change', loadAll);
  $('#f-isp').addEventListener('change', () => loadHeatmap().catch((e) => toast(e.message)));
  bindTooltip();
  loadAll();
}

init();
