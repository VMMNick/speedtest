/**
 * Форматування чисел для інтерфейсу (спільне для головної сторінки, аналітики й картки «Поділитися»).
 */
import { t } from '../i18n/index.js';

export const formatMbps = (v) => {
  if (v == null || Number.isNaN(v)) return '—';
  // ≥ 100 — цілі числа (у т. ч. гігабітні канали: «1234», а не «1.23k» — так однозначніше й парситься)
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
};
export const formatMs = (v) => (v == null || Number.isNaN(v) ? '—' : v >= 100 ? v.toFixed(0) : v.toFixed(1));
export const formatBytes = (b) => {
  const u = t('unit.bytes').split('|');
  if (!b) return `0 ${u[0]}`;
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
};
