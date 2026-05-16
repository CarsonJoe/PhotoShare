const SHELL_CACHE = 'photoshare-shell-v4';
const RUNTIME_CACHE = 'photoshare-runtime-v4';
const SHELL_ASSETS = [
  './',
  './index.html',
  './group.html',
  './main.js',
  './group.js',
  './styles.css',
  './manifest.webmanifest',
  './app-icon.svg',
  './app-icon-192.png',
  './app-icon-512.png',
  './photos.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      ).then(() => self.clients.claim())
    )
  );
});

function isSameOrigin(request) {
  return new URL(request.url).origin === self.location.origin;
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error('Network unavailable');
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const networkFetch = fetch(request).then((response) => {
    cache.put(request, response.clone());
    return response;
  });

  if (cached) {
    // Return cached immediately; update in background (suppress background errors).
    networkFetch.catch(() => {});
    return cached;
  }

  // No cached copy — wait for network; propagate errors naturally.
  return networkFetch;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !isSameOrigin(request)) return;

  const url = new URL(request.url);
  const isNavigation = request.mode === 'navigate';
  // photos.json always carries a ?v= cache-buster so stale-while-revalidate
  // is pointless — always go network-first for it.
  const isManifest =
    url.pathname.endsWith('/photos.json') || url.pathname.endsWith('.webmanifest');
  const isAsset =
    request.destination === 'image' ||
    request.destination === 'style' ||
    request.destination === 'script';

  if (isNavigation || isManifest) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isAsset) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
