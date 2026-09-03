/*
 * Offline layer.
 *
 * This app is used in exactly the conditions where the network is worst:
 * outdoors, walking, in a hurry, sometimes on a foreign SIM. A civic finder
 * that goes blank the moment the signal drops has failed at the only moment
 * it mattered. So: the shell, the map tiles you have already seen, and the
 * last place results you loaded all survive going offline.
 *
 * Strategy per request kind, chosen from what each one costs if it is stale:
 *
 *   build assets (/_next/static/*) - cache-first, forever. Content-hashed
 *     filenames, so a stale hit is impossible by construction.
 *   map tiles - cache-first with an LRU cap. A month-old vector tile of
 *     Kadıköy is still a correct map of Kadıköy, and re-fetching it is the
 *     single most expensive thing this app does on a bad connection.
 *   /api/places, /api/place/* - network-first with a 2.5s timeout, falling
 *     back to cache. Freshness wins when the network is there; when it is
 *     not, the cached answer is served *and labelled*, so the page can say
 *     out loud that what it is showing may be old.
 *   navigations - network-first, falling back to the cached shell, so a
 *     cold launch offline still opens the app rather than the dino.
 *
 * Writes (POST/PATCH/DELETE - reports, suggestions, admin edits) are never
 * cached and never served from cache. Replaying a moderation action from a
 * stale cache would corrupt the record, and telling someone their report was
 * filed when it was not would be worse than telling them to try again.
 */

// Bumped whenever a cached entry could have been written under rules that
// no longer hold. `activate` deletes every cache not carrying the current
// version, which is the only way an already-poisoned entry goes away: v1
// stored every navigation under "/", so a browser that visited /admin before
// that fix is still holding the moderation panel behind the homepage, and
// correcting the write path does nothing for a copy already on disk.
const VERSION = "v2";
const SHELL_CACHE = `buradane-shell-${VERSION}`;
const ASSET_CACHE = `buradane-assets-${VERSION}`;
const DATA_CACHE = `buradane-data-${VERSION}`;
const TILE_CACHE = `buradane-tiles-${VERSION}`;

/** Vector tiles are small but numerous; this is roughly a few large cities'
 * worth at typical zoom levels, and well inside a normal origin quota. */
const TILE_LIMIT = 1200;
/** One entry per distinct query the user actually ran. */
const DATA_LIMIT = 120;

const TILE_HOSTS = new Set(["tiles.openfreemap.org"]);

self.addEventListener("install", (event) => {
  // Pre-cache only the entry point. Everything else arrives as it is used,
  // which keeps install fast and avoids guessing at a file list that
  // Next.js's build output owns.
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(["/", "/manifest.webmanifest"]))
      .catch(() => undefined)
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
            .filter((name) => name.startsWith("buradane-") && !name.endsWith(`-${VERSION}`))
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** FIFO trim. The Cache API has no timestamps, but `keys()` returns entries
 * in insertion order, so dropping from the front approximates an LRU closely
 * enough for a bounded tile store. */
async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}

async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  // Opaque responses (no-cors, e.g. a cross-origin tile) have status 0 and
  // are still worth storing - we just cannot inspect them.
  if (response && (response.ok || response.type === "opaque")) {
    await cache.put(request, response.clone());
    if (limit) trim(cacheName, limit);
  }
  return response;
}

/** Adds our own headers to a cached response. Response headers are
 * immutable once constructed, so the body is re-wrapped rather than mutated. */
async function stamp(response, extra) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Network-first, with a short timeout and a cache fallback.
 *
 * Why not stale-while-revalidate, which is the usual pick here: SWR hands
 * back the cached copy and repairs it silently, so the page cannot tell a
 * live answer from a week-old one. For a map of public toilets that is the
 * difference between "closed for renovation" being news and being invisible.
 *
 * Every response the page receives now says where it came from, which makes
 * the offline banner a statement of fact rather than a guess. That fact
 * travels on the response itself rather than in worker state, because a
 * service worker is terminated whenever it goes idle - a status held in a
 * module variable is gone by the next page load, which is exactly when it
 * was needed.
 *
 * The timeout keeps the good part of SWR: on a bad connection we stop
 * waiting after `timeoutMs` and show what we have, while the real request
 * carries on filling the cache for next time.
 */
async function networkFirst(event, request, cacheName, limit, timeoutMs = 2500) {
  const cache = await caches.open(cacheName);

  // `cache: "no-store"` makes this a real network attempt. /api/places sends
  // `Cache-Control: public, max-age=60`, and without this the browser's own
  // HTTP cache answers from disk - so the worker sees a *successful* fetch
  // while the server is unreachable, and reports the app as online. It was
  // also time-dependent, which is worse than simply broken: it worked until
  // the entry aged past a minute. One caching layer, and it is this one.
  const network = fetch(request, { cache: "no-store" })
    .then(async (response) => {
      if (response && response.ok) {
        await cache.put(request, response.clone());
        if (limit) trim(cacheName, limit);
      }
      return response;
    })
    .catch(() => undefined);

  const timeout = new Promise((resolve) => setTimeout(() => resolve("timeout"), timeoutMs));
  const winner = await Promise.race([network, timeout]);

  if (winner && winner !== "timeout") return winner;

  const hit = await cache.match(request);

  if (winner === "timeout" && hit) {
    // Still trying; let it finish and update the cache for next time.
    event.waitUntil(network);
    return stamp(hit, { "x-buradane-cache": "hit", "x-buradane-slow": "1" });
  }

  // Timed out with nothing cached, or the request already failed: either
  // way the answer is whatever the network eventually produced.
  const late = await network;
  if (late) return late;

  if (hit) return stamp(hit, { "x-buradane-cache": "hit", "x-buradane-offline": "1" });

  return new Response(JSON.stringify({ error: "offline", places: [], total: 0 }), {
    status: 503,
    headers: { "content-type": "application/json", "x-buradane-offline": "1" },
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // React Server Component payloads are keyed by a header, not the URL, and
  // caching them by URL serves the wrong tree back. Leave them to the network.
  if (url.searchParams.has("_rsc")) return;

  if (TILE_HOSTS.has(url.hostname)) {
    event.respondWith(cacheFirst(request, TILE_CACHE, TILE_LIMIT).catch(() => Response.error()));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/maplibre/")) {
    event.respondWith(cacheFirst(request, ASSET_CACHE).catch(() => Response.error()));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    // Admin and moderation reads are deliberately excluded: a moderator
    // acting on a stale queue could approve something already handled.
    if (url.pathname.startsWith("/api/admin")) return;
    event.respondWith(networkFirst(event, request, DATA_CACHE, DATA_LIMIT));
    return;
  }

  if (request.mode === "navigate") {
    // The moderation panel is deliberately not cached. Its writes fail
    // offline and its queue reads are excluded above, so an offline copy
    // could only mislead a moderator - and, before this was split out, every
    // navigation was stored under "/", which meant visiting /admin once put
    // the admin document behind the *homepage* for anyone who later opened
    // it offline.
    if (url.pathname.startsWith("/admin")) return;

    // Keyed by path, without the query string: "/?k=tuvalet" and "/" are the
    // same document, and the app restores its own state from the URL on
    // load, so one entry per route is both correct and enough.
    const key = new Request(url.origin + url.pathname, { mode: "same-origin" });

    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(key, copy)));
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE);
          // The exact route first, then the app entry point - landing on the
          // map is a reasonable answer for a route we have never seen.
          return (await cache.match(key)) ?? (await cache.match("/")) ?? Response.error();
        }),
    );
  }
});
