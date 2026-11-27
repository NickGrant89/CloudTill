/* PurePOS till service worker — app shell cache + background sync of offline sales */
const SHELL_CACHE = "purepos-pos-shell-v2";
const DB_NAME = "purepos-pos";
const DB_VERSION = 1;
const SYNC_TAG = "purepos-sync-sales";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const base = self.registration.scope;
      try {
        await cache.addAll([base, new URL("index.html", base).href]);
      } catch {
        /* first load may 404 hashed assets — navigation cache fills later */
      }
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.includes("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          void cache.put(request, fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (
            (await cache.match(request)) ||
            (await cache.match(new URL("index.html", self.registration.scope).href)) ||
            Response.error()
          );
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const isTillChunk =
        url.origin === self.location.origin &&
        (url.pathname.includes("/assets/") || url.pathname.endsWith(".js") || url.pathname.endsWith(".css"));
      try {
        const fresh = await fetch(request);
        if (fresh.ok && url.origin === self.location.origin) {
          void cache.put(request, fresh.clone());
        }
        return fresh;
      } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        if (!isTillChunk) return Response.error();
        return Response.error();
      }
    })()
  );
});

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      if (!db.objectStoreNames.contains("catalog")) db.createObjectStore("catalog");
      if (!db.objectStoreNames.contains("openTickets")) db.createObjectStore("openTickets", { keyPath: "id" });
      if (!db.objectStoreNames.contains("saleQueue")) db.createObjectStore("saleQueue", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IDB open failed"));
  });
}

function idbGetAll(store) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(store, "readonly").objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      })
  );
}

function idbGet(store, key) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(store, "readonly").objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

function idbDelete(store, key) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

async function syncSalesFromIdb() {
  const token = await idbGet("meta", "authToken");
  const queue = await idbGetAll("saleQueue");
  let synced = 0;
  let failed = 0;
  const endpoint = `${self.location.origin}/api/pos/offline-sales`;
  for (const sale of queue) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(sale.payload),
      });
      if (!res.ok) throw new Error(String(res.status));
      await idbDelete("saleQueue", sale.id);
      synced += 1;
    } catch {
      failed += 1;
    }
  }
  const clients = await self.clients.matchAll({ type: "window" });
  for (const client of clients) {
    client.postMessage({ type: "purepos-sync-done", synced, failed });
  }
  return { synced, failed };
}

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(syncSalesFromIdb());
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "purepos-sync-now") {
    event.waitUntil(syncSalesFromIdb());
  }
});
