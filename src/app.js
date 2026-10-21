/**
 * Точка входу (composition root): створює модулі, з'єднує їх і оркеструє тест.
 * Уся логіка вимірювань — у core/ (у воркері), робота з DOM — в ui/, введення-виведення — в services/.
 *
 *  ServerSelector ──► (server) ──► speed.worker (NetworkEngine)
 *                                         │ postMessage
 *                                         ▼
 *   UIController / charts / HistoryPanel / SharePanel ◄── app.js ──► StorageManager, ResultsApi
 */
// Шрифти локально (без Google Fonts): unicode-range → браузер вантажить лише потрібні підмножини (латиниця/кирилиця)
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import { LIGHT_CONFIG, SERVERS, FEATURES, detectLightMode, mergeDeep, resolveServerUrls } from './core/config.js';
import { compareResults } from './core/insights.js';
import { t, setLang, loadLang, getLang, detectLang, applyDom } from './i18n/index.js';
import { StorageManager } from './services/StorageManager.js';
import { ServerSelector } from './services/ServerSelector.js';
import { toPayload, submitResult } from './services/ResultsApi.js';
import { createChime } from './services/sound.js';
import { registerServiceWorker } from './services/pwa.js';
import { UIController } from './ui/UIController.js';
import { ThemeManager } from './ui/ThemeManager.js';
import { HistoryPanel } from './ui/HistoryPanel.js';
import { SharePanel } from './ui/SharePanel.js';
import { createChartsLoader } from './ui/lazyCharts.js';
import { formatMbps, formatMs } from './ui/format.js';
import { byId } from './ui/dom.js';

const phaseName = (phase) => t(`phase.${phase}`);

const ui = new UIController();

const charts = createChartsLoader(() => byId('live-chart'));
const loadCharts = () => charts.load();

const storage = new StorageManager();
// URL серверів — абсолютні (відносні розв'язувались би у воркері від /assets/)
const selector = new ServerSelector({ servers: SERVERS.map((s) => resolveServerUrls(s, document.baseURI)) });

let settings = storage.getSettings();
const theme = new ThemeManager({
  initial: settings.theme,
  onSave: (mode) => (settings = storage.saveSettings({ theme: mode })),
});
theme.addEventListener('change', () => charts.current?.updateTheme());

let worker = null;
let selected = null; // { server, latency }
let running = false;
/** Останній результат — для частки від тарифу, «Поділитися» і повторного показу після зміни мови */
let lastResult = null;
/** Порівняння з попереднім — для повторного показу після зміни мови */
let lastDeltas = null;
let hasRun = false;

const chime = createChime();
const historyPanel = new HistoryPanel({ ui, storage, loadCharts });
const sharePanel = new SharePanel({ ui, getResult: () => lastResult, isRunning: () => running });
/** Метадані з'єднання (місто, провайдер, IP) */
let serverMeta = null;
/** Пінги поточного тесту — для спарклайна */
let pingLive = [];

// ───────────── Ініціалізація ─────────────

/** Економний режим: Save-Data або повільна мережа (Network Information API, де підтримується). */
const connection = /** @type {any} */ (navigator).connection;
const lightMode = () => detectLightMode(connection);
const showModeNote = () => (byId('mode-note').hidden = !lightMode());

async function init() {
  applyLanguage(await loadLang(settings.lang ?? detectLang(navigator.languages)));
  ui.setSound(settings.sound);
  showModeNote();
  connection?.addEventListener?.('change', showModeNote);
  charts.preloadOn([byId('btn-start'), byId('btn-history')]);
  await storage.init();
  bindEvents();
  historyPanel.bind();
  sharePanel.bind();
  sharePanel.showFromUrl();
  detectServer();
  registerServiceWorker({
    canReload: () => !running,
    onUpdateReady: (apply) =>
      ui.toast(t('toast.update'), 'info', 0, { label: t('toast.updateAction'), onClick: apply }),
  });
}

async function detectServer() {
  ui.el.serverName.textContent = t('server.detecting');
  selected = await selector.selectBest();
  serverMeta = await selector.fetchMeta(selected.server);
  ui.showServer(selected.server, serverMeta, selected.latency);
  if (!selected.reachable) ui.toast(t('server.unreachable'), 'error');
}

