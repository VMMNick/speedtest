/**
 * Реєстрація service worker і керування оновленням застосунку.
 * Лише в продакшн-збірці: у dev service worker заважав би HMR.
 */

/**
 * @param {object} opts
 * @param {(apply: () => void) => void} opts.onUpdateReady показати користувачу «Доступне оновлення»;
 *   `apply()` активує нову версію
 * @param {() => boolean} opts.canReload чи можна зараз перезавантажити сторінку (не посеред тесту)
 */
export function registerServiceWorker({ onUpdateReady, canReload }) {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  let updateRequested = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Перезавантажуємо лише якщо користувач сам натиснув «Оновити»
    if (updateRequested && canReload()) location.reload();
  });
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .then((reg) => {
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        next?.addEventListener('statechange', () => {
          if (next.state === 'installed' && navigator.serviceWorker.controller) {
            onUpdateReady(() => {
              updateRequested = true;
              next.postMessage({ type: 'SKIP_WAITING' });
            });
          }
        });
      });
    })
    .catch((e) => console.warn('Service worker не зареєстровано', e));
}
