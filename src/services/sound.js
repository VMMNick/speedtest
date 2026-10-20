/**
 * Звук завершення тесту — синтезований через Web Audio API, без зовнішніх файлів.
 *
 * AudioContext можна створити лише під час жесту користувача, тому `unlock()`
 * викликається синхронно в обробнику кліку «Старт», а `play()` — пізніше, коли тест завершиться.
 */
export function createChime() {
  /** @type {AudioContext | null} */
  let ctx = null;

  return {
    unlock() {
      if (ctx) return;
      try {
        const Ctx = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
        ctx = new Ctx();
      } catch {
        /* Web Audio не підтримується */
      }
    },

    /** Три висхідні ноти (мі–ля–мі) */
    play() {
      if (!ctx) return;
      const t0 = ctx.currentTime;
      [659.25, 880, 1318.5].forEach((freq, i) => {
        const start = t0 + i * 0.09;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.12, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.55);
      });
    },
  };
}
