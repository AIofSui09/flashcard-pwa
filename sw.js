// sw.js — オフライン用 Service Worker。
// 更新時は CACHE_VERSION を app.js の APP_VERSION と揃えて上げる（キャッシュ名が変わると旧キャッシュを破棄して新版に入れ替わる）。
const CACHE_VERSION = '1.1.0';
const CACHE_NAME = `sfc-v${CACHE_VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './logic.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

// cache: 'reload' で CDN・ブラウザの HTTP キャッシュを迂回し、必ず最新バイトを precache する
// （GitHub Pages の CDN キャッシュが残っていると、新バージョンの SW が古いアセットを拾うため）
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          ASSETS.map((url) =>
            fetch(url, { cache: 'reload' }).then((res) => {
              if (!res.ok) throw new Error(`precache failed: ${url}`);
              return cache.put(url, res);
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// same-origin の GET はキャッシュ優先（オフライン起動を最優先）。無ければネットワークへ。
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      return cached || fetch(event.request);
    })
  );
});
