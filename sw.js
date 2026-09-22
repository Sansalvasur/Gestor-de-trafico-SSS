/* =============================================
   Service Worker - PWA "shell" cache
   Solo cachea los archivos propios de la app (HTML/CSS/JS/íconos/límite
   administrativo). Todo lo demás (Supabase, mapas, rutas, tráfico, APIs
   externas) va siempre directo a la red: son datos en vivo, cachearlos
   mostraría información vieja o rota.
   ============================================= */

const CACHE_NAME = 'trafico-app-shell-v1';

const APP_SHELL = [
    './',
    './index.html',
    './css/styles.css',
    './js/app.js',
    './js/config.js',
    './manifest.json',
    './data/san-salvador-sur.geojson',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
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
        return; // deja pasar sin tocar: Supabase, tiles, OSRM, Google, etc.
    }

    // Stale-while-revalidate: responde rápido desde caché (y funciona sin
    // conexión), mientras actualiza la caché en segundo plano con la red.
    event.respondWith(
        caches.match(event.request).then((cached) => {
            const network = fetch(event.request)
                .then((response) => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    }
                    return response;
                })
                .catch(() => cached);

            return cached || network;
        })
    );
});
