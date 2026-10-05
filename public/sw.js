/* Public copy of service worker for production builds served from root */
const CACHE_NAME = 'trafico-app-shell-v2';

// Solo rutas que existen tal cual en el build (los JS/CSS llevan hash en el
// nombre y se guardan en caché al vuelo, la primera vez que se piden).
const APP_SHELL = [
  '/',
  '/index.html',
  '/mapa/map.html',
  '/manifest.json',
  '/data/san-salvador-sur.geojson',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // Uno por uno: si un recurso falla no se cancela toda la instalación.
      .then((cache) => Promise.all(
        APP_SHELL.map((url) => cache.add(url).catch((err) => console.warn('SW: no se pudo cachear', url, err)))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isOwnOrigin = url.origin === self.location.origin;

  if (!isOwnOrigin || event.request.method !== 'GET') {
    return;
  }

  // Red primero, caché como respaldo sin conexión: así nunca se sirve una
  // versión vieja de la app (p. ej. un config.js sin credenciales).
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || Response.error()))
  );
});
