import { prisma } from "./db.js";

export const GENERIC_PIZZA_HIDE = [
  "Single pizza",
  "Half and half",
  "Half and half pizza option",
  "Half and half create your own",
] as const;

function nameVariants(name: string): string[] {
  return [...new Set([name, name.replace(/"/g, '"'), name.replace(/"/g, '"'), name.replace(/\u201d/g, '"')])];
}

function isLoyverseHalfAndHalfItem(name: string): boolean {
  if (!/half\s*&\s*half/i.test(name) || /cyo/i.test(name)) return false;
  return /(\d+)\s*(?:”|")/.test(name);
}

export function shouldUnassignFromHalfAndHalf(groupName: string): boolean {
  const n = groupName.trim().toLowerCase();
  if (n === "size") return true;
  if (/^(\d+)\s*(?:”|")\s*size$/i.test(groupName)) return true;
  if (n === "pizza" || n === "left half" || n === "right half") return true;
  if (n === "left sauce" || n === "right sauce" || n === "left toppings" || n === "right toppings") return true;
  if (n === "extra options") return true;
  if (/pizza options/i.test(groupName) && !/half/i.test(groupName)) return true;
  if (/extra toppings/i.test(groupName) && !/half/i.test(groupName)) return true;
  return false;
}

async function findItemByNames(storeId: string, names: readonly string[]) {
  for (const name of names) {
    for (const variant of nameVariants(name)) {
      const row = await prisma.item.findFirst({ where: { storeId, name: variant } });
      if (row) return row;
    }
  }
  return null;
}

export type GaPizzaCatalogTidyReport = {
  storeId: string;
  dryRun: boolean;
  hidden: string[];
  unassignedGeneric: { item: string; groups: string[] }[];
  halfAndHalf: { item: string; before: number; after: number; removed: string[]; kept: string[] }[];
  cyoStillActive: string[];
  message: string;
};

/** Hide four generic pizza tiles and tidy Loyverse Half & Half modifier tabs (G&A). Library menus on other items stay. */
export async function tidyGaPizzaCatalog(storeId: string, dryRun = false): Promise<GaPizzaCatalogTidyReport> {
  const hidden: string[] = [];
  const unassignedGeneric: { item: string; groups: string[] }[] = [];

  for (const name of GENERIC_PIZZA_HIDE) {
    const item = await findItemByNames(storeId, [name]);
    if (!item) continue;
    const groups = await prisma.modifierGroup.findMany({
      where: { itemId: item.id },
      select: { id: true, name: true },
    });
    if (!dryRun) {
      if (item.active) {
        await prisma.item.update({ where: { id: item.id }, data: { active: false } });
        await prisma.variant.updateMany({ where: { itemId: item.id }, data: { active: false } });
      }
      for (const g of groups) {
        await prisma.modifier.deleteMany({ where: { groupId: g.id } });
        await prisma.modifierGroup.delete({ where: { id: g.id } });
      }
    }
    hidden.push(item.name);
    unassignedGeneric.push({ item: item.name, groups: groups.map((g) => g.name) });
  }

  const halfAndHalf: GaPizzaCatalogTidyReport["halfAndHalf"] = [];
  const hhItems = await prisma.item.findMany({
    where: { storeId, active: true },
    include: { modifierGroups: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
  });

  for (const item of hhItems) {
    if (!isLoyverseHalfAndHalfItem(item.name)) continue;
    const before = item.modifierGroups.length;
    const removed: string[] = [];
    const kept: string[] = [];
    for (const group of item.modifierGroups) {
      if (shouldUnassignFromHalfAndHalf(group.name)) {
        removed.push(group.name);
        if (!dryRun) {
          await prisma.modifier.deleteMany({ where: { groupId: group.id } });
          await prisma.modifierGroup.delete({ where: { id: group.id } });
        }
      } else {
        kept.push(group.name);
      }
    }
    halfAndHalf.push({ item: item.name, before, after: before - removed.length, removed, kept });
  }

  const cyoStillActive = (
    await prisma.item.findMany({
      where: { storeId, active: true, name: { contains: "CYO", mode: "insensitive" } },
      select: { name: true },
    })
  ).map((c) => c.name);

  return {
    storeId,
    dryRun,
    hidden,
    unassignedGeneric,
    halfAndHalf,
    cyoStillActive,
    message: dryRun
      ? "Dry run — no changes written."
      : `Hid ${hidden.length} generic tiles; tidied ${halfAndHalf.length} Half & Half items. CYO H&H unchanged. PIZZAS OPTIONS library not deleted.`,
  };
}