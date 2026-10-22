/**
 * Сценарії використання в підсумку: позначки «підходить / ні» з причиною
 * і розгорнуте пояснення з усіма порогами (core/useCases.js).
 * Вантажиться окремим чанком лише після тесту.
 */
import { useCaseChecks, worstCheck } from '../core/useCases.js';
import { t } from '../i18n/index.js';
import { formatMbps, formatMs } from './format.js';

const $ = (sel) => /** @type {HTMLElement} */ (document.querySelector(sel));

/** Число й одиниця не розриваються між рядками («128 Мбіт/ с»): нерозривний пробіл і з'єднувач після «/» */
const unit = (key) => `\u00a0${t(key).replace('/', '/\u2060')}`;

/** Значення умови сценарію з одиницями: «34.2 мс», «2.4 Мбіт/с», «1.5%» */
function checkValue(c, value = c.value) {
  if (c.metric === 'loss') return `${value.toFixed(1)}%`;
  if (c.metric === 'download' || c.metric === 'upload') return `${formatMbps(value)}${unit('unit.mbps')}`;
  return `${formatMs(value)}${unit('unit.ms')}`;
}
/** Поріг без зайвих десяткових: «60 мс», «25 Мбіт/с», «1%» */
function limitValue(c) {
  if (c.metric === 'loss') return `${c.limit}%`;
  return `${c.limit}${unit(c.metric === 'download' || c.metric === 'upload' ? 'unit.mbps' : 'unit.ms')}`;
}
const metricName = (c) => t(`usecase.metric.${c.metric}`);
/** «джиттер 34.2 мс (треба < 15 мс)» */
const describeCheck = (c) =>
  t('usecase.check', {
    metric: metricName(c),
    value: checkValue(c),
    need: t(c.op === '<' ? 'usecase.need.lt' : 'usecase.need.gte', { limit: limitValue(c) }),
  });

/**
 * Позначки «підходить / ні» з причиною і розгорнуте пояснення з усіма порогами.
 * @param {import('../core/types.js').TestResult} r
 */
export function renderUseCases(r) {
  const cases = useCaseChecks({
    download: r.download.mbps,
    upload: r.upload.mbps,
    ping: r.ping.median,
    jitter: r.ping.jitter,
    loss: r.ping.loss,
  });
  const chips = [];
  const blocks = [];
  let latencyIssue = false;

  for (const [k, { ok, checks }] of Object.entries(cases)) {
    const name = t(`usecase.${k}`);
    const worst = worstCheck(checks);
    const failed = checks.filter((c) => !c.ok);
    if (failed.some((c) => c.metric === 'ping' || c.metric === 'jitter' || c.metric === 'loss')) latencyIssue = true;

    // Позначка: назва + коротко найгірша умова
    const li = document.createElement('li');
    li.className = ok ? 'ok' : 'bad';
    const icon = Object.assign(document.createElement('span'), { textContent: ok ? '✓' : '✕' });
    icon.setAttribute('aria-hidden', 'true');
    li.append(icon, ` ${name}`);
    if (worst) {
      li.append(
        Object.assign(document.createElement('span'), {
          className: 'usecases__reason',
          textContent: ` · ${metricName(worst)} ${checkValue(worst)}`,
        }),
      );
    }
    li.title = ok ? t('usecase.allOk') : failed.map(describeCheck).join('\n');
    li.setAttribute(
      'aria-label',
      ok ? t('usecase.yes', { name }) : t('usecase.noBecause', { name, reason: failed.map(describeCheck).join('; ') }),
    );
    chips.push(li);

    // Пояснення: навіщо сценарію ці метрики і кожна умова з фактичним значенням
    const block = document.createElement('section');
    block.className = `usecase-explain ${ok ? 'ok' : 'bad'}`;
    const head = document.createElement('h4');
    head.append(
      Object.assign(document.createElement('span'), { textContent: ok ? '✓' : '✕', ariaHidden: 'true' }),
      ` ${name}`,
    );
    const list = document.createElement('ul');
    list.append(
      ...checks.map((c) =>
        Object.assign(document.createElement('li'), {
          className: c.ok ? 'ok' : 'bad',
          textContent: `${c.ok ? '✓' : '✕'} ${describeCheck(c)}`,
        }),
      ),
    );
    block.append(head, Object.assign(document.createElement('p'), { textContent: t(`usecase.why.${k}`) }), list);
    blocks.push(block);
  }

  $('#usecases').replaceChildren(...chips);
  const advice = latencyIssue
    ? [Object.assign(document.createElement('p'), { className: 'usecases-advice', textContent: t('usecase.advice') })]
    : [];
  $('#usecases-explain').replaceChildren(...blocks, ...advice);
}
