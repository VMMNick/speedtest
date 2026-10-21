/**
 * Сторінка «Конфіденційність»: статичний текст + мова й тема, як на інших сторінках.
 */
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import { ThemeManager } from './ui/ThemeManager.js';
import { StorageManager } from './services/StorageManager.js';
import { t, setLang, loadLang, getLang, detectLang, applyDom } from './i18n/index.js';
import { byId } from './ui/dom.js';

const storage = new StorageManager();
let settings = storage.getSettings();

const theme = new ThemeManager({
  initial: settings.theme,
  onSave: (mode) => (settings = storage.saveSettings({ theme: mode })),
});

function applyLanguage(lang) {
  setLang(lang);
  document.documentElement.lang = getLang();
  document.title = t('privacy.pageTitle');
  applyDom(document);
}

applyLanguage(await loadLang(settings.lang ?? detectLang(navigator.languages)));
byId('btn-theme').addEventListener('click', () => theme.toggle());
byId('btn-lang').addEventListener('click', async () => {
  const next = getLang() === 'uk' ? 'en' : 'uk';
  settings = storage.saveSettings({ lang: next });
  applyLanguage(await loadLang(next));
});
