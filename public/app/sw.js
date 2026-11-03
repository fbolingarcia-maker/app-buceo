// Service worker de la app (/app/): que se abra sin cobertura (en el barco, en el puerto).
// Pantallas: red primero y, sin red, la última copia. Ficheros con hash (/assets/): caché primero.
// La API (/api/) nunca se guarda aquí: los datos sin red los guarda la propia app (agenda del centro).
const CACHE = 'ds-app-v1'
const SHELL = '/app/'

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add(SHELL)).catch(() => {}).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return
  if (req.mode === 'navigate' && url.pathname.startsWith('/app')) {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(SHELL, copy)) }
      return res
    }).catch(() => caches.match(SHELL).then((r) => r || Response.error())))
    return
  }
  if (url.pathname.startsWith('/assets/') || /\.(woff2?|png|svg|webmanifest)$/.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) }
      return res
    })))
  }
})
