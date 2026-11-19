import { getToken } from "../api";
import {
  listQueuedSales,
  removeQueuedSale,
  updateQueuedSale,
  type QueuedSale,
} from "./db";

export type OfflineStatus = {
  online: boolean;
  pendingSales: number;
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
};

type Listener = (status: OfflineStatus) => void;

const listeners = new Set<Listener>();
let syncing = false;
let lastSyncAt: string | null = null;
let lastError: string | null = null;
let pendingSales = 0;

export function isBrowserOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

async function refreshPendingCount() {
  const queue = await listQueuedSales();
  pendingSales = queue.filter((s) => s.status !== "syncing").length + queue.filter((s) => s.status === "syncing").length;
  pendingSales = queue.length;
}

export function getOfflineStatus(): OfflineStatus {
  return {
    online: isBrowserOnline(),
    pendingSales,
    syncing,
    lastSyncAt,
    lastError,
  };
}

export function subscribeOfflineStatus(listener: Listener): () => void {
  listeners.add(listener);
  listener(getOfflineStatus());
  return () => listeners.delete(listener);
}

function emit() {
  const status = getOfflineStatus();
  for (const listener of listeners) listener(status);
}

export async function refreshOfflineBadge(): Promise<void> {
  await refreshPendingCount();
  emit();
}

async function postSale(sale: QueuedSale): Promise<void> {
  const token = getToken();
  const res = await fetch("/api/pos/offline-sales", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(sale.payload),
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.error || message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
}

export async function syncQueuedSales(): Promise<{ synced: number; failed: number }> {
  if (!isBrowserOnline() || syncing) {
    await refreshOfflineBadge();
    return { synced: 0, failed: 0 };
  }
  syncing = true;
  lastError = null;
  emit();

  let synced = 0;
  let failed = 0;
  const queue = await listQueuedSales();
  for (const sale of queue) {
    const working: QueuedSale = { ...sale, status: "syncing" };
    await updateQueuedSale(working);
    try {
      await postSale(working);
      await removeQueuedSale(working.id);
      synced += 1;
    } catch (error) {
      failed += 1;
      lastError = error instanceof Error ? error.message : "Sync failed";
      await updateQueuedSale({
        ...working,
        status: "error",
        lastError,
      });
    }
  }

  syncing = false;
  if (synced > 0) lastSyncAt = new Date().toISOString();
  await refreshOfflineBadge();
  return { synced, failed };
}

let started = false;

export function startOfflineSync(): () => void {
  if (started) return () => undefined;
  started = true;

  const onOnline = () => {
    emit();
    void syncQueuedSales();
  };
  const onOffline = () => emit();

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  void refreshOfflineBadge().then(() => {
    if (isBrowserOnline()) void syncQueuedSales();
  });

  const timer = window.setInterval(() => {
    if (isBrowserOnline()) void syncQueuedSales();
  }, 20000);

  return () => {
    started = false;
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    window.clearInterval(timer);
  };
}
