const CACHE_NAME = "DER_STEP2_CACHE_v2";
const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./db.js",
  "./aircraft.js",
  "./manifest.webmanifest"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    // DER_STEP2_CACHE_ で始まる確認用キャッシュだけを整理する。
    // STEP1側のキャッシュには触れない。
    await Promise.all(names
      .filter(name => name.startsWith("DER_STEP2_CACHE_") && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response && response.ok && new URL(event.request.url).origin === self.location.origin) {
        cache.put(event.request, response.clone());
      }
      return response;
    } catch (error) {
      return new Response("オフラインです。保存済みのページを開けませんでした。", {
        status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  })());
});
