/**
 * «Поділитися»: посилання з результатом (#r=…), PNG-картка, Web Share API,
 * а також показ результату, що прийшов за посиланням.
 */
import { parseShareHash, shareUrl } from '../core/share.js';
import { t } from '../i18n/index.js';
import { formatMbps, formatMs } from './format.js';
import { byId, downloadBlob } from './dom.js';

/** Мінімальні дані для картки з повного результату */
const toShared = (r) => ({
  t: r.timestamp,
  d: r.download.mbps,
  u: r.upload.mbps,
  p: r.ping.median,
  j: r.ping.jitter,
  l: r.ping.loss,
  s: r.stability.score,
  g: r.stability.grade,
  n: r.server?.name,
});

export class SharePanel {
  /**
   * @param {object} deps
   * @param {import('./UIController.js').UIController} deps.ui
   * @param {() => import('../core/types.js').TestResult | null} deps.getResult останній результат
   * @param {() => boolean} deps.isRunning
   */
  constructor({ ui, getResult, isRunning }) {
    this.ui = ui;
    this.getResult = getResult;
    this.isRunning = isRunning;
  }

  bind() {
    const shareBtn = byId('btn-share');
    // Web Share API є переважно на мобільних — там це найзручніший варіант
    shareBtn.hidden = !('share' in navigator);
    shareBtn.addEventListener('click', () => this.nativeShare());
    byId('btn-copy-link').addEventListener('click', () => this.copyLink());
    byId('btn-save-image').addEventListener('click', () => this.saveImage());
    byId('btn-shared-close').addEventListener('click', () => this.hideShared());
    // Посилання вставили у вже відкриту вкладку — сторінка не перезавантажується, лише змінюється hash
    window.addEventListener('hashchange', () => !this.isRunning() && this.showFromUrl());
  }

  /** Результат із посилання (#r=…) показується одразу при відкритті */
  showFromUrl() {
    const shared = parseShareHash(location.hash);
    if (shared === undefined) return;
    if (shared === null) {
      this.ui.toast(t('share.broken'), 'error');
      return;
    }
    this.ui.showShared(shared);
  }

  hideShared() {
    this.ui.hideShared();
    if (location.hash.startsWith('#r=')) history.replaceState(null, '', location.pathname + location.search);
  }

  async makeImage(result) {
    const { renderShareCard, canvasToPng } = await import('./ShareCard.js');
    return canvasToPng(await renderShareCard(toShared(result)));
  }

  async nativeShare() {
    const r = this.getResult();
    if (!r) return;
    const url = shareUrl(r, location.href);
    const text = t('share.text', {
      down: formatMbps(r.download.mbps),
      up: formatMbps(r.upload.mbps),
      ping: formatMs(r.ping.median),
    });
    const title = t('brand.full');
    try {
      const file = new File([await this.makeImage(r)], 'speedtest.png', { type: 'image/png' });
      const withFile = { title, text, url, files: [file] };
      await navigator.share(navigator.canShare?.(withFile) ? withFile : { title, text, url });
    } catch (e) {
      if (e?.name !== 'AbortError') this.ui.toast(t('share.failed'), 'error');
    }
  }

  async copyLink() {
    const r = this.getResult();
    if (!r) return;
    try {
      await navigator.clipboard.writeText(shareUrl(r, location.href));
      this.ui.toast(t('share.copied'), 'success');
    } catch {
      this.ui.toast(t('share.copyFailed'), 'error');
    }
  }

  async saveImage() {
    const r = this.getResult();
    if (!r) return;
    const stamp = new Date(r.timestamp).toISOString().slice(0, 16).replace(/[:T]/g, '-');
    downloadBlob(await this.makeImage(r), `speedtest-${stamp}.png`);
  }
}
