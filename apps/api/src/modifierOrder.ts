import { prisma } from "./db.js";

export type IncomingModifier = {
  modifierId?: string;
  id?: string;
  name: string;
  priceCents: number;
  groupName?: string;
};

/** Store a sale's modifiers in the order set on the item, with the group name kept for the kitchen and receipt. */
export async function orderStoredModifiers(mods: IncomingModifier[]) {
  const ids = mods.map((mod) => mod.modifierId || mod.id).filter((id): id is string => Boolean(id));
  const rows = ids.length
    ? await prisma.modifier.findMany({
        where: { id: { in: ids } },
        include: { group: { select: { id: true, name: true, sortOrder: true } } },
      })
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));

  return mods
    .map((mod, index) => ({ mod, index }))
    .sort((a, b) => {
      const left = byId.get(a.mod.modifierId || a.mod.id || "");
      const right = byId.get(b.mod.modifierId || b.mod.id || "");
      const group = (left?.group.sortOrder ?? 1_000_000) - (right?.group.sortOrder ?? 1_000_000);
      if (group) return group;
      const groupId = (left?.group.id ?? "\uffff").localeCompare(right?.group.id ?? "\uffff");
      if (groupId) return groupId;
      const option = (left?.sortOrder ?? 1_000_000) - (right?.sortOrder ?? 1_000_000);
      if (option) return option;
      return a.index - b.index;
    })
    .map(({ mod }) => {
      const row = byId.get(mod.modifierId || mod.id || "");
      const groupName = row?.group.name || mod.groupName?.trim() || "";
      return {
        ...(row ? { modifierId: row.id } : mod.modifierId ? { modifierId: mod.modifierId } : {}),
        name: row?.name ?? mod.name,
        priceCents: row?.priceCents ?? mod.priceCents,
        ...(groupName ? { groupName } : {}),
      };
    });
}
