import { preserveHalfAndHalfTicketGroupName, priceModifierPicks, type ModifierGroupPricing } from "@cloudtill/shared";
import { prisma } from "./db.js";

export type IncomingModifier = {
  modifierId?: string;
  id?: string;
  name: string;
  priceCents: number;
  groupName?: string;
};

/** Store ticket/sale modifiers in BO order, with pizza free-topping rules and sized list prices. */
export async function orderStoredModifiers(
  mods: IncomingModifier[],
  ctx?: { variantId?: string }
) {
  const ids = mods.map((mod) => mod.modifierId || mod.id).filter((id): id is string => Boolean(id));
  const rows = ids.length
    ? await prisma.modifier.findMany({
        where: { id: { in: ids } },
        include: { group: { select: { id: true, name: true, sortOrder: true, freeSelect: true, itemId: true } } },
      })
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));

  const ordered = mods
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
      const groupName = preserveHalfAndHalfTicketGroupName(mod.groupName, row?.group.name);
      const rawName = (row?.name?.trim() ? row.name : mod.name) || mod.name;
      return {
        ...(row ? { modifierId: row.id } : mod.modifierId ? { modifierId: mod.modifierId } : {}),
        name: rawName,
        groupId: row?.group.id,
        groupName,
      };
    });

  let itemName = "";
  let groups: ModifierGroupPricing[] = [];

  if (ctx?.variantId) {
    const variant = await prisma.variant.findUnique({
      where: { id: ctx.variantId },
      include: {
        item: {
          include: {
            modifierGroups: {
              orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
              include: {
                modifiers: { where: { active: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
              },
            },
          },
        },
      },
    });
    if (variant) {
      itemName = variant.item.name;
      groups = variant.item.modifierGroups.map((group) => ({
        id: group.id,
        name: group.name,
        freeSelect: group.freeSelect ?? 0,
        modifiers: group.modifiers.map((mod) => ({
          id: mod.id,
          name: mod.name,
          priceCents: mod.priceCents,
        })),
      }));
    }
  }

  if (groups.length && itemName) {
    return priceModifierPicks(itemName, groups, ordered);
  }

  return ordered.map((pick) => ({
    ...pick,
    priceCents: byId.get(pick.modifierId ?? "")?.priceCents ?? 0,
  }));
}