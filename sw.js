// Pascalator service worker: caches the app shell + KaTeX CDN assets (including its fonts)
// so the app works fully offline, and serves from cache first so a slow/flaky connection
// never blocks the UI - a background fetch always refreshes the cache for next time. Mirrors
// the pattern used by the other Korovatron apps (e.g. Graphiti's sw.js) for consistency.
//
// Bump CACHE_NAME whenever shipping a change that should invalidate old caches - the
// activate handler deletes any cache not matching the current name, and skipWaiting()/
// clients.claim() below make the new worker take over immediately (src/register-sw.js then
// reloads the page once control changes, so users always get the latest version automatically).
const CACHE_NAME = "pascalator-v1.3.6";

const PRECACHE_URLS = [
  "./",
  "index.html",
  "explore.html",
  "expansion.html",
  "manifest.json",
  "src/style.css",
  "src/portal.css",
  "src/expansion.css",
  "src/register-sw.js",
  "src/main.js",
  "src/renderer.js",
  "src/viewport.js",
  "src/infocard.js",
  "src/triangle.js",
  "src/hexgeom.js",
  "src/expansion.js",
  "icons/favicon-32.png",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/logo-transparent.png",
  "previewImages/explorePreview.png",
  "previewImages/binomialExpansionPreview.png",
  "previewImages/sierpinskiPreview.png",
  "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css",
  "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js",
  // KaTeX loads these fonts lazily via @font-face in its CSS, so the HTML never references
  // them directly - precache the common ones used by \binom/\sum/\textcolor/italics so a
  // first-ever offline visit still renders proper glyphs instead of a fallback font.
  "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_AMS-Regular.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_Main-Bold.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_Main-Italic.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_Main-Regular.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_Math-Italic.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_Size1-Regular.woff2",
  "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_Size2-Regular.woff2",
];

/** fetch() with a hard timeout, so a slow/unreachable resource can't hang the caller forever. */
function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timeoutId));
}

/** Caches a single URL, but never blocks longer than timeoutMs - a slow/unreachable asset (e.g. a blocked CDN) just gets skipped, logged, and left for the fetch handler to retry later. */
function cacheUrlWithTimeout(cache, url, timeoutMs = 5000) {
  return Promise.race([
    cache.add(url),
    new Promise((_, reject) => setTimeout(() => reject(new Error("precache timeout")), timeoutMs)),
  ]).catch((err) => {
    console.warn(`Pascalator SW: failed to precache ${url}`, err);
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Each asset is cached independently with a timeout, rather than a single
      // cache.addAll() (all-or-nothing) - a slow/unreachable CDN shouldn't be able to block
      // install() forever or prevent the rest of the (local) app shell from being cached.
      await Promise.all(PRECACHE_URLS.map((url) => cacheUrlWithTimeout(cache, url)));
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  // Navigating to a page (opening/reloading the app): cache-first with a short background
  // refresh, falling back to the cached landing page (then a plain offline response) if a
  // never-cached page is requested while offline.
  if (event.request.mode === "navigate") {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) {
          fetchWithTimeout(event.request, 2000)
            .then((fresh) => {
              if (fresh.status === 200) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, fresh.clone()));
            })
            .catch(() => {});
          return cached;
        }

        return fetchWithTimeout(event.request, 2000).catch(async () => {
          const fallback = await caches.match("index.html");
          return fallback || new Response("Offline", { status: 503, statusText: "Offline" });
        });
      })
    );
    return;
  }

  // Everything else (scripts, styles, fonts, icons): cache-first, refreshing in the
  // background - this is what makes a slow/flaky connection feel instant after the first
  // visit, and still lets genuinely new/uncached requests go to the network with a timeout.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        fetchWithTimeout(event.request, 5000)
          .then((fresh) => {
            if (fresh.status === 200 || fresh.type === "opaque") {
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, fresh.clone()));
            }
          })
          .catch(() => {});
        return cached;
      }

      return fetchWithTimeout(event.request, 5000)
        .then((response) => {
          if (response.status === 200 || response.type === "opaque") {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(async () => {
          const fallbackAsset = await caches.match(event.request, { ignoreSearch: true });
          return fallbackAsset || new Response("", { status: 504, statusText: "Gateway Timeout" });
        });
    })
  );
});

// Lets the page force an immediate update (e.g. from a future "update available" UI).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
