/**
 * Точка входу: ініціалізує модулі та оркеструє тест.
 *
 *  ServerSelector ──► (server) ──► speed.worker (NetworkEngine)
 *                                         │ postMessage
 *                                         ▼
 *        UIController / ChartManager ◄── app.js ──► StorageManager
 */
// Шрифти локально (без Google Fonts): unicode-range → браузер вантажить лише потрібні підмножини (латиниця/кирилиця)
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import { UIController, formatMbps, formatMs } from './ui/UIController.js';
import { ThemeManager } from './ui/ThemeManager.js';
import { StorageManager } from './services/StorageManager.js';
import { LIGHT_CONFIG, detectLightMode, mergeDeep } from './core/config.js';
import { compareResults, filterByPeriod } from './core/insights.js';
import { ServerSelector } from './services/ServerSelector.js';

const PHASE_NAMES = { ping: 'Пінг', download: 'Завантаження', upload: 'Вивантаження' };

const ui = new UIController();

// ───────────── Графіки (ліниво) ─────────────
// Chart.js — це ~90% усього JS. Він вантажиться окремим чанком лише коли знадобиться:
// при наведенні/фокусі на «Старт» чи «Історію» (передзавантаження) або на першу вимогу.
// Так він не впливає на перше відмальовування і не рахується як «невикористаний JS».

/** @type {import('./ui/ChartManager.js').ChartManager | null} */
let charts = null;
/** @type {Promise<import('./ui/ChartManager.js').ChartManager | null> | null} */
let chartsPromise = null;

function loadCharts() {
  chartsPromise ??= import('./ui/ChartManager.js')
    .then(({ ChartManager }) => {
      charts = new ChartManager();
      charts.initLive(document.getElementById('live-chart'));
      return charts;
    })
    .catch((e) => {
      // Напр. офлайн: тест працює і без графіків, наступний виклик спробує знову
      console.warn('Не вдалося завантажити графіки', e);
      chartsPromise = null;
      return null;
    });
  return chartsPromise;
}

const storage = new StorageManager();
const selector = new ServerSelector();

let settings = storage.getSettings();
const theme = new ThemeManager({
  initial: settings.theme,
  onSave: (mode) => (settings = storage.saveSettings({ theme: mode })),
});
theme.addEventListener('change', () => charts?.updateTheme());

let worker = null;
let selected = null; // { server, latency }
let running = false;
/** Пінги поточного тесту — для спарклайна */
let pingLive = [];

// ───────────── Ініціалізація ─────────────

/** Економний режим: Save-Data або повільна мережа (Network Information API, де підтримується). */
const connection = /** @type {any} */ (navigator).connection;
const lightMode = () => detectLightMode(connection);
const showModeNote = () => (document.getElementById('mode-note').hidden = !lightMode());

async function init() {
  ui.setSound(settings.sound);
  showModeNote();
  connection?.addEventListener?.('change', showModeNote);
  // Передзавантаження графіків за наміром користувача
  for (const id of ['btn-start', 'btn-history']) {
    const el = document.getElementById(id);
    ['pointerenter', 'focus', 'touchstart'].forEach((ev) =>
      el.addEventListener(ev, () => loadCharts(), { once: true, passive: true }),
    );
  }
  await storage.init();
  bindEvents();
  detectServer();
}

async function detectServer() {
  ui.el.serverName.textContent = 'Визначаю…';
  selected = await selector.selectBest();
  const meta = await selector.fetchMeta(selected.server);
  ui.showServer(selected.server, meta, selected.latency);
  if (!selected.reachable) ui.toast('Сервер вимірювань недоступний. Перевірте з’єднання.', 'error');
}

function bindEvents() {
  ui.el.start.addEventListener('click', startTest);
  ui.el.stop.addEventListener('click', stopTest);
  document.getElementById('btn-theme').addEventListener('click', () => theme.toggle());
  document.getElementById('btn-sound').addEventListener('click', () => {
    settings = storage.saveSettings({ sound: !settings.sound });
    ui.setSound(settings.sound);
  });
  document.getElementById('btn-history').addEventListener('click', openHistory);
  // Очищення — у два кліки: перший просить підтвердження, другий (протягом 4 с) очищає
  const clearBtn = document.getElementById('btn-clear');
  let confirmTimer = 0;
  const resetClear = () => {
    clearTimeout(confirmTimer);
    clearBtn.classList.remove('is-confirm');
    clearBtn.textContent = 'Очистити історію';
  };
  clearBtn.addEventListener('click', async () => {
    if (!(await storage.getHistory()).length) return;
    if (!clearBtn.classList.contains('is-confirm')) {
      clearBtn.classList.add('is-confirm');
      clearBtn.textContent = 'Точно очистити? Натисніть ще раз';
      confirmTimer = window.setTimeout(resetClear, 4000);
      return;
    }
    resetClear();
    await storage.clearHistory();
    await refreshHistory();
    ui.toast('Історію очищено');
  });
  ui.el.modal.addEventListener('close', resetClear);

  document.getElementById('history-period').addEventListener('change', refreshHistory);

  // Тариф провайдера: зберігається і одразу перераховує частку
  const planInput = /** @type {HTMLInputElement} */ (document.getElementById('plan-input'));
  if (settings.planMbps) planInput.value = String(settings.planMbps);
  planInput.addEventListener('input', () => {
    const v = Number(planInput.value);
    settings = storage.saveSettings({ planMbps: v > 0 ? v : null });
    if (lastResult) ui.showPlan(lastResult.download.mbps, settings.planMbps);
  });
  document.getElementById('btn-export').addEventListener('click', exportCSV);

  document.addEventListener('keydown', (e) => {
    // Enter/Space на кнопці чи посиланні — це їхній власний клік, не старт тесту
    const target = /** @type {Element} */ (e.target);
    if (target.closest('input, textarea, select, button, a, [contenteditable], dialog[open]')) return;
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter' && !running) startTest();
    if (e.key === 'Escape' && running) stopTest();
  });

  window.addEventListener('online', () => ui.toast('З’єднання відновлено', 'success'));
  window.addEventListener('offline', () => {
    ui.toast('Немає підключення до інтернету', 'error');
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
      ui.toast('Помилка фонового воркера', 'error');
      worker?.terminate();
      worker = null;
    });
  }
  return worker;
}

