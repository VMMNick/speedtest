/**
 * Модалка історії: список, графік, фільтр за періодом, експорт CSV і очищення.
 * Рендер рядків — у UIController; тут — поведінка і зв'язок зі сховищем.
 */
import { filterByPeriod } from '../core/insights.js';
import { StorageManager } from '../services/StorageManager.js';
import { t } from '../i18n/index.js';
import { byId, downloadBlob } from './dom.js';

/** Byte Order Mark — щоб Excel правильно відкрив кирилицю в UTF-8 */
const BOM = String.fromCharCode(0xfeff);

export class HistoryPanel {
  /**
   * @param {object} deps
   * @param {import('./UIController.js').UIController} deps.ui
   * @param {StorageManager} deps.storage
   * @param {() => Promise<import('./ChartManager.js').ChartManager | null>} deps.loadCharts
   */
  constructor({ ui, storage, loadCharts }) {
    this.ui = ui;
    this.storage = storage;
    this.loadCharts = loadCharts;
    this.period = /** @type {HTMLSelectElement} */ (byId('history-period'));
    this.clearBtn = byId('btn-clear');
    this.confirmTimer = 0;
  }

  bind() {
    byId('btn-history').addEventListener('click', () => this.open());
    byId('btn-export').addEventListener('click', () => this.exportCSV());
    this.period.addEventListener('change', () => this.refresh());
    // Очищення — у два кліки: перший просить підтвердження, другий (протягом 4 с) очищає
    this.clearBtn.addEventListener('click', () => this.onClear());
    this.ui.el.modal.addEventListener('close', () => this.resetClear());
  }

  async open() {
    this.ui.openHistory();
    await this.refresh();
  }

  get isOpen() {
    return this.ui.el.modal.open;
  }

  /** Історія з урахуванням вибраного періоду */
  async visible() {
    return filterByPeriod(await this.storage.getHistory(), this.period.value);
  }

  async refresh() {
    const entries = await this.visible();
    this.ui.renderHistory(entries, {
      filtered: this.period.value !== 'all',
      onDelete: async (id) => {
        await this.storage.deleteResult(id);
        this.refresh();
      },
    });
    (await this.loadCharts())?.renderHistory(byId('history-chart'), entries);
  }

  async exportCSV() {
    const entries = await this.visible();
    if (!entries.length) return this.ui.toast(t('history.nothingToExport'));
    const csv = BOM + StorageManager.toCSV(entries, t('csv.header').split('|'));
    downloadBlob(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
      `speedtest-history-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }

  async onClear() {
    if (!(await this.storage.getHistory()).length) return;
    if (!this.clearBtn.classList.contains('is-confirm')) {
      this.clearBtn.classList.add('is-confirm');
      this.clearBtn.textContent = t('history.clearConfirm');
      this.confirmTimer = window.setTimeout(() => this.resetClear(), 4000);
      return;
    }
    this.resetClear();
    await this.storage.clearHistory();
    await this.refresh();
    this.ui.toast(t('history.cleared'));
  }

  resetClear() {
    clearTimeout(this.confirmTimer);
    this.clearBtn.classList.remove('is-confirm');
    this.clearBtn.textContent = t('history.clear');
  }

  /** Після зміни мови */
  relabel() {
    if (!this.clearBtn.classList.contains('is-confirm')) this.clearBtn.textContent = t('history.clear');
    if (this.isOpen) this.refresh();
  }
}
