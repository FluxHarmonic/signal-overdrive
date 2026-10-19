// Harkfell's generated, versioned waiting-worker pattern. The inventory is
// regenerated after staging rewrites the wasm URL. Never skip waiting on
// install: only explicit consent at a safe menu can replace a running game.
const VERSION = __PWA_VERSION__;
const INVENTORY = __PWA_INVENTORY__;
const scope = new URL(self.registration.scope);
const PREFIX = "signal-overdrive-play-" + encodeURIComponent(scope.pathname) + "-";
const CACHE = PREFIX + VERSION;
const STATE = "signal-overdrive-state-" + encodeURIComponent(scope.pathname);
const selectedKey = new URL("__pwa_selected__", scope).href;
const inventoryKey = new URL("__pwa_inventory__", scope).href;
async function selected() {
  const response = await (await caches.open(STATE)).match(selectedKey);
  return response ? (await response.json()).version : null;
}
async function select(version) {
  await (await caches.open(STATE)).put(selectedKey, new Response(JSON.stringify({ version })));
}
async function prune(keep) {
  await Promise.all((await caches.keys()).filter(name =>
    name.startsWith(PREFIX) && !keep.includes(name)).map(name => caches.delete(name)));
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Limit concurrent downloads; do not compete with a phone's boot burst.
    let next = 0;
    try {
      const downloads = await Promise.allSettled(Array.from({ length: 4 }, async () => {
        while (next < INVENTORY.length) {
          const item = INVENTORY[next++];
          const url = new URL(item.url, scope).href;
          const response = await fetch(new Request(url, { cache: "reload" }));
          if (!response.ok || response.redirected) throw new Error(`PWA missing resource ${url}`);
          const hash = await crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer());
          const hex = Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, "0")).join("");
          if (hex !== item.sha256) throw new Error(`PWA mixed deployment ${url}`);
          await cache.put(url, response);
        }
      }));
      const failed = downloads.find(result => result.status === "rejected");
      if (failed) throw failed.reason;
      await cache.put(inventoryKey, new Response(JSON.stringify(
        INVENTORY.map(item => new URL(item.url, scope).href))));
    } catch (error) {
      // A failed install must never replace a complete offline version.
      await caches.delete(CACHE);
      throw error;
    }
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    // Browsers activate a waiting worker automatically when every tab is
    // closed. Keep serving the previously selected build even in that case:
    // only a main-menu choice changes the durable build pointer.
    let active = await selected();
    if (!active) { active = VERSION; await select(active); }
    await prune([PREFIX + active, CACHE]);
    await self.clients.claim();
  })());
});

const windows = async () => (await self.clients.matchAll({ type: "window", includeUncontrolled: true }))
  .filter(client => client.url.startsWith(scope.href));
let preparing = false;
async function applyUpdate(requester) {
  if (preparing) return;
  preparing = true;
  const clients = await windows();
  const ask = client => new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 3000);
    channel.port1.onmessage = event => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data?.safe === true);
    };
    client.postMessage({ type: "UPDATE_PREPARE", version: VERSION }, [channel.port2]);
  });
  try {
    const replies = await Promise.all(clients.map(ask));
    const current = await windows();
    if (!clients.length || replies.some(safe => !safe) ||
        current.some(c => !clients.some(prior => prior.id === c.id))) {
      for (const client of clients) client.postMessage({ type: "UPDATE_ABORT", version: VERSION });
      requester?.postMessage({ type: "UPDATE_BLOCKED", version: VERSION });
      return;
    }
    // Every existing page has frozen its menu input before acknowledging.
    const wasWaiting = !!self.registration.waiting;
    await select(VERSION);
    await self.skipWaiting();
    if (!wasWaiting) {
      await prune([CACHE]);
      for (const client of clients) client.postMessage({ type: "UPDATE_COMMIT", version: VERSION });
    }
  } catch (error) {
    for (const client of clients) client.postMessage({ type: "UPDATE_ABORT", version: VERSION });
    throw error;
  } finally {
    preparing = false;
  }
}
self.addEventListener("message", event => {
  if (event.data?.type === "APPLY_UPDATE") event.waitUntil(applyUpdate(event.source));
  if (event.data?.type === "VERSION" && event.ports[0]) {
    event.waitUntil(selected().then(active => event.ports[0].postMessage({
      version: active || VERSION, available: active && active !== VERSION ? VERSION : null
    })));
  }
});

function isolated(response) {
  if (!response || response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.delete("Content-Encoding");
  headers.delete("Content-Length");
  return new Response(response.body, {
    status: response.status, statusText: response.statusText, headers
  });
}
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== scope.origin) return;
  // Only the game's root navigation falls back to its shell. A missing
  // asset or arbitrary path must never become a successful HTML response.
  const navigation = request.mode === "navigate" &&
    (url.pathname === scope.pathname || url.pathname === scope.pathname + "index.html");
  url.search = "";
  const key = navigation ? new URL("index.html", scope).href : url.href;
  // Includes the staged /w/hash wasm outside the worker's directory. The
  // selected build may be older than this worker after a browser restart.
  event.respondWith((async () => {
    const cache = await caches.open(PREFIX + (await selected() || VERSION));
    const hit = await cache.match(key);
    if (hit) return isolated(hit);
    const metadata = await cache.match(inventoryKey);
    const inventory = metadata ? await metadata.json() : [];
    // Inventory resources are immutable within this version. A missing
    // cache entry is a failure, not permission to mix in a newer release.
    if (navigation || inventory.includes(key)) {
      return isolated(new Response("Offline build incomplete. Reconnect and restart.", { status: 503 }));
    }
    // Analytics, release metadata and unrelated site resources stay online.
    return fetch(request);
  })());
});