function bindEvents() {
  ui.el.start.addEventListener('click', startTest);
  ui.el.stop.addEventListener('click', stopTest);
  byId('btn-theme').addEventListener('click', () => theme.toggle());
  byId('btn-lang').addEventListener('click', async () => {
    const next = getLang() === 'uk' ? 'en' : 'uk';
    settings = storage.saveSettings({ lang: next });
    applyLanguage(await loadLang(next));
  });
  byId('btn-sound').addEventListener('click', () => {
    settings = storage.saveSettings({ sound: !settings.sound });
    ui.setSound(settings.sound);
  });
  // Згода на анонімну статистику — лише коли збірка має бекенд
  const consent = /** @type {HTMLInputElement} */ (byId('stats-consent'));
  byId('stats-optin').hidden = !FEATURES.resultsApi;
  // Аналітика: своя сторінка, якщо є бекенд, інакше — зовнішня (напр. GitHub Pages → Render)
  const analytics = /** @type {HTMLAnchorElement} */ (byId('link-analytics'));
  if (!FEATURES.resultsApi && FEATURES.analyticsUrl) analytics.href = FEATURES.analyticsUrl;
  analytics.hidden = !FEATURES.resultsApi && !FEATURES.analyticsUrl;
  consent.checked = settings.shareStats !== false;
  consent.addEventListener('change', () => (settings = storage.saveSettings({ shareStats: consent.checked })));

  // Тариф провайдера: зберігається і одразу перераховує частку
  const planInput = /** @type {HTMLInputElement} */ (byId('plan-input'));
  if (settings.planMbps) planInput.value = String(settings.planMbps);
  planInput.addEventListener('input', () => {
    const v = Number(planInput.value);
    settings = storage.saveSettings({ planMbps: v > 0 ? v : null });
    if (lastResult) ui.showPlan(lastResult.download.mbps, settings.planMbps);
  });

  document.addEventListener('keydown', (e) => {
    // Enter/Space на кнопці чи посиланні — це їхній власний клік, не старт тесту
    const target = /** @type {Element} */ (e.target);
    if (target.closest('input, textarea, select, button, a, [contenteditable], dialog[open]')) return;
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter' && !running) startTest();
    if (e.key === 'Escape' && running) stopTest();
  });

  window.addEventListener('online', () => ui.toast(t('toast.online'), 'success'));
  window.addEventListener('offline', () => {
    ui.toast(t('toast.offline'), 'error');
    if (running) stopTest();
  });
}

// ───────────── Тест ─────────────

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./workers/speed.worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e) => handleMessage(e.data));
    worker.addEventListener('error', (e) => {
      console.error(e);
      finish();
      ui.toast(t('toast.workerError'), 'error');
      worker?.terminate();
      worker = null;
    });
  }
  return worker;
}

async function startTest() {
  if (running) return;
  if (!navigator.onLine) {
    ui.toast(t('toast.offline'), 'error');
    return;
  }
  running = true;
  pingLive = [];
  sharePanel.hideShared();
  ui.setRunning(true);
  if (settings.sound) chime.unlock(); // синхронно, поки діє жест користувача
  (await loadCharts())?.resetLive();

  if (!selected?.reachable) {
    ui.setPhase('connecting');
    await detectServer();
    if (!selected?.reachable) {
      finish();
      return;
    }
  }
  // window.__SPEEDTEST_CONFIG__ — гачок для E2E-тестів (коротші фази); у звичайній роботі не заданий
  const testOverride = /** @type {any} */ (window).__SPEEDTEST_CONFIG__;
  const config = mergeDeep(lightMode() ? LIGHT_CONFIG : {}, testOverride ?? {});
  getWorker().postMessage({ type: 'start', server: selected.server, config });
}

