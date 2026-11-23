const TILL_KEY = "purepos.pos.till";

export type PinnedTill = { storeId: string; registerId: string; registerName: string; toneIndex: number };

/** Distinct header colours. Registers in one store are ordered by name, so two tills never share a colour until the ninth. */
export const REGISTER_TONES = [
  { bg: "#0f6e7a", ink: "#f4fffe" },
  { bg: "#c4531a", ink: "#fff7f2" },
  { bg: "#5b3fa8", ink: "#f6f2ff" },
  { bg: "#1d4e89", ink: "#f3f7ff" },
  { bg: "#8a1e4a", ink: "#fff5f8" },
  { bg: "#3d6b1f", ink: "#f5ffef" },
  { bg: "#8a5a12", ink: "#fff8ea" },
  { bg: "#243044", ink: "#f4f6fa" },
] as const;

export function registerToneIndex(registerId: string, registers: { id: string; name: string }[]) {
  const ordered = [...registers].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const index = ordered.findIndex((register) => register.id === registerId);
  return (index < 0 ? 0 : index) % REGISTER_TONES.length;
}

export function registerTone(registerId: string, registers: { id: string; name: string }[]) {
  return REGISTER_TONES[registerToneIndex(registerId, registers)];
}

export function toneAt(index: number) {
  return REGISTER_TONES[((index % REGISTER_TONES.length) + REGISTER_TONES.length) % REGISTER_TONES.length];
}

export function readPinnedTill(storeId?: string | null): PinnedTill | null {
  try {
    const raw = localStorage.getItem(TILL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PinnedTill;
    if (!parsed?.storeId || !parsed.registerId || !parsed.registerName) return null;
    if (typeof parsed.toneIndex !== "number") parsed.toneIndex = 0;
    if (storeId && parsed.storeId !== storeId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePinnedTill(pin: PinnedTill) {
  localStorage.setItem(TILL_KEY, JSON.stringify(pin));
}

export function clearPinnedTill() {
  localStorage.removeItem(TILL_KEY);
}

/** The register this device should open, or the first one if nothing is pinned. Drops a pin that no longer exists. */
export function resolveRegisterId(storeId: string, registers: { id: string; name: string }[]): string {
  const pinned = readPinnedTill(storeId);
  const match = pinned ? registers.find((register) => register.id === pinned.registerId) : undefined;
  if (match) {
    const toneIndex = registerToneIndex(match.id, registers);
    if (match.name !== pinned!.registerName || toneIndex !== pinned!.toneIndex) {
      writePinnedTill({ storeId, registerId: match.id, registerName: match.name, toneIndex });
    }
    return match.id;
  }
  if (pinned) clearPinnedTill();
  return registers[0]?.id ?? "";
}
