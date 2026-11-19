/** Extra durability: persistent storage, SW sync, leave warnings, emergency export. */
import { listQueuedSales, persistAuthToken, type QueuedSale } from "./db";

export { persistAuthToken };

const SYNC_TAG = "purepos-sync-sales";

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    const already = (await navigator.storage.persisted?.()) ?? false;
    if (already) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function registerTillServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const base = import.meta.env.BASE_URL || "/";
    const swUrl = new URL("sw.js", `${window.location.origin}${base.endsWith("/") ? base : `${base}/`}`).href;
    const reg = await navigator.serviceWorker.register(swUrl, { scope: base });
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "purepos-sync-done") {
        void import("./sync").then(({ refreshOfflineBadge, syncQueuedSales }) => {
          void refreshOfflineBadge();
          if (event.data.synced > 0) void syncQueuedSales();
        });
      }
    });
    return reg;
  } catch {
    return null;
  }
}

export async function requestBackgroundSaleSync(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg && "sync" in reg) {
      await (reg as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register(
        SYNC_TAG
      );
      return;
    }
    reg?.active?.postMessage({ type: "purepos-sync-now" });
  } catch {
    /* Background Sync unsupported — page interval sync still runs */
  }
}

export function installUnsyncedLeaveGuard(getPending: () => number): () => void {
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (getPending() <= 0) return;
    event.preventDefault();
    event.returnValue = "You have unsynced offline sales. Stay until Sync clears.";
    return event.returnValue;
  };
  window.addEventListener("beforeunload", onBeforeUnload);
  return () => window.removeEventListener("beforeunload", onBeforeUnload);
}

export async function exportPendingSalesBackup(): Promise<{ count: number; filename: string } | null> {
  const queue = await listQueuedSales();
  if (!queue.length) return null;
  const payload = {
    exportedAt: new Date().toISOString(),
    product: "PurePOS",
    note: "Emergency backup of unsynced offline till sales. Support can replay via /api/pos/offline-sales.",
    sales: queue as QueuedSale[],
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const filename = `purepos-offline-sales-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return { count: queue.length, filename };
}
