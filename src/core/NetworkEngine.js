/**
 * NetworkEngine — рушій вимірювань: пінг, завантаження, вивантаження.
 *
 * Не залежить від DOM: працює у Web Worker або в Node (тести).
 * Усі побічні ефекти (fetch, upload, таймер) можна підмінити через конструктор.
 */
import { CONFIG, mergeDeep } from './config.js';
import * as M from './MetricsCalculator.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isAbort = (e) => e?.name === 'AbortError';

/** Вивантаження через fetch. Content-Type text/plain → «простий» CORS-запит без preflight. */
export async function fetchUpload(fetchImpl, url, body, onBytes, signal) {
  const res = await fetchImpl(url, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await res.arrayBuffer().catch(() => {});
  onBytes(body.size ?? body.byteLength ?? 0);
}

export class NetworkEngine {
  /**
   * @param {object} opts
   * @param {import('./types.js').Server} opts.server Елемент із SERVERS
   * @param {object} [opts.config] Перевизначення CONFIG (глибоке злиття)
   * @param {typeof fetch} [opts.fetchImpl]
   * @param {import('./types.js').UploadFn} [opts.uploadImpl]
   * @param {() => number} [opts.now]
   * @param {(event: object) => void} [opts.onEvent] Колбек подій прогресу
   * @param {Partial<Performance>} [opts.perf] Для точних Resource Timing (у воркері)
   */
  constructor({ server, config = {}, fetchImpl, uploadImpl, now, onEvent, perf }) {
    if (!server) throw new Error('NetworkEngine: server is required');
    this.server = server;
    this.cfg = mergeDeep(CONFIG, config);
    this.fetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.upload = uploadImpl ?? ((url, body, onBytes, signal) => fetchUpload(this.fetch, url, body, onBytes, signal));
    this.now = now ?? (() => performance.now());
    this.emit = onEvent ?? (() => {});
    this.perf = perf ?? null;
    this.aborted = false;
    this.controllers = new Set();
    this.pingCounter = 0;
    // Download/upload теж пишуть записи в буфер Resource Timing (≈250 за замовчуванням).
    // Збільшуємо його, щоб записи пінгів не губилися.
    this.perf?.setResourceTimingBufferSize?.(1000);
  }

  /** Зупиняє всі активні запити. */
  abort() {
    this.aborted = true;
    for (const c of this.controllers) c.abort();
    this.controllers.clear();
  }

  _controller() {
    const c = new AbortController();
    this.controllers.add(c);
    return c;
  }

  _release(c) {
    this.controllers.delete(c);
  }

  _checkAbort() {
    if (this.aborted) throw new DOMException('Test aborted', 'AbortError');
  }

  /** Повний цикл: пінг → download → upload. */
  async run() {
    const startedAt = Date.now();
    this.emit({ type: 'phase', phase: 'ping' });
    const ping = await this.measurePing();
    this._checkAbort();
    this.emit({ type: 'result', phase: 'ping', data: ping });

    this.emit({ type: 'phase', phase: 'download' });
    const download = await this.measureDownload();
    this._checkAbort();
    this.emit({ type: 'result', phase: 'download', data: download });

    this.emit({ type: 'phase', phase: 'upload' });
    const upload = await this.measureUpload();
    this._checkAbort();
    this.emit({ type: 'result', phase: 'upload', data: upload });

    const loadedPing = Math.max(download.loadedLatency.median, upload.loadedLatency.median);
    const bloat = M.bufferbloat(ping.median, loadedPing);
    const speedCv = (M.variation(download.speeds) + M.variation(upload.speeds)) / 2;
    const stability = M.stabilityScore({
      ping: ping.median,
      jitter: ping.jitter,
      loss: ping.loss,
      bloatMs: bloat.delta,
      speedCv,
    });

    return {
      timestamp: startedAt,
      durationMs: Date.now() - startedAt,
      server: { id: this.server.id, name: this.server.name },
      ping,
      download,
      upload,
      bufferbloat: bloat,
      stability,
      useCases: M.useCases({
        download: download.mbps,
        upload: upload.mbps,
        ping: ping.median,
        jitter: ping.jitter,
        loss: ping.loss,
      }),
    };
  }

  // ───────────────────────────── PING ─────────────────────────────

  /** Один пінг. Повертає RTT у мс або null (втрата/таймаут). */
  async singlePing(timeoutMs = this.cfg.ping.timeoutMs) {
    const c = this._controller();
    const timer = setTimeout(() => c.abort(), timeoutMs);
    const sep = this.server.pingUrl.includes('?') ? '&' : '?';
    const url = `${this.server.pingUrl}${sep}_=${++this.pingCounter}`;
    // Очищаємо буфер перед КОЖНИМ пінгом: якщо він переповниться, запис не з'явиться,
    // і вимір тихо перейде на wall-clock (завищений) — це спотворює bufferbloat.
    this.perf?.clearResourceTimings?.();
    const t0 = this.now();
    try {
      const res = await this.fetch(url, { cache: 'no-store', signal: c.signal });
      await res.arrayBuffer();
      const wall = this.now() - t0;
      // Запасний варіант: якщо Resource Timing недоступний, віднімаємо Server-Timing із заголовка
      const serverMs = this._serverMs(M.parseServerTiming(res.headers?.get?.('server-timing')));
      return this._resourceTiming(url) ?? subtractServer(wall, serverMs);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      this._release(c);
    }
  }

  /**
   * Точніший RTT із Resource Timing API (без накладних витрат JS).
   * Працює, якщо сервер віддає Timing-Allow-Origin.
   */
  _resourceTiming(url) {
    if (!this.perf?.getEntriesByName) return null;
    const entries = this.perf.getEntriesByName(url);
    const e = /** @type {PerformanceResourceTiming | undefined} */ (entries[entries.length - 1]);
    if (!e || !e.requestStart || !e.responseStart) return null;
    const rtt = e.responseStart - e.requestStart;
    if (rtt <= 0) return null;
    /** @type {Record<string, number>} */
    const timings = {};
    for (const st of e.serverTiming ?? []) timings[st.name] = st.duration;
    return subtractServer(rtt, this._serverMs(timings));
  }

  /** Сумарний час обробки на сервері за назвами з конфігурації сервера. */
  _serverMs(timings) {
    return (this.server.serverTimingNames ?? []).reduce((s, n) => s + (timings[n] || 0), 0);
  }

  async measurePing() {
    const { count, intervalMs, warmup } = this.cfg.ping;
    for (let i = 0; i < warmup; i++) await this.singlePing();

    const rtts = [];
    for (let i = 0; i < count; i++) {
      this._checkAbort();
      const rtt = await this.singlePing();
      if (rtt !== null) rtts.push(rtt);
      this.emit({
        type: 'progress',
        phase: 'ping',
        value: rtt,
        progress: (i + 1) / count,
      });
      if (intervalMs) await sleep(intervalMs);
    }
    if (!rtts.length) throw engineError('UNREACHABLE', 'Сервер недоступний: жоден пінг не повернувся');
    return M.summarizeLatency(rtts, count);
  }

  // ───────────────────────── THROUGHPUT ─────────────────────────

  async measureDownload() {
    return this._measureThroughput('download', this.cfg.download, (bytes, onBytes, signal) =>
      this._downloadChunk(bytes, onBytes, signal),
    );
  }

  async measureUpload() {
    const settings = this.cfg.upload;
    const payload = getPayload(settings.maxBytes);
    return this._measureThroughput('upload', settings, (bytes, onBytes, signal) =>
      this.upload(this.server.uploadUrl, payload.slice(0, bytes, 'text/plain'), onBytes, signal),
    );
  }

  async _downloadChunk(bytes, onBytes, signal) {
    const res = await this.fetch(`${this.server.downloadUrl}?bytes=${bytes}`, { cache: 'no-store', signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!res.body?.getReader) {
      const buf = await res.arrayBuffer();
      onBytes(buf.byteLength);
      return;
    }
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onBytes(value.byteLength);
    }
  }

  /**
   * Універсальне вимірювання пропускної здатності:
   * кілька паралельних потоків з адаптивним розміром чанка + семплування кожні N мс
   * + паралельний пінг під навантаженням.
   */
  async _measureThroughput(phase, settings, transfer) {
    const start = this.now();
    let deadline = start + settings.durationMs;
    let stoppedEarly = false;
    const early = this.cfg.earlyStop;
    /** @type {Set<AbortController>} */
    const inflight = new Set();
    const samples = [{ t: 0, bytes: 0 }];
    let totalBytes = 0;
    let streamsDone = false;
    let lastError = null;

    const onBytes = (n) => {
      totalBytes += n;
    };

    const tick = () => {
      const t = this.now() - start;
      samples.push({ t, bytes: totalBytes });
      const mbps = M.liveSpeed(samples, this.cfg.liveWindowMs);
      this.emit({
        type: 'progress',
        phase,
        value: mbps,
        t,
        progress: stoppedEarly ? 1 : Math.min(1, t / settings.durationMs),
      });
      if (
        early?.enabled &&
        !stoppedEarly &&
        t >= early.minDurationMs &&
        M.isStable(samples, {
          windowMs: this.cfg.liveWindowMs,
          lookbackMs: early.lookbackMs,
          tolerance: early.tolerance,
        })
      ) {
        // Швидкість стабільна — далі вимірювати немає сенсу
        stoppedEarly = true;
        deadline = this.now();
        if (settings.abortAtDeadline) inflight.forEach((c) => c.abort());
      }
    };
    const ticker = setInterval(tick, this.cfg.sampleIntervalMs);

    // Дедлайн: download обриває запити одразу, upload дає їм завершитись (з запасом graceMs)
    const stopAt = settings.abortAtDeadline ? settings.durationMs : settings.durationMs + (settings.graceMs ?? 0);
    const killer = setTimeout(() => inflight.forEach((c) => c.abort()), stopAt);

    // Пінг під навантаженням
    const loaded = [];
    let loadedSent = 0;
    const latencyLoop = (async () => {
      await sleep(Math.min(this.cfg.warmupMs, settings.durationMs / 4));
      while (!streamsDone && !this.aborted && this.now() < deadline) {
        loadedSent++;
        const rtt = await this.singlePing(this.cfg.loadedLatency.timeoutMs);
        if (rtt !== null) loaded.push(rtt);
        await sleep(this.cfg.loadedLatency.intervalMs);
      }
    })();

    const stream = async () => {
      let size = settings.initialBytes;
      let errors = 0;
      while (!this.aborted && this.now() < deadline) {
        const c = this._controller();
        inflight.add(c);
        const t0 = this.now();
        const sent = size;
        try {
          await transfer(size, onBytes, c.signal);
          errors = 0;
        } catch (e) {
          if (isAbort(e)) break;
          lastError = e;
          // Після 3 помилок поспіль потік зупиняється; інші потоки продовжують
          if (++errors >= 3) break;
          await sleep(100 * errors);
          continue;
        } finally {
          inflight.delete(c);
          this._release(c);
        }
        const dt = this.now() - t0;
        if (dt < settings.targetRequestMs) {
          // Дуже швидкий запит → збільшуємо агресивніше
          const factor = dt < settings.targetRequestMs / 4 ? 4 : 2;
          size = Math.min(size * factor, settings.maxBytes);
        }
        size = capChunk(size, sent, dt, settings);
      }
    };

    try {
      await Promise.all(Array.from({ length: settings.streams }, stream));
    } finally {
      streamsDone = true;
      clearInterval(ticker);
      clearTimeout(killer);
    }
    tick();
    await latencyLoop;
    this._checkAbort();
    if (totalBytes === 0) {
      throw engineError(
        'TRANSFER_FAILED',
        `${phase === 'download' ? 'Завантаження' : 'Вивантаження'} не вдалося: ${lastError?.message ?? 'немає даних'}`,
        { phase, detail: lastError?.message ?? null },
      );
    }

    const mbpsAvg = M.throughput(samples, this.cfg.warmupMs);
    const mbpsP90 = M.throughputP90(samples, this.cfg.warmupMs, this.cfg.liveWindowMs);
    const mbps = this.cfg.aggregate === 'mean' ? mbpsAvg : mbpsP90;
    // Миттєві швидкості між семплами — для графіків та оцінки стабільності
    const speeds = [];
    for (let i = 1; i < samples.length; i++) {
      const dt = samples[i].t - samples[i - 1].t;
      if (dt > 0 && samples[i].t >= this.cfg.warmupMs) {
        speeds.push(M.bytesToMbps(samples[i].bytes - samples[i - 1].bytes, dt));
      }
    }
    const series = downsample(M.speedSeries(samples, this.cfg.liveWindowMs), 60);

    return {
      mbps,
      mbpsAvg,
      mbpsP90,
      stoppedEarly,
      bytes: totalBytes,
      durationMs: samples[samples.length - 1].t,
      speeds,
      series,
      loadedLatency: { ...M.summarizeLatency(loaded, loadedSent), samples: undefined },
    };
  }
}

/** @type {Blob | null} */
let payloadCache = null;

/** Payload кешується між тестами (воркер живе довше за один тест) — не генеруємо 20 МБ щоразу. */
export function getPayload(totalBytes) {
  if (!payloadCache || payloadCache.size < totalBytes) payloadCache = makePayload(totalBytes);
  return payloadCache.size === totalBytes ? payloadCache : payloadCache.slice(0, totalBytes, 'text/plain');
}

/** Псевдовипадковий payload (нестискуваний), зібраний з 1 МБ блоку без копіювання. */
export function makePayload(totalBytes) {
  const block = new Uint8Array(1 << 20);
  for (let i = 0; i < block.length; i += 65536) {
    globalThis.crypto.getRandomValues(block.subarray(i, i + 65536));
  }
  const parts = [];
  for (let left = totalBytes; left > 0; left -= block.length) {
    parts.push(left >= block.length ? block : block.subarray(0, left));
  }
  return new Blob(parts, { type: 'text/plain' });
}

/**
 * Обмежує розмір наступного чанка за фактичною швидкістю потоку,
 * щоб один запит не тривав довше maxRequestMs. Критично для upload:
 * там байти зараховуються лише після завершення запиту, і чанк,
 * що не встиг до кінця graceMs, пропадає повністю.
 */
export function capChunk(size, lastBytes, lastMs, settings) {
  const { maxRequestMs, initialBytes } = settings;
  if (!maxRequestMs || lastMs <= 0) return size;
  const rate = lastBytes / lastMs; // байт/мс цього потоку
  const limit = Math.floor(rate * maxRequestMs);
  return Math.max(initialBytes, Math.min(size, limit));
}

function downsample(points, max) {
  if (points.length <= max) return points;
  const step = points.length / max;
  return Array.from({ length: max }, (_, i) => points[Math.floor(i * step)]);
}

/**
 * Помилка рушія з машинним кодом — UI перекладає її за кодом,
 * а message (українською) лишається для логів і тестів.
 * @param {'UNREACHABLE' | 'TRANSFER_FAILED'} code
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 */
export function engineError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

/** RTT мінус час обробки на сервері; якщо результат неправдоподібний — сирий RTT. */
export function subtractServer(rtt, serverMs) {
  const net = rtt - (serverMs || 0);
  return net > 0 ? net : rtt;
}
