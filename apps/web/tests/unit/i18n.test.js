import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Шлях відносно apps/web — тест не залежить від того, з якої теки його запущено */
const web = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
import { DICTIONARIES, t, setLang, loadLang, getLang, getLocale, detectLang } from '../../src/i18n/index.js';

// Англійська вантажиться окремим чанком — у тестах довантажуємо її заздалегідь
await loadLang('en');

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('словники', () => {
  const uk = DICTIONARIES.uk;
  const en = DICTIONARIES.en;

  it('однаковий набір ключів у всіх мовах', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(uk).sort());
  });

  it('однакові плейсхолдери {…} у перекладах', () => {
    for (const key of Object.keys(uk)) {
      expect(placeholders(en[key]), key).toEqual(placeholders(uk[key]));
    }
  });

  it('списки через «|» мають однакову довжину', () => {
    for (const key of ['unit.bytes', 'csv.header']) {
      expect(en[key].split('|')).toHaveLength(uk[key].split('|').length);
    }
  });

  it('в англійському словнику немає кирилиці (крім підпису кнопки мови)', () => {
    const allowed = new Set(['nav.lang', 'nav.langShort']);
    for (const [key, value] of Object.entries(en)) {
      if (!allowed.has(key)) expect(value, key).not.toMatch(/[А-Яа-яІіЇїЄєҐґ]/);
    }
  });
});

describe('t()', () => {
  afterEach(() => setLang('uk'));

  it('підставляє параметри', () => {
    setLang('en');
    expect(t('metric.minmax', { min: 10, max: 20 })).toBe('min 10 · max 20');
    expect(t('a11y.done', { grade: 'A', score: 95 })).toBe('Test complete. Stability grade A, 95 out of 100');
  });

  it('невідомий параметр лишається як є, невідомий ключ — повертається ключ', () => {
    expect(t('metric.minmax', { min: 1 })).toBe('мін 1 · макс {max}');
    expect(t('no.such.key')).toBe('no.such.key');
  });

  it('невідома мова → українська; локаль для дат', () => {
    expect(setLang('de')).toBe('uk');
    expect(getLang()).toBe('uk');
    expect(getLocale()).toBe('uk-UA');
    setLang('en');
    expect(getLocale()).toBe('en-GB');
  });
});

describe('detectLang', () => {
  it('українська, якщо вона серед бажаних мов браузера', () => {
    expect(detectLang(['uk-UA', 'en'])).toBe('uk');
    expect(detectLang(['en-US', 'uk'])).toBe('uk');
    expect(detectLang(['en-US'])).toBe('en');
    expect(detectLang(['de-DE', 'fr'])).toBe('en');
    expect(detectLang(undefined)).toBe('en');
  });
});

describe('жорстко прописаний текст в інтерфейсі', () => {
  // Увесь видимий текст має йти через t(): кирилиця в рядкових літералах UI-коду — це пропущений переклад
  // Усі модулі, що працюють з інтерфейсом: точки входу + ui/ + services/ (нові файли підхоплюються самі)
  const files = [
    'src/app.js',
    'src/analytics.js',
    ...readdirSync(web('src/ui')).map((f) => `src/ui/${f}`),
    ...readdirSync(web('src/services')).map((f) => `src/services/${f}`),
  ].filter((f) => f.endsWith('.js'));
  for (const file of files) {
    it(file, () => {
      const code = readFileSync(web(file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '') // блокові коментарі
        .replace(/(^|[^:])\/\/.*$/gm, '$1') // рядкові коментарі
        .replace(/console\.\w+\([^\n]*/g, ''); // журнали для розробника не перекладаються
      const literals = [...code.matchAll(/(['"`])((?:\\.|(?!\1).)*?)\1/g)].map((m) => m[2]);
      const offenders = literals.filter((s) => /[А-Яа-яІіЇїЄєҐґ]/.test(s));
      expect(offenders).toEqual([]);
    });
  }
});
