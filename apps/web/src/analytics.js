/**
 * Сторінка аналітики (лише у self-hosted збірці): рейтинг провайдерів
 * і теплова карта медіанної швидкості за днем тижня × годиною.
 * Без Chart.js — таблиця з барами та CSS-сітка, тож сторінка легка.
 */
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import { ThemeManager } from './ui/ThemeManager.js';
import { StorageManager } from './services/StorageManager.js';
import { formatMbps, formatMs } from './ui/format.js';
import { t, setLang, loadLang, getLang, detectLang, applyDom, getLocale } from './i18n/index.js';
import { heatBins, binOf, bestAndWorst } from './core/heatmap.js';
import {
  DEMO_THRESHOLD,
  demoStats,
  demoProviders,
  demoCities,
  demoHeatmap,
  demoStatus,
  demoIncidents,
} from './core/demoData.js';

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

/** @type {{ stats?: any, providers?: any[], cities?: any[], heatmap?: any[], status?: any, incidents?: any[] }} */
let data = {};

/**
 * Демо-режим: поки справжніх тестів менше за DEMO_THRESHOLD, сторінка показує вигаданий приклад
 * (з помітним банером). Користувач може перемкнутися на справжні дані й назад.
 * @type {{ realCount: number, choice: 'auto' | 'demo' | 'real' }}
 */
const demo = { realCount: 0, choice: 'auto' };
const isDemo = () => demo.choice === 'demo' || (demo.choice === 'auto' && demo.realCount < DEMO_THRESHOLD);

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
    // Справжня кількість тестів потрібна завжди — від неї залежить, чи показувати демо
    const stats = await api('results/stats', { days });
    demo.realCount = stats.count ?? 0;
    if (isDemo()) {
      const d = Number(days);
      data = { ...data, stats: demoStats(d), providers: demoProviders(d, city), cities: demoCities(d) };
    } else {
      const [providers, cities] = await Promise.all([
        api('analytics/providers', { days, city }),
        api('analytics/cities', { days }),
      ]);
      data = { ...data, stats, providers, cities };
    }
    renderDemoBanner();
    renderCities();
    renderKpis();
    renderProviders();
    renderIspFilter();
    await Promise.all([loadHeatmap(), loadStatus()]);
  } catch (e) {
    toast(t('analytics.loadError', { message: e.message }));
  } finally {
    document.body.classList.remove('is-loading');
  }
}

async function loadHeatmap() {
  data.heatmap = isDemo()
    ? demoHeatmap(Number(filters.days()), { city: filters.city(), isp: filters.isp() })
    : await api('analytics/heatmap', { days: filters.days(), city: filters.city(), isp: filters.isp(), tz });
  renderHeatmap();
}

/** Стан провайдерів не залежить від фільтрів: це «зараз», а не період */
async function loadStatus() {
  if (isDemo()) {
    data.status = demoStatus();
    data.incidents = demoIncidents();
  } else {
    try {
      [data.status, data.incidents] = await Promise.all([
        api('status/providers', {}),
        api('status/incidents', { days: 30 }),
      ]);
    } catch {
      // Старіший сервер без /api/status — просто ховаємо секцію
      data.status = null;
      data.incidents = [];
    }
  }
  renderStatus();
}