function stopTest() {
  if (!running) return;
  worker?.postMessage({ type: 'abort' });
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'phase':
      ui.setPhase(msg.phase);
      ui.announce(t('a11y.phase', { phase: phaseName(msg.phase) }));
      ['ping', 'download', 'upload'].forEach((m) => ui.setMetricLive(m, m === msg.phase));
      ui.setMetricLive('jitter', msg.phase === 'ping');
      break;

    case 'progress':
      ui.setPhaseProgress(msg.progress);
      if (msg.phase === 'ping') {
        if (msg.value != null) {
          ui.setGaugeValue(msg.value, { decimals: 'ms' });
          ui.setMetric('ping', msg.value);
          pingLive.push(msg.value);
          ui.setSparkline(pingLive);
        }
      } else {
        ui.setGaugeValue(msg.value);
        ui.setMetric(msg.phase, msg.value);
        charts.current?.pushLive(msg.phase, msg.t, msg.value);
      }
      break;

    case 'result':
      ui.setMetricLive(msg.phase, false);
      ui.announce(
        msg.phase === 'ping'
          ? t('a11y.pingResult', { ping: formatMs(msg.data.median), jitter: formatMs(msg.data.jitter) })
          : t('a11y.speedResult', { phase: phaseName(msg.phase), value: formatMbps(msg.data.mbps) }),
      );
      if (msg.phase === 'ping') {
        ui.setMetricLive('jitter', false);
        ui.setMetric('ping', msg.data.median);
        ui.setMetric('jitter', msg.data.jitter);
        ui.setMetric('loss', msg.data.loss);
      } else {
        ui.setMetric(msg.phase, msg.data.mbps);
        ui.setGaugeValue(msg.data.mbps);
      }
      break;

    case 'done':
      onDone(msg.results);
      break;

    case 'aborted':
      ui.toast(t('toast.stopped'));
      finish();
      break;

    case 'error':
      ui.toast(t('toast.error', { message: errorText(msg) }), 'error', 7000);
      finish();
      break;
  }
}

async function onDone(results) {
  lastResult = results;
  results.server = { ...results.server, latency: selected?.latency ?? null };
  ui.showResults(results);
  ui.announce(t('a11y.done', { grade: results.stability.grade, score: results.stability.score }));
  ui.setPhase('done');
  ui.setPhaseProgress(1);
  ui.setGaugeValue(results.download.mbps);
  ui.setSparkline(results.ping.samples ?? []);
  ui.showPlan(results.download.mbps, settings.planMbps);
  finish();
  if (settings.sound) chime.play();
  const failed = (results.download.failedRequests ?? 0) + (results.upload.failedRequests ?? 0);
  if (failed > 0) ui.toast(t('toast.partial', { count: failed }), 'info', 7000);
  try {
    // Порівнюємо з попереднім тестом ДО збереження нового
    const [prev] = await storage.getHistory();
    lastDeltas = compareResults(prev, results);
    ui.showDeltas(lastDeltas);
    await storage.addResult(results);
    // Анонімна статистика на власному сервері (лише у self-hosted збірці і за згодою)
    if (FEATURES.resultsApi && settings.shareStats !== false) {
      submitResult(toPayload(results, serverMeta, { lightMode: lightMode() }), document.baseURI);
    }
  } catch (e) {
    console.warn('Не вдалося зберегти результат', e);
  }
}

function finish() {
  running = false;
  ui.setRunning(false);
  hasRun = true;
  ui.setStartLabel(t('btn.again'));
  if (byId('gauge').dataset.phase !== 'done') {
    ui.setPhase('idle');
    ui.setGaugeValue(0);
  }
}

// ───────────── Мова ─────────────

/** Текст помилки рушія: за кодом — перекладений, інакше — як є */
function errorText(msg) {
  if (msg.code === 'UNREACHABLE') return t('error.unreachable');
  if (msg.code === 'TRANSFER_FAILED') {
    const text = t('error.transfer', {
      phase: phaseName(msg.details?.phase),
      detail: msg.details?.detail ?? t('error.noData'),
    });
    return `${text}. ${t('error.rateLimitHint')}`;
  }
  return msg.message;
}

/** Футер із посиланням: текст перекладається, посилання лишається елементом */
function renderFooter() {
  const link = Object.assign(document.createElement('a'), {
    href: 'https://speed.cloudflare.com',
    target: '_blank',
    rel: 'noopener',
    textContent: 'Cloudflare',
  });
  const [before, after] = t('footer.text').split('{link}');
  byId('footer-text').replaceChildren(before, link, after ?? '');
}

/** Застосовує мову до всього інтерфейсу, включно з уже показаними результатами */
function applyLanguage(lang) {
  setLang(lang);
  document.documentElement.lang = getLang();
  document.title = t('meta.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
  applyDom(document);
  renderFooter();
  ui.setStartLabel(t(hasRun ? 'btn.again' : 'btn.start'));
  ui.relabel();
  if (lastResult && !running) {
    ui.showResults(lastResult);
    ui.showPlan(lastResult.download.mbps, settings.planMbps);
    ui.showDeltas(lastDeltas);
  }
  if (selected) detectServerLabel();
  charts.current?.updateLanguage();
  historyPanel.relabel();
}

/** Оновлює підпис сервера без повторного пінгу */
function detectServerLabel() {
  ui.showServer(selected.server, serverMeta, selected.latency);
}

init();
