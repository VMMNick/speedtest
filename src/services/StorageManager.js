/**
 * StorageManager — історія тестів (IndexedDB з фолбеком на localStorage)
 * та налаштування користувача (localStorage).
 */
import { CONFIG } from '../core/config.js';

const DB_NAME = 'speedtest-db';
const DB_VERSION = 1;
const STORE = 'history';
const LS_HISTORY = 'speedtest:history';
const LS_SETTINGS = 'speedtest:settings';

/** Заголовки CSV за замовчуванням (застосунок передає локалізовані) */
const DEFAULT_CSV_HEADER = [
  'Дата',
  'Сервер',
  'Пінг, мс',
  'Джиттер, мс',
  'Втрати, %',
  'Download, Мбіт/с',
  'Upload, Мбіт/с',
  'Стабільність',
];

/** planMbps — тариф провайдера (Мбіт/с); lang — мова інтерфейсу (null — за браузером) */
const DEFAULT_SETTINGS = { theme: 'system', sound: true, planMbps: null, lang: null };

const promisify = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

function safeLocalStorage() {
  try {
    const ls = globalThis.localStorage;
    const k = '__probe__';
    ls.setItem(k, '1');
    ls.removeItem(k);
    return ls;
  } catch {
    return null;
  }
}

export class StorageManager {
  constructor({ maxEntries = CONFIG.history.maxEntries } = {}) {
    this.maxEntries = maxEntries;
    this.db = null;
    this.ls = safeLocalStorage();
    this.memory = []; // останній фолбек, якщо сховища недоступні
  }

  async init() {
    if (!globalThis.indexedDB) return this;
    try {
      this.db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const store = req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('IndexedDB blocked'));
      });
    } catch (e) {
      console.warn('[Storage] IndexedDB недоступна, використовую localStorage', e);
      this.db = null;
    }
    return this;
  }

  _tx(mode = 'readonly') {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  // ───────────── Історія ─────────────

  async addResult(result) {
    const entry = { ...result };
    delete entry.id;
    if (this.db) {
      const id = await promisify(this._tx('readwrite').add(entry));
      await this._trim();
      return { ...entry, id };
    }
    const list = this._lsHistory();
    const id = (list[0]?.id ?? 0) + 1;
    list.unshift({ ...entry, id });
    this._lsSave(list.slice(0, this.maxEntries));
    return { ...entry, id };
  }

  /**
   * Історія, найновіші — першими.
   * @returns {Promise<import('../core/types.js').TestResult[]>}
   */
  async getHistory() {
    if (this.db) {
      const all = await promisify(this._tx().getAll());
      return all.sort((a, b) => b.timestamp - a.timestamp);
    }
    return this._lsHistory();
  }

  async deleteResult(id) {
    if (this.db) return promisify(this._tx('readwrite').delete(id));
    this._lsSave(this._lsHistory().filter((e) => e.id !== id));
  }

  async clearHistory() {
    if (this.db) return promisify(this._tx('readwrite').clear());
    this._lsSave([]);
  }

  async _trim() {
    const all = await this.getHistory();
    const extra = all.slice(this.maxEntries);
    if (!extra.length) return;
    const store = this._tx('readwrite');
    await Promise.all(extra.map((e) => promisify(store.delete(e.id))));
  }

  _lsHistory() {
    if (!this.ls) return this.memory;
    try {
      return JSON.parse(this.ls.getItem(LS_HISTORY)) || [];
    } catch {
      return [];
    }
  }

  _lsSave(list) {
    if (!this.ls) {
      this.memory = list;
      return;
    }
    try {
      this.ls.setItem(LS_HISTORY, JSON.stringify(list));
    } catch (e) {
      console.warn('[Storage] Не вдалося зберегти історію', e);
    }
  }

  // ───────────── Налаштування ─────────────

  getSettings() {
    try {
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(this.ls?.getItem(LS_SETTINGS)) || {}) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  saveSettings(patch) {
    const next = { ...this.getSettings(), ...patch };
    try {
      this.ls?.setItem(LS_SETTINGS, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    return next;
  }

  /**
   * Експорт історії у CSV.
   * @param {import('../core/types.js').TestResult[]} entries
   * @param {string[]} [head] заголовки колонок (локалізовані)
   */
  static toCSV(entries, head = DEFAULT_CSV_HEADER) {
    const rows = entries.map((e) => [
      new Date(e.timestamp).toISOString(),
      e.server?.name ?? '',
      e.ping?.median?.toFixed(1),
      e.ping?.jitter?.toFixed(1),
      e.ping?.loss?.toFixed(1),
      e.download?.mbps?.toFixed(2),
      e.upload?.mbps?.toFixed(2),
      e.stability?.score,
    ]);
    return [head, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  }
}
