/**
 * Мінімальна i18n без залежностей.
 *
 *   t('plan.text', { pct: '87%' })   — переклад з підстановкою {параметрів}
 *   applyDom(document)               — перекладає статичну розмітку:
 *     data-i18n="key"                  → textContent
 *     data-i18n-attr="title:key;aria-label:key2"  → атрибути
 *
 * Відсутній ключ → українська → сам ключ (видно в UI, тест це ловить).
 */
import uk from './uk.js';
import en from './en.js';

export const DICTIONARIES = { uk, en };
export const LANGS = /** @type {const} */ (['uk', 'en']);
const LOCALES = { uk: 'uk-UA', en: 'en-GB' };

let current = 'uk';

/**
 * Мова за налаштуваннями браузера: українська, якщо вона є серед бажаних, інакше англійська.
 * @param {readonly string[] | undefined} languages navigator.languages
 */
export function detectLang(languages) {
  return (languages ?? []).some((l) => l?.toLowerCase().startsWith('uk')) ? 'uk' : 'en';
}

export const getLang = () => current;
/** Локаль для toLocaleString (дати) */
export const getLocale = () => LOCALES[current];

/** @param {string} lang */
export function setLang(lang) {
  current = DICTIONARIES[lang] ? lang : 'uk';
  return current;
}

/**
 * @param {string} key
 * @param {Record<string, string | number>} [params]
 */
export function t(key, params) {
  const raw = DICTIONARIES[current][key] ?? uk[key] ?? key;
  return params ? raw.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m)) : raw;
}

/** Перекладає статичну розмітку під root. */
export function applyDom(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.getAttribute('data-i18n'));
  }
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.getAttribute('data-i18n-attr').split(';')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  }
}