async function startTest() {
  if (running) return;
  if (!navigator.onLine) {
    ui.toast('Немає підключення до інтернету', 'error');
    return;
  }
  running = true;
  pingLive = [];
  ui.setRunning(true);
  unlockAudio(); // синхронно, поки діє жест користувача
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
      ui.announce(`${PHASE_NAMES[msg.phase]}…`);
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
        charts?.pushLive(msg.phase, msg.t, msg.value);
      }
      break;

    case 'result':
      ui.setMetricLive(msg.phase, false);
      ui.announce(
        msg.phase === 'ping'
          ? `Пінг ${formatMs(msg.data.median)} мс, джиттер ${formatMs(msg.data.jitter)} мс`
          : `${PHASE_NAMES[msg.phase]}: ${formatMbps(msg.data.mbps)} Мбіт/с`,
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
      ui.toast('Тест зупинено');
      finish();
      break;

    case 'error':
      ui.toast(`Помилка: ${msg.message}`, 'error', 7000);
      finish();
      break;
  }
}

/** Останній результат — щоб перерахувати частку від тарифу при зміні поля */
let lastResult = null;

async function onDone(results) {
  lastResult = results;
  results.server = { ...results.server, latency: selected?.latency ?? null };
  ui.showResults(results);
  ui.announce(`Тест завершено. Оцінка стабільності ${results.stability.grade}, ${results.stability.score} зі 100`);
  ui.setPhase('done');
  ui.setPhaseProgress(1);
  ui.setGaugeValue(results.download.mbps);
  ui.setSparkline(results.ping.samples ?? []);
  ui.showPlan(results.download.mbps, settings.planMbps);
  finish();
  if (settings.sound) playChime();
  try {
    // Порівнюємо з попереднім тестом ДО збереження нового
    const [prev] = await storage.getHistory();
    ui.showDeltas(compareResults(prev, results));
    await storage.addResult(results);
  } catch (e) {
    console.warn('Не вдалося зберегти результат', e);
  }
}

function finish() {
  running = false;
  ui.setRunning(false);
  ui.setStartLabel('Ще раз');
  if (document.getElementById('gauge').dataset.phase !== 'done') {
    ui.setPhase('idle');
    ui.setGaugeValue(0);
  }
}

// ───────────── Історія ─────────────

const historyPeriod = () => /** @type {HTMLSelectElement} */ (document.getElementById('history-period')).value;

/** Історія з урахуванням вибраного періоду */
async function visibleHistory() {
  return filterByPeriod(await storage.getHistory(), historyPeriod());
}

async function refreshHistory() {
  const entries = await visibleHistory();
  ui.renderHistory(entries, {
    filtered: historyPeriod() !== 'all',
    onDelete: async (id) => {
      await storage.deleteResult(id);
      refreshHistory();
    },
  });
  (await loadCharts())?.renderHistory(document.getElementById('history-chart'), entries);
}

async function openHistory() {
  ui.openHistory();
  await refreshHistory();
}

async function exportCSV() {
  const entries = await visibleHistory();
  if (!entries.length) return ui.toast('Немає записів для експорту');
  const blob = new Blob(['\uFEFF' + StorageManager.toCSV(entries)], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `speedtest-history-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ───────────── Звук ─────────────
// Синтезований через Web Audio API — без зовнішніх файлів (public/assets/sounds/ можна
// використати для власних семплів).

let audioCtx = null;
function unlockAudio() {
  if (!settings.sound || audioCtx) return;
  try {
    const Ctx = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    audioCtx = new Ctx();
  } catch {
    /* audio unsupported */
  }
}

function playChime() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  [659.25, 880, 1318.5].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t + i * 0.09);
    gain.gain.linearRampToValueAtTime(0.12, t + i * 0.09 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.5);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t + i * 0.09);
    osc.stop(t + i * 0.09 + 0.55);
  });
}

init();
