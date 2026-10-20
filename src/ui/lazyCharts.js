/**
 * Ліниве завантаження графіків.
 *
 * Chart.js — це ~90% усього JS. Він вантажиться окремим чанком лише коли знадобиться:
 * при наведенні/фокусі на «Старт» чи «Історію» (передзавантаження) або на першу вимогу.
 * Так він не впливає на перше відмальовування і не рахується як «невикористаний JS».
 */

/** @typedef {import('./ChartManager.js').ChartManager} ChartManager */

/**
 * @param {() => HTMLCanvasElement} getLiveCanvas полотно живого графіка
 */
export function createChartsLoader(getLiveCanvas) {
  /** @type {ChartManager | null} */
  let charts = null;
  /** @type {Promise<ChartManager | null> | null} */
  let pending = null;

  return {
    /** Уже завантажений менеджер графіків або null */
    get current() {
      return charts;
    },

    /** @returns {Promise<ChartManager | null>} */
    load() {
      pending ??= import('./ChartManager.js')
        .then(({ ChartManager }) => {
          charts = new ChartManager();
          charts.initLive(getLiveCanvas());
          return charts;
        })
        .catch((e) => {
          // Напр. офлайн: тест працює і без графіків, наступний виклик спробує знову
          console.warn('Не вдалося завантажити графіки', e);
          pending = null;
          return null;
        });
      return pending;
    },

    /** Передзавантаження за наміром користувача (наведення, фокус, дотик) */
    preloadOn(elements) {
      for (const el of elements) {
        ['pointerenter', 'focus', 'touchstart'].forEach((ev) =>
          el.addEventListener(ev, () => this.load(), { once: true, passive: true }),
        );
      }
    },
  };
}
