/**
 * Точка входу: ініціалізує модулі та оркеструє тест.
 *
 *  ServerSelector ──► (server) ──► speed.worker (NetworkEngine)
 *                                         │ postMessage
 *                                         ▼
 *        UIController / ChartManager ◄── app.js ──► StorageManager
 */
import { UIController } from './ui/UIController.js';
import { ChartManager } from './ui/ChartManager.js';
import { ThemeManager } from './ui/ThemeManager.js';
import { StorageManager } from './services/StorageManager.js';
import { ServerSelector } from './services/ServerSelector.js';

const ui = new UIController();
const charts = new ChartManager();
const storage = new StorageManager();
const selector = new ServerSelector();

let settings = storage.getSettings();
const theme = new ThemeManager({
  initial: settings.theme,
  onSave: (mode) => (settings = storage.saveSettings({ theme: mode })),
});
theme.addEventListener('change', () => charts.updateTheme());

let worker = null;
let selected = null; // { server, latency }
let running = false;

// ───────────── Ініціалізація ─────────────

async function init() {
  ui.setSound(settings.sound);
  charts.initLive(document.getElementById('live-chart'));
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
  document.getElementById('btn-clear').addEventListener('click', async () => {
    if (!(await storage.getHistory()).length) return;
    await storage.clearHistory();
    await refreshHistory();
    ui.toast('Історію очищено');
  });
  document.getElementById('btn-export').addEventListener('click', exportCSV);

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, dialog[open]')) return;
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
  ui.setRunning(true);
  charts.resetLive();
  unlockAudio();

  if (!selected?.reachable) {
    ui.setPhase('connecting');
    await detectServer();
    if (!selected?.reachable) {
      finish();
      return;
    }
  }
  getWorker().postMessage({ type: 'start', server: selected.server });
}

function stopTest() {
  if (!running) return;
  worker?.postMessage({ type: 'abort' });
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'phase':
      ui.setPhase(msg.phase);
      ['ping', 'download', 'upload'].forEach((m) => ui.setMetricLive(m, m === msg.phase));
      ui.setMetricLive('jitter', msg.phase === 'ping');
      break;

    case 'progress':
      ui.setPhaseProgress(msg.progress);
      if (msg.phase === 'ping') {
        if (msg.value != null) {
          ui.setGaugeValue(msg.value, { decimals: 'ms' });
          ui.setMetric('ping', msg.value);
        }
      } else {
        ui.setGaugeValue(msg.value);
        ui.setMetric(msg.phase, msg.value);
        charts.pushLive(msg.phase, msg.t, msg.value);
      }
      break;

    case 'result':
      ui.setMetricLive(msg.phase, false);
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

async function onDone(results) {
  results.server = { ...results.server, latency: selected?.latency ?? null };
  ui.showResults(results);
  ui.setPhase('done');
  ui.setPhaseProgress(1);
  ui.setGaugeValue(results.download.mbps);
  finish();
  if (settings.sound) playChime();
  try {
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

async function refreshHistory() {
  const entries = await storage.getHistory();
  ui.renderHistory(entries, {
    onDelete: async (id) => {
      await storage.deleteResult(id);
      refreshHistory();
    },
  });
  charts.renderHistory(document.getElementById('history-chart'), entries);
}

async function openHistory() {
  ui.openHistory();
  await refreshHistory();
}

async function exportCSV() {
  const entries = await storage.getHistory();
  if (!entries.length) return ui.toast('Історія порожня');
  const blob = new Blob(['﻿' + StorageManager.toCSV(entries)], { type: 'text/csv;charset=utf-8' });
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
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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
