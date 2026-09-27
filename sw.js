// Service worker – az app fájljait eltárolja, így internet nélkül is elindul.
// Új verzió feltöltésekor a számot növeld (v2, v3…), hogy mindenkinél frissüljön.
const CACHE_NEV = 'utazastervezo-v3';
const FAJLOK = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.webmanifest',
    './icon-180.png',
    './icon-192.png',
    './icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_NEV).then(cache => cache.addAll(FAJLOK)));
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(nevek => Promise.all(
            nevek.filter(n => n !== CACHE_NEV).map(n => caches.delete(n))
        ))
    );
    self.clients.claim();
});

// Hálózat először (mindig a legfrissebb kód), ha nincs net, a tárolt változat.
// Az adatokat (Apps Script) nem itt kezeljük, azokat az app maga menti.
self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

    event.respondWith(
        fetch(req)
            .then(valasz => {
                const masolat = valasz.clone();
                caches.open(CACHE_NEV).then(cache => cache.put(req, masolat));
                return valasz;
            })
            .catch(() => caches.match(req).then(t => t || caches.match('./index.html')))
    );
});
