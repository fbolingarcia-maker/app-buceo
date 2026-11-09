// Service worker de la app (/app/): que se abra sin cobertura (en el barco, en el puerto).
// Pantallas: red primero y, sin red, la última copia. Ficheros con hash (/assets/): caché primero.
// La API (/api/) nunca se guarda aquí: los datos sin red los guarda la propia app (agenda del centro).
const CACHE = 'ds-app-v2'
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

// Avisos en el móvil (Web Push): { title, body, url (ruta de la app), tag }
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch (err) { d = { body: e.data && e.data.text() } }
  e.waitUntil(self.registration.showNotification(d.title || 'DivingSlot', {
    body: d.body || '', tag: d.tag, renotify: !!d.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: d.url || '/' },
  }))
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const target = '/app/#' + ((e.notification.data && e.notification.data.url) || '/')
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => x.url.includes('/app/'))
    if (c) { c.navigate(target).catch(() => {}); return c.focus() }
    return self.clients.openWindow(target)
  }))
})
