// Funciona sin conexión: responde al instante desde la caché y actualiza en segundo plano.
// Las peticiones a otros orígenes (GitHub, API de Claude) no se interceptan.
const CACHE = 'nutrilab-v5';
const ASSETS = ['./', 'index.html', 'app.css', 'app.js', 'config.js', 'files.js', 'foods.js', 'ai.js', 'cloud.js', 'vendor/supabase-js-2.117.2.mjs', 'vendor/anthropic-sdk-0.131.0.mjs', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'vendor/fonts/plus-jakarta-sans.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // La configuración se pide siempre a la red primero, para que los cambios se apliquen al momento.
  if (url.pathname.endsWith('/config.js')) {
    e.respondWith(fetch(e.request).then((res) => { const c = res.clone(); caches.open(CACHE).then((k) => k.put(e.request, c)); return res; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => null);
    if (cached) { e.waitUntil(fresh); return cached; }
    return (await fresh) || cache.match('index.html');
  }));
});
