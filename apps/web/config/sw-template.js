/* global self, caches, VERSION, PRECACHE */
/**
 * Service worker «Спідтесту». Генерується під час збірки (config/vite-plugin-sw.js):
 * VERSION і PRECACHE підставляються автоматично.
 *
 * Стратегії:
 *  • навігація (HTML) — network-first, при офлайні — кешований index.html;
 *  • власні статичні файли — cache-first (імена з хешем, тож не застарівають);
 *  • speed.cloudflare.com та інші сторонні запити — НЕ перехоплюються:
 *    вимірювання завжди йдуть у мережу і ніколи не кешуються.
 */
const CACHE = `speedtest-${VERSION}`;
const scopeUrl = (path) => new URL(path, self.registration.scope).toString();

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map(scopeUrl))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('speedtest-') && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

// Нова версія активується лише за згодою користувача (кнопка «Оновити»)
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // вимірювання — завжди мережа

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match(scopeUrl('./'))) || caches.match(scopeUrl('index.html'))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          // Догружені файли (напр. інші підмножини шрифтів) теж кладемо в кеш
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
