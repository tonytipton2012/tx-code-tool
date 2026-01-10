const CACHE_NAME = "tx-code-cache-v30";
const CORE = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./offenses.json",
  "./primary_aliases.json",
  "./statutes.json",
  "./statutes_registry.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE_NAME) ? null : caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  event.respondWith((async () => {
    const req = event.request;
    const cache = await caches.open(CACHE_NAME);

    // Cache-first for core; network fallback
    const cached = await cache.match(req);
    if (cached) return cached;

    try{
      const fresh = await fetch(req);
      // cache same-origin GETs
      if (req.method === "GET" && new URL(req.url).origin === self.location.origin){
        cache.put(req, fresh.clone());
      }
      return fresh;
    }catch(e){
      // offline fallback: try cached index
      const fallback = await cache.match("./index.html");
      return fallback || new Response("Offline", {status:503});
    }
  })());
});
