// Only public application assets enter this cache. Private APIs, helper pages and capabilities never do.
const CACHE = "jaagruk-shell-v2";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (
    e.request.method !== "GET" ||
    url.origin !== location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/helper/") ||
    url.search
  )
    return;
  if (!SHELL.includes(url.pathname) && !url.pathname.startsWith("/assets/")) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok && !r.headers.get("Cache-Control")?.includes("no-store"))
          caches.open(CACHE).then((c) => c.put(e.request, r.clone()));
        return r;
      })
      .catch(() =>
        caches
          .match(e.request)
          .then(
            (r) =>
              r || (e.request.mode === "navigate" ? caches.match("/index.html") : Response.error()),
          ),
      ),
  );
});
