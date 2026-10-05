/**
 * Фоновий воркер: усі мережеві запити й підрахунки виконуються тут,
 * щоб головний потік лишався вільним для анімацій датчика.
 *
 * Протокол повідомлень:
 *   main → worker: { type: 'start', server, config? } | { type: 'abort' }
 *   worker → main: { type: 'phase' | 'progress' | 'result' | 'done' | 'error' | 'aborted', ... }
 */
import { NetworkEngine } from '../core/NetworkEngine.js';

let engine = null;

self.addEventListener('message', async ({ data }) => {
  if (data.type === 'abort') {
    engine?.abort();
    return;
  }

  if (data.type !== 'start') return;
  if (engine) engine.abort();

  const current = new NetworkEngine({
    server: data.server,
    config: data.config,
    perf: self.performance,
    onEvent: (event) => self.postMessage(event),
  });
  engine = current;

  try {
    const results = await current.run();
    self.postMessage({ type: 'done', results });
  } catch (err) {
    if (err?.name === 'AbortError' || current.aborted) {
      self.postMessage({ type: 'aborted' });
    } else {
      self.postMessage({ type: 'error', message: err?.message || String(err) });
    }
  } finally {
    if (engine === current) engine = null;
  }
});
