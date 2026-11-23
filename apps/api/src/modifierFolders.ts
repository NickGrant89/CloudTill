import { prisma } from "./db.js";

const SETTING_KEY = "modifiers.folders";

/** Smart default so pizza left/right menus group without setup. */
export function defaultModifierFolder(name: string): string {
  const n = name.trim().toLowerCase();
  if (
    /^(left|right)\b/.test(n) ||
    n === "pizza" ||
    n === "extra options" ||
    n === "half and half" ||
    n.startsWith("half ")
  ) {
    return "Pizza";
  }
  return "General";
}

export async function readModifierFolders(storeId: string): Promise<Record<string, string>> {
  const row = await prisma.setting.findUnique({
    where: { storeId_key: { storeId, key: SETTING_KEY } },
  });
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) out[key.toLowerCase()] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export async function folderForModifierSet(storeId: string, name: string): Promise<string> {
  const map = await readModifierFolders(storeId);
  return map[name.trim().toLowerCase()] || defaultModifierFolder(name);
}

export async function setModifierFolder(storeId: string, name: string, folder: string): Promise<string> {
  const map = await readModifierFolders(storeId);
  const cleaned = folder.trim() || "General";
  map[name.trim().toLowerCase()] = cleaned;
  await prisma.setting.upsert({
    where: { storeId_key: { storeId, key: SETTING_KEY } },
    create: { storeId, key: SETTING_KEY, value: JSON.stringify(map) },
    update: { value: JSON.stringify(map) },
  });
  return cleaned;
}

export async function ensureModifierFolders(
  storeId: string,
  names: string[],
  folder: string
): Promise<void> {
  const map = await readModifierFolders(storeId);
  let changed = false;
  for (const name of names) {
    const key = name.trim().toLowerCase();
    if (!map[key]) {
      map[key] = folder;
      changed = true;
    }
  }
  if (!changed) return;
  await prisma.setting.upsert({
    where: { storeId_key: { storeId, key: SETTING_KEY } },
    create: { storeId, key: SETTING_KEY, value: JSON.stringify(map) },
    update: { value: JSON.stringify(map) },
  });
}
