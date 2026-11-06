// Margin service worker: offline app shell + Android share target.
const VERSION = 'margin-v1.0.0';
const INBOX = 'margin-inbox';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/store.js',
  './js/md.js',
  './js/langs.js',
  './js/zip.js',
  './js/welcome.js',
  './vendor/marked.umd.js',
  './vendor/purify.min.js',
  './vendor/highlight.min.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './fonts/ibm-plex-sans-latin-400-normal.woff2',
  './fonts/ibm-plex-sans-latin-500-normal.woff2',
  './fonts/ibm-plex-sans-latin-600-normal.woff2',
  './fonts/ibm-plex-mono-latin-400-normal.woff2',
  './fonts/ibm-plex-mono-latin-600-normal.woff2',
  './fonts/source-serif-4-latin-400-normal.woff2',
  './fonts/source-serif-4-latin-400-italic.woff2',
  './fonts/source-serif-4-latin-600-normal.woff2',
  './fonts/source-serif-4-latin-700-normal.woff2',
];
const MD_RE = /\.(md|markdown|mdown|mkd|mkdn|mdwn|mdtxt|mdtext)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION && k !== INBOX).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

async function handleShare(request) {
  const form = await request.formData();
  const files = [];
  const skipped = [];
  for (const f of form.getAll('files')) {
    if (!f || typeof f === 'string') continue;
    if (MD_RE.test(f.name || '')) files.push({ name: f.name, text: await f.text(), lastModified: f.lastModified });
    else skipped.push(f.name || 'file');
  }
  const payload = { title: form.get('title') || '', text: form.get('text') || '', url: form.get('url') || '', files, skipped };
  const cache = await caches.open(INBOX);
  await cache.put(new Request(new URL(`./inbox/${Date.now()}`, self.registration.scope).href), new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } }));
  return Response.redirect(new URL('./?inbox=1', self.registration.scope).href, 303);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/share-target')) {
    event.respondWith(handleShare(req));
    return;
  }
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Network first for the page so updates arrive quickly; cached shell when offline.
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) { const c = await caches.open(VERSION); c.put('./index.html', fresh.clone()); }
        return fresh;
      } catch {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') { const c = await caches.open(VERSION); c.put(req, res.clone()); }
      return res;
    } catch {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
