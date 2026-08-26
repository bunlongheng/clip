const CACHE = "app-cache-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (event) => { const { request } = event; if (request.method !== "GET") return; event.respondWith(fetch(request).then((response) => { if (response && response.status === 200 && new URL(request.url).origin === self.location.origin) { const copy = response.clone(); caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {}); } return response; }).catch(() => caches.match(request))); });
