import { prisma } from "./db.js";

const SETTING_KEY = "modifiers.folders";

export type ModifierLayout = {
  /** set name (lower) → folder label */
  map: Record<string, string>;
  /** display order of folder labels */
  folderOrder: string[];
  /** display / till order of modifier set names */
  menuOrder: string[];
};

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

function parseLayout(raw: string | null | undefined): ModifierLayout {
  const empty: ModifierLayout = { map: {}, folderOrder: [], menuOrder: [] };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;
    const obj = parsed as Record<string, unknown>;
    // Legacy: plain map of set → folder
    if (!("map" in obj) && !("folderOrder" in obj) && !("menuOrder" in obj)) {
      const map: Record<string, string> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === "string" && value.trim()) map[key.toLowerCase()] = value.trim();
      }
      return { map, folderOrder: [], menuOrder: [] };
    }
    const map: Record<string, string> = {};
    if (obj.map && typeof obj.map === "object" && !Array.isArray(obj.map)) {
      for (const [key, value] of Object.entries(obj.map as Record<string, unknown>)) {
        if (typeof value === "string" && value.trim()) map[key.toLowerCase()] = value.trim();
      }
    }
    const folderOrder = Array.isArray(obj.folderOrder)
      ? obj.folderOrder.filter((v): v is string => typeof v === "string" && Boolean(v.trim())).map((v) => v.trim())
      : [];
    const menuOrder = Array.isArray(obj.menuOrder)
      ? obj.menuOrder.filter((v): v is string => typeof v === "string" && Boolean(v.trim())).map((v) => v.trim())
      : [];
    return { map, folderOrder, menuOrder };
  } catch {
    return empty;
  }
}

export async function readModifierLayout(storeId: string): Promise<ModifierLayout> {
  const row = await prisma.setting.findUnique({
    where: { storeId_key: { storeId, key: SETTING_KEY } },
  });
  return parseLayout(row?.value);
}

/** @deprecated use readModifierLayout */
export async function readModifierFolders(storeId: string): Promise<Record<string, string>> {
  return (await readModifierLayout(storeId)).map;
}

async function writeLayout(storeId: string, layout: ModifierLayout): Promise<void> {
  await prisma.setting.upsert({
    where: { storeId_key: { storeId, key: SETTING_KEY } },
    create: { storeId, key: SETTING_KEY, value: JSON.stringify(layout) },
    update: { value: JSON.stringify(layout) },
  });
}

export async function folderForModifierSet(storeId: string, name: string): Promise<string> {
  const layout = await readModifierLayout(storeId);
  return layout.map[name.trim().toLowerCase()] || defaultModifierFolder(name);
}

export async function setModifierFolder(storeId: string, name: string, folder: string): Promise<string> {
  const layout = await readModifierLayout(storeId);
  const cleaned = folder.trim() || "General";
  layout.map[name.trim().toLowerCase()] = cleaned;
  if (!layout.folderOrder.some((f) => f.toLowerCase() === cleaned.toLowerCase())) {
    layout.folderOrder.push(cleaned);
  }
  if (!layout.menuOrder.some((m) => m.toLowerCase() === name.trim().toLowerCase())) {
    layout.menuOrder.push(name.trim());
  }
  await writeLayout(storeId, layout);
  return cleaned;
}

export async function ensureModifierFolders(
  storeId: string,
  names: string[],
  folder: string
): Promise<void> {
  const layout = await readModifierLayout(storeId);
  let changed = false;
  for (const name of names) {
    const key = name.trim().toLowerCase();
    if (!layout.map[key]) {
      layout.map[key] = folder;
      changed = true;
    }
    if (!layout.menuOrder.some((m) => m.toLowerCase() === key)) {
      layout.menuOrder.push(name.trim());
      changed = true;
    }
  }
  if (!layout.folderOrder.some((f) => f.toLowerCase() === folder.toLowerCase())) {
    layout.folderOrder.push(folder);
    changed = true;
  }
  if (!changed) return;
  await writeLayout(storeId, layout);
}

