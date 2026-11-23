/** IndexedDB helpers for offline till cache + queues. */

const DB_NAME = "purepos-pos";
const DB_VERSION = 1;

export type CachedCatalog = {
  categories: unknown[];
  items: unknown[];
  paymentTypes: unknown[];
  settings: unknown;
  favorites: unknown[];
  cachedAt: string;
};

export type QueuedSale = {
  id: string;
  registerId: string;
  createdAt: string;
  payload: {
    clientSaleId: string;
    registerId: string;
    customerId?: string | null;
    note?: string | null;
    discountCents?: number;
    tipCents?: number;
    lines: {
      variantId: string;
      name: string;
      quantity: number;
      unitPriceCents: number;
      discountCents: number;
      modifiers: { name: string; priceCents: number; modifierId?: string; groupName?: string }[];
    }[];
    payments: {
      paymentTypeId: string;
      amountCents: number;
      tenderedCents?: number;
      giftCardCode?: string;
    }[];
  };
  status: "pending" | "syncing" | "error";
  lastError?: string;
};

export type LocalTicket = {
  id: string;
  registerId: string;
  name: string;
  status: string;
  customerId: string | null;
  customer?: { id: string; name: string; loyaltyPoints: number; storeCreditCents: number } | null;
  lines: {
    key: string;
    variantId: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    discountCents: number;
    modifiers: { name: string; priceCents: number; modifierId?: string; groupName?: string }[];
  }[];
  discountCents: number;
  discountPercent: number;
  tipCents: number;
  updatedAt: string;
};

function openDb(): Promise<IDBDatabase> {
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
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export async function idbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSet(store: string, key: IDBValidKey, value: unknown): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(value, key);
  await txDone(tx);
}

export async function idbPut(store: string, value: unknown): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(value);
  await txDone(tx);
}

export async function idbDelete(store: string, key: IDBValidKey): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).delete(key);
  await txDone(tx);
}

export async function idbGetAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve((req.result as T[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheCatalog(snapshot: CachedCatalog): Promise<void> {
  await idbSet("catalog", "snapshot", snapshot);
}

export async function readCatalogCache(): Promise<CachedCatalog | undefined> {
  return idbGet<CachedCatalog>("catalog", "snapshot");
}

export async function saveLocalTicket(ticket: LocalTicket): Promise<void> {
  await idbPut("openTickets", ticket);
}

export async function readLocalTicket(registerId: string): Promise<LocalTicket | undefined> {
  const all = await idbGetAll<LocalTicket>("openTickets");
  return all.find((t) => t.registerId === registerId && t.status === "open");
}

export async function clearLocalTicket(id: string): Promise<void> {
  await idbDelete("openTickets", id);
}

export async function enqueueSale(sale: QueuedSale): Promise<void> {
  await idbPut("saleQueue", sale);
}

export async function listQueuedSales(): Promise<QueuedSale[]> {
  return idbGetAll<QueuedSale>("saleQueue");
}

export async function removeQueuedSale(id: string): Promise<void> {
  await idbDelete("saleQueue", id);
}

export async function updateQueuedSale(sale: QueuedSale): Promise<void> {
  await idbPut("saleQueue", sale);
}

/** Auth token mirror for service-worker background sync (same IndexedDB). */
export async function persistAuthToken(token: string | null): Promise<void> {
  await idbSet("meta", "authToken", token);
}
