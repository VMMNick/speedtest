/**
 * ThemeManager — світла / темна тема.
 * 'system' слідує за налаштуваннями ОС і реагує на їх зміну.
 */
export class ThemeManager extends EventTarget {
  constructor({ initial = 'system', onSave } = {}) {
    super();
    this.mode = initial;
    this.onSave = onSave ?? (() => {});
    this.media = window.matchMedia('(prefers-color-scheme: dark)');
    this.media.addEventListener('change', () => {
      if (this.mode === 'system') this.apply();
    });
    this.apply();
  }

  /** Фактична тема, яка зараз застосована. */
  get resolved() {
    if (this.mode === 'system') return this.media.matches ? 'dark' : 'light';
    return this.mode;
  }

  set(mode) {
    this.mode = mode;
    this.onSave(mode);
    this.apply();
  }

  toggle() {
    this.set(this.resolved === 'dark' ? 'light' : 'dark');
  }

  apply() {
    const theme = this.resolved;
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b1020' : '#f4f6fb');
    this.dispatchEvent(new CustomEvent('change', { detail: { theme } }));
  }
}