export function sortFolders(folderNames: string[], folderOrder: string[]): string[] {
  const rank = new Map(folderOrder.map((name, index) => [name.toLowerCase(), index]));
  return [...folderNames].sort((a, b) => {
    const ra = rank.has(a.toLowerCase()) ? rank.get(a.toLowerCase())! : 10_000;
    const rb = rank.has(b.toLowerCase()) ? rank.get(b.toLowerCase())! : 10_000;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
}

export function sortMenus(names: string[], menuOrder: string[]): string[] {
  const rank = new Map(menuOrder.map((name, index) => [name.toLowerCase(), index]));
  return [...names].sort((a, b) => {
    const ra = rank.has(a.toLowerCase()) ? rank.get(a.toLowerCase())! : 10_000;
    const rb = rank.has(b.toLowerCase()) ? rank.get(b.toLowerCase())! : 10_000;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
}

/** Push ModifierGroup.sortOrder on every item to match menuOrder (till + ticket order). */
export async function syncModifierGroupSortOrders(storeId: string, menuOrder: string[]): Promise<number> {
  const rank = new Map(menuOrder.map((name, index) => [name.toLowerCase(), index]));
  const groups = await prisma.modifierGroup.findMany({
    where: { item: { storeId, active: true } },
    select: { id: true, name: true, itemId: true, sortOrder: true },
  });
  const byItem = new Map<string, typeof groups>();
  for (const group of groups) {
    const list = byItem.get(group.itemId) ?? [];
    list.push(group);
    byItem.set(group.itemId, list);
  }
  let updated = 0;
  for (const list of byItem.values()) {
    const sorted = [...list].sort((a, b) => {
      const ra = rank.has(a.name.toLowerCase()) ? rank.get(a.name.toLowerCase())! : 10_000;
      const rb = rank.has(b.name.toLowerCase()) ? rank.get(b.name.toLowerCase())! : 10_000;
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    for (let index = 0; index < sorted.length; index += 1) {
      if (sorted[index].sortOrder === index) continue;
      await prisma.modifierGroup.update({ where: { id: sorted[index].id }, data: { sortOrder: index } });
      updated += 1;
    }
  }
  return updated;
}

export async function saveModifierLayout(
  storeId: string,
  next: Partial<ModifierLayout> & { renameFolder?: { from: string; to: string }; renameSet?: { from: string; to: string } }
): Promise<ModifierLayout> {
  const layout = await readModifierLayout(storeId);

  if (next.renameFolder) {
    const from = next.renameFolder.from.trim();
    const to = next.renameFolder.to.trim() || from;
    for (const key of Object.keys(layout.map)) {
      if (layout.map[key].toLowerCase() === from.toLowerCase()) layout.map[key] = to;
    }
    layout.folderOrder = layout.folderOrder.map((name) =>
      name.toLowerCase() === from.toLowerCase() ? to : name
    );
    if (!layout.folderOrder.some((name) => name.toLowerCase() === to.toLowerCase())) {
      layout.folderOrder.push(to);
    }
  }

  if (next.renameSet) {
    const from = next.renameSet.from.trim();
    const to = next.renameSet.to.trim() || from;
    const fromKey = from.toLowerCase();
    const folder = layout.map[fromKey];
    if (folder) {
      delete layout.map[fromKey];
      layout.map[to.toLowerCase()] = folder;
    }
    layout.menuOrder = layout.menuOrder.map((name) => (name.toLowerCase() === fromKey ? to : name));
    if (!layout.menuOrder.some((name) => name.toLowerCase() === to.toLowerCase())) {
      layout.menuOrder.push(to);
    }
    const groups = await prisma.modifierGroup.findMany({
      where: { item: { storeId } },
      select: { id: true, name: true },
    });
    for (const group of groups) {
      if (group.name.toLowerCase() === fromKey && group.name !== to) {
        await prisma.modifierGroup.update({ where: { id: group.id }, data: { name: to } });
      }
    }
  }

  if (next.map) layout.map = next.map;
  if (next.folderOrder) layout.folderOrder = next.folderOrder.map((v) => v.trim()).filter(Boolean);
  if (next.menuOrder) layout.menuOrder = next.menuOrder.map((v) => v.trim()).filter(Boolean);

  await writeLayout(storeId, layout);
  if (next.menuOrder || next.renameSet) {
    await syncModifierGroupSortOrders(storeId, layout.menuOrder);
  }
  return layout;
}
