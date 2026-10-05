import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { DICTIONARIES, t, setLang, getLang, getLocale, detectLang } from '../src/i18n/index.js';

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
  const files = ['src/app.js', 'src/ui/UIController.js', 'src/ui/ChartManager.js', 'src/ui/ShareCard.js'];
  for (const file of files) {
    it(file, () => {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '') // блокові коментарі
        .replace(/(^|[^:])\/\/.*$/gm, '$1'); // рядкові коментарі
      const literals = [...code.matchAll(/(['"`])((?:\\.|(?!\1).)*?)\1/g)].map((m) => m[2]);
      const offenders = literals.filter((s) => /[А-Яа-яІіЇїЄєҐґ]/.test(s) && !/^Не вдалося|^Service worker/.test(s));
      expect(offenders).toEqual([]);
    });
  }
});
