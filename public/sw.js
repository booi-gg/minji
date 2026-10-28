// Replaced with the built asset list by scripts/generate-service-worker.ts.
const CACHE_NAME = "minji-__MINJI_VERSION__";
const PRECACHE = __MINJI_PRECACHE__;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith("minji-") && name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;

  if (request.mode === "navigate") {
    const fallback =
      url.pathname === "/runner" || url.pathname === "/runner.html" ? "/runner" : "/";
    event.respondWith(
      fetch(request).catch(
        async () => (await caches.match(fallback, { ignoreVary: true })) ?? Response.error(),
      ),
    );
    return;
  }

  event.respondWith(
    caches.match(url.pathname, { ignoreVary: true }).then(async (cached) => {
      if (cached !== undefined) return cached;
      if (url.pathname === "/runner.html") {
        const runner = await caches.match("/runner", { ignoreVary: true });
        if (runner !== undefined) return runner;
      }
      // A failed request still fails, but without an uncaught rejection in the worker.
      const response = await fetch(request).catch(() => Response.error());
      if (response.ok && response.type === "basic") {
        const cache = await caches.open(CACHE_NAME);
        event.waitUntil(cache.put(request, response.clone()));
      }
      return response;
    }),
  );
});
