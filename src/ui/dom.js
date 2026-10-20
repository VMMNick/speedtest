/**
 * Дрібні DOM-утиліти, спільні для модулів інтерфейсу.
 */

/**
 * @template {HTMLElement} [T=HTMLElement]
 * @param {string} id
 * @returns {T}
 */
export const byId = (id) => /** @type {T} */ (document.getElementById(id));

/** Зберегти Blob як файл (через тимчасове посилання з download). */
export function downloadBlob(blob, filename) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
