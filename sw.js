/* Offline shell + chart-library cache for GitHub Pages. */
const CACHE_PREFIX = 'btc-mechanics-';
const CACHE_NAME = 'btc-mechanics-shell-v1';
const ROOT = self.registration.scope;
const SHELL = [
  new URL('./', ROOT).href,
  new URL('./index.html', ROOT).href,
  new URL('./BTCUSD_Market_Mechanics_Lab_Fixed.html', ROOT).href,
  new URL('./manifest.webmanifest', ROOT).href,
  new URL('./icon.svg', ROOT).href
];
const PLOTLY_URL = 'https://cdn.plot.ly/plotly-3.3.1.min.js';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(SHELL.map(async url => {
      try {
        const response = await fetch(url, {cache: 'reload'});
        if (response && response.ok) await cache.put(url, response.clone());
      } catch (_) { /* The shell remains usable online even if one optional asset fails. */ }
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
    const cached = await cache.match(request);
    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (response && (response.ok || response.type === 'opaque')) {
        try { await cache.put(request, response.clone()); } catch (_) {}
      }
      return response;
    } catch (error) {
      if (request.mode === 'navigate') {
        const fallback = await cache.match(new URL('./index.html', ROOT).href);
        if (fallback) return fallback;
        const dashboard = await cache.match(new URL('./BTCUSD_Market_Mechanics_Lab_Fixed.html', ROOT).href);
        if (dashboard) return dashboard;
      }
      throw error;
    }
  })());
});
