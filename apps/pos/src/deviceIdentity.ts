const DEVICE_ID_KEY = "purepos.pos.deviceId";
const DEVICE_LABEL_KEY = "purepos.pos.deviceLabel";

function randomKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Stable browser id so back office can show the same phone/iPad across logins. */
export function getOrCreateDeviceKey(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing && existing.length >= 8) return existing;
  } catch {
    // ignore
  }
  const next = randomKey();
  try {
    localStorage.setItem(DEVICE_ID_KEY, next);
  } catch {
    // ignore
  }
  return next;
}

function guessLabelFromUa(ua: string): string {
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua))) return "iPad";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Mac OS|Macintosh/i.test(ua)) return "Mac";
  if (/Linux/i.test(ua)) return "Linux PC";
  return "Till device";
}

export function getDeviceLabel(): string {
  try {
    const saved = localStorage.getItem(DEVICE_LABEL_KEY)?.trim();
    if (saved) return saved.slice(0, 80);
  } catch {
    // ignore
  }
  return guessLabelFromUa(typeof navigator !== "undefined" ? navigator.userAgent : "");
}

export function setDeviceLabel(label: string) {
  try {
    localStorage.setItem(DEVICE_LABEL_KEY, label.trim().slice(0, 80));
  } catch {
    // ignore
  }
}

export type HeartbeatResult = {
  device: { id: string; label: string; registerId: string | null; online: boolean };
  registerId: string | null;
  registers: { id: string; name: string; storeId: string }[];
};

/** Tell back office this device is signed in (and optionally which till it is). */
export async function sendTillHeartbeat(
  api: <T>(path: string, options?: RequestInit) => Promise<T>,
  registerId?: string | null,
  _registerName?: string | null
): Promise<HeartbeatResult | null> {
  try {
    // Keep hardware label (iPad / iPhone) — till name lives on registerId, not device.label
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    let label = getDeviceLabel();
    try {
      const saved = localStorage.getItem(DEVICE_LABEL_KEY)?.trim();
      // Drop accidental till-name labels from 0.10.32 so Devices stay iPad/iPhone
      if (saved && !/^(iPad|iPhone|Android|Mac|Windows|Linux|Till device)/i.test(saved)) {
        label = guessLabelFromUa(ua);
        setDeviceLabel(label);
      }
    } catch {
      // ignore
    }
    return await api<HeartbeatResult>("/employees/devices/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        deviceKey: getOrCreateDeviceKey(),
        label,
        registerId: registerId || undefined,
        userAgent: ua ? ua.slice(0, 400) : undefined,
      }),
    });
  } catch {
    return null;
  }
}
