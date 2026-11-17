import { cacheCatalog, readCatalogCache, type CachedCatalog } from "./offline/db";
import { isBrowserOnline } from "./offline/sync";

const TOKEN_KEY = "purepos_pos_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class OfflineError extends Error {
  constructor(message = "You are offline") {
    super(message);
    this.name = "OfflineError";
  }
}

function isNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException && error.name === "NetworkError") return true;
  return false;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  if (!isBrowserOnline()) {
    throw new OfflineError();
  }

  try {
    const res = await fetch(`/api${path}`, { ...options, headers });
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
    if (res.status === 204) return undefined as T;
    return res.json();
  } catch (error) {
    if (error instanceof OfflineError) throw error;
    if (isNetworkFailure(error)) throw new OfflineError();
    throw error;
  }
}

export async function saveCatalogSnapshot(snapshot: Omit<CachedCatalog, "cachedAt">): Promise<void> {
  await cacheCatalog({ ...snapshot, cachedAt: new Date().toISOString() });
}

export async function loadCatalogSnapshot(): Promise<CachedCatalog | undefined> {
  return readCatalogCache();
}

export function money(cents: number, symbol = "£"): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}${symbol}${(Math.abs(cents) / 100).toFixed(2)}`;
}
