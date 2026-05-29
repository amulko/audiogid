// Service Worker — ВелоГид v2 (офлайн-поддержка)
const APP_CACHE  = 'velogid-app-v34';
const TILE_CACHE = 'velogid-tiles-v1';

const APP_ASSETS = [
  './',
  './app.js',
  './content.js',
  './manifest.json',
  './icon.svg',
  './lib/leaflet.css',
  './lib/leaflet.js',
  './lib/jsqr.js',
  './audio/wp1.mp3',
  './audio/wp2.mp3',
  './audio/wp3.mp3',
  './audio/wp4.mp3',
  './audio/wp5.mp3',
  './audio/wp6.mp3',
  './audio/wp7.mp3',
  './audio/wp8.mp3',
  './audio/wp9.mp3',
  './audio/wp10.mp3',
  './audio/wp11.mp3',
  './audio/wp12.mp3',
  './audio/wp13.mp3',
  './audio/wp14.mp3',
  './audio/wp15.mp3',
  './audio/wp16.mp3',
  './audio/wp17.mp3'
];

// ── Установка: кешируем оболочку приложения ──────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => cache.addAll(APP_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Активация: удаляем старые кеши ───────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== APP_CACHE && k !== TILE_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Запросы ───────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Тайлы карты — cache-first (работают офлайн после предзагрузки)
  if (url.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request)
            .then(resp => {
              if (resp.ok) cache.put(event.request, resp.clone());
              return resp;
            })
            .catch(() => new Response('', { status: 503 }));
        })
      )
    );
    return;
  }

  // Навигационные запросы
  if (event.request.mode === 'navigate') {
    const pathname = new URL(event.request.url).pathname;
    if (pathname === '/' || pathname === '/index.html') {
      // Главная страница — из кеша (без redirect)
      event.respondWith(
        caches.match('./').then(cached => cached || fetch('./'))
      );
    } else {
      // Остальные страницы (admin и т.д.) — убираем .html чтобы Cloudflare
      // отдал 200 сразу, без редиректа 308, иначе iOS Safari падает
      const cleanUrl = event.request.url.replace(/\.html(\?.*)?$/, '$1');
      event.respondWith(fetch(cleanUrl));
    }
    return;
  }

  // Оболочка приложения — cache-first, fallback на index.html
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).catch(() =>
        caches.match('./index.html')
      )
    )
  );
});

// ── Сообщения от приложения ───────────────────────────────────────────────────
self.addEventListener('message', async event => {
  if (event.data.type === 'CACHE_TILES') {
    const { tiles } = event.data;
    const cache = await caches.open(TILE_CACHE);
    let done = 0;

    // Загружаем по 6 тайлов параллельно
    const chunks = [];
    for (let i = 0; i < tiles.length; i += 6) chunks.push(tiles.slice(i, i + 6));

    for (const chunk of chunks) {
      await Promise.all(chunk.map(async url => {
        try {
          const cached = await cache.match(url);
          if (!cached) {
            const resp = await fetch(url);
            if (resp.ok) await cache.put(url, resp);
          }
        } catch (_) {}
        done++;
      }));

      // Отправляем прогресс клиенту
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clients.forEach(c => c.postMessage({
        type: 'TILE_PROGRESS',
        done,
        total: tiles.length
      }));
    }

    const clients = await self.clients.matchAll();
    clients.forEach(c => c.postMessage({ type: 'TILE_DONE', total: tiles.length }));
  }
});
