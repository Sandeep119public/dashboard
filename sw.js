/* Network-first app shell, cache-first chart library, offline fallback. */
const CACHE_PREFIX = 'btc-mechanics-';
const CACHE_NAME = 'btc-mechanics-shell-v18';
const ROOT = self.registration.scope;
const SHELL = [
  new URL('./', ROOT).href,
  new URL('./index.html', ROOT).href,
  new URL('./BTCUSD_Market_Mechanics_Lab_Fixed.html', ROOT).href,
  new URL('./manifest.webmanifest', ROOT).href,
  new URL('./icon.svg', ROOT).href,
  new URL('./src/ingestion/zip-reader.js', ROOT).href,
  new URL('./src/ingestion/csv-parser.js', ROOT).href,
  new URL('./src/app/import-controller.js', ROOT).href,
  new URL('./src/ui/mobile-quick-actions.js', ROOT).href,
  new URL('./src/data/packed-trade-rows.js', ROOT).href,
  new URL('./src/data/day-aggregator.js', ROOT).href,
  new URL('./src/charts/latest-render-queue.js', ROOT).href,
  new URL('./src/charts/bar-subsetter.js', ROOT).href,
  new URL('./src/charts/series-math.js', ROOT).href,
  new URL('./src/charts/lead-lag.js', ROOT).href,
  new URL('./src/charts/lead-lag-engine.js', ROOT).href,
  new URL('./src/charts/lead-lag.worker.js', ROOT).href
];
const isAppDocument = request => request.mode === 'navigate'
  || request.destination === 'document'
  || /\/(?:index\.html|BTCUSD_Market_Mechanics_Lab_Fixed\.html)$/.test(new URL(request.url).pathname);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(SHELL.map(async url => {
      try {
        const response = await fetch(url, {cache: 'reload'});
        if (response && response.ok) await cache.put(url, response.clone());
      } catch (_) {}
    }));
    self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const isPlotly = url.origin === 'https://cdn.plot.ly' && url.pathname.endsWith('/plotly-3.3.1.min.js');
  if (url.origin !== self.location.origin && !isPlotly) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (isAppDocument(request)) {
      /* Network-first prevents an installed app from getting trapped on old HTML. */
      try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) {
          const key = request.mode === 'navigate' ? request.url : request;
          try { await cache.put(key, fresh.clone()); } catch (_) {}
        }
        return fresh;
      } catch (error) {
        const keys = [request, request.url, new URL('./index.html', ROOT).href, new URL('./BTCUSD_Market_Mechanics_Lab_Fixed.html', ROOT).href];
        for (const key of keys) {
          const fallback = await cache.match(key);
          if (fallback) return fallback;
        }
        throw error;
      }
    }
    /* Keep the large Plotly library cache-first so offline reloads can draw charts. */
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response && (response.ok || response.type === 'opaque')) {
        try { await cache.put(request, response.clone()); } catch (_) {}
      }
      return response;
    } catch (error) {
      const fallback = await cache.match(request);
      if (fallback) return fallback;
      throw error;
    }
  })());
});