function renderDemoBanner() {
  const on = isDemo();
  const banner = $('#demo-banner');
  // Банер видно в демо-режимі і тоді, коли справжніх даних мало, а користувач перемкнувся на них
  banner.hidden = !on && demo.realCount >= DEMO_THRESHOLD;
  banner.classList.toggle('is-demo', on);
  $('#demo-banner .demo-banner__badge').hidden = !on;
  $('#demo-text').textContent = t(on ? 'analytics.demo.on' : 'analytics.demo.off', { count: demo.realCount });
  $('#demo-toggle').textContent = t(on ? 'analytics.demo.showReal' : 'analytics.demo.showDemo');
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

const fmtTime = (iso) => new Date(iso).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString(getLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
/** Сьогодні — лише час, інакше дата й час */
const fmtWhen = (iso) => (new Date(iso).toDateString() === new Date().toDateString() ? fmtTime(iso) : fmtDateTime(iso));

/** «60 замість 295 Мбіт/с» / «58 замість 12 мс» — що саме погіршилось */
function degradation(p, reasons) {
  const parts = [];
  if (reasons.includes('download')) {
    parts.push(
      t('analytics.status.down', { now: formatMbps(p.recentDownload), usual: formatMbps(p.baselineDownload) }),
    );
  }
  if (reasons.includes('ping')) {
    parts.push(t('analytics.status.ping', { now: formatMs(p.recentPing), usual: formatMs(p.baselinePing) }));
  }
  return parts.join(' · ');
}

function renderStatus() {
  const section = $('#status-section');
  const s = data.status;
  section.hidden = !s;
  if (!s) return;
  $('#status-note').textContent = s.checkedAt
    ? t('analytics.status.note', { hours: s.recentHours, days: s.baselineDays, time: fmtWhen(s.checkedAt) })
    : '';
  $('#status-empty').hidden = s.providers.length > 0;
  $('#status-list').replaceChildren(
    ...s.providers.map((p) => {
      const li = document.createElement('li');
      li.className = `status status--${p.status}`;
      const name = Object.assign(document.createElement('span'), { className: 'status__isp', textContent: p.isp });
      const badge = Object.assign(document.createElement('span'), {
        className: 'status__badge',
        textContent: t(`analytics.status.${p.status}`),
      });
      const detail =
        p.status === 'degraded'
          ? `${degradation(p, p.reasons)} · ${t('analytics.status.since', { time: fmtWhen(p.since) })}`
          : p.status === 'ok'
            ? `${formatMbps(p.recentDownload)} ${t('unit.mbps')} · ${formatMs(p.recentPing)} ${t('unit.ms')}`
            : t('analytics.status.fewTests');
      const info = Object.assign(document.createElement('span'), { className: 'status__detail', textContent: detail });
      li.append(badge, name, info);
      return li;
    }),
  );

  const incidents = data.incidents ?? [];
  $('#incidents-empty').hidden = incidents.length > 0;
  $('#incidents-list').replaceChildren(
    ...incidents.map((i) => {
      const li = document.createElement('li');
      li.className = `incident${i.endedAt ? '' : ' is-ongoing'}`;
      const when = i.endedAt
        ? `${fmtDateTime(i.startedAt)} – ${fmtWhen(i.endedAt)}`
        : `${t('analytics.incidents.ongoing')} · ${t('analytics.status.since', { time: fmtWhen(i.startedAt) })}`;
      li.append(
        Object.assign(document.createElement('strong'), { textContent: i.isp }),
        Object.assign(document.createElement('span'), { className: 'incident__when', textContent: when }),
        Object.assign(document.createElement('span'), {
          className: 'incident__what',
          textContent: degradation(i, i.reasons),
        }),
      );
      return li;
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
    renderDemoBanner();
    renderCities();
    renderKpis();
    renderProviders();
    renderIspFilter();
    renderHeatmap();
    renderStatus();
  }
}

function toast(message) {
  const el = Object.assign(document.createElement('div'), { className: 'toast toast--error', textContent: message });
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 6000);
}

async function init() {
  applyLanguage(await loadLang(settings.lang ?? detectLang(navigator.languages)));
  $('#btn-theme').addEventListener('click', () => theme.toggle());
  $('#btn-lang').addEventListener('click', async () => {
    const next = getLang() === 'uk' ? 'en' : 'uk';
    settings = storage.saveSettings({ lang: next });
    applyLanguage(await loadLang(next));
  });
  $('#demo-toggle').addEventListener('click', () => {
    demo.choice = isDemo() ? 'real' : 'demo';
    loadAll();
  });
  $('#f-days').addEventListener('change', loadAll);
  $('#f-city').addEventListener('change', loadAll);
  $('#f-isp').addEventListener('change', () => loadHeatmap().catch((e) => toast(e.message)));
  bindTooltip();
  loadAll();
}

init();
