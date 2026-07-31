/* Service worker de BirraMap.
   ⚠️ La VERSIÓN es lo que fuerza a los móviles a tirar la caché vieja.
   Si tocas ficheros del front, sube este número. */
const VERSION = 'v4-0-1';
const CACHE = `birramap-${VERSION}`;

const SHELL = [
  '/', '/index.html', '/css/styles.css',
  '/js/geo.js', '/js/ui.js', '/js/app.js',
  '/ayuda.html', '/manifest.webmanifest', '/icons/icon-192.png'
];

self.addEventListener('install', e => {
  /* skipWaiting hace que el SW nuevo entre YA, sin esperar a que
     se cierren todas las pestañas. Sin esto, en el móvil puedes
     estar días viendo la versión antigua. */
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.pathname.startsWith('/api') || u.pathname.startsWith('/.auth')) return;

  /* Para los ficheros propios: primero la red, la caché solo si no hay
     conexión. Así un despliegue nuevo se ve al instante. */
  if (u.origin === location.origin) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res && res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); }
          return res;
        })
        .catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
    );
    return;
  }

  /* Para lo de fuera (mapas, tipografías): caché primero, que va más rápido */
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(list => {
    const url = (e.notification.data && e.notification.data.url) || '/';
    for (const c of list) if ('focus' in c) return c.navigate(url).then(() => c.focus());
    return clients.openWindow(url);
  }));
});
