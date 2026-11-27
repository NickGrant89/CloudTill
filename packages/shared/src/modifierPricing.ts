import {
  halfAndHalfRemoveCatalogGroupName,
  halfAndHalfRemoveTicketSideFromGroupName,
} from "./pizzaHalfAndHalfWizard.js";
import {
  isConsolidatedPizzaItem,
  isPizzaCyoToppingGroup,
  pizzaSizeInchesFromSelection,
  pizzaSizedToppingPriceCents,
} from "./pizzaTill.js";

export type ModifierPick = {
  modifierId?: string;
  name: string;
  priceCents: number;
  groupId?: string;
  groupName?: string;
};

export type ModifierGroupPricing = {
  id: string;
  name: string;
  freeSelect: number;
  modifiers: { id: string; name: string; priceCents: number }[];
};

export function modifierListPriceCents(
  modifierPriceCents: number,
  groupName: string,
  itemName: string,
  sizeInches: number | null
): number {
  if (modifierPriceCents > 0) return modifierPriceCents;
  if (sizeInches && isConsolidatedPizzaItem(itemName) && isPizzaCyoToppingGroup(groupName)) {
    return pizzaSizedToppingPriceCents(sizeInches);
  }
  return modifierPriceCents;
}

export function sizeInchesFromModifierPicks(
  groups: { id: string; name: string }[],
  picks: { groupId?: string; groupName?: string; name: string }[]
): number | null {
  const sizeGroup = groups.find((g) => g.name.trim().toLowerCase() === "size");
  if (!sizeGroup) return null;
  const pseudo: Record<string, { name: string }[] | undefined> = {};
  for (const pick of picks) {
    const isSize =
      pick.groupId === sizeGroup.id || pick.groupName?.trim().toLowerCase() === "size";
    if (!isSize) continue;
    pseudo[sizeGroup.id] = [{ name: pick.name }];
    break;
  }
  return pizzaSizeInchesFromSelection(groups, pseudo);
}

/**
 * Apply pizza-sized list prices and per-group freeSelect (cheapest first) for till + tickets.
 */
export function priceModifierPicks(
  itemName: string,
  groups: ModifierGroupPricing[],
  picks: { modifierId?: string; name: string; groupId?: string; groupName?: string }[]
): ModifierPick[] {
  const groupRules = groups.map((group) => ({
    id: group.id,
    name: group.name,
    freeSelect: group.freeSelect ?? 0,
  }));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const sizeInches = isConsolidatedPizzaItem(itemName) ? sizeInchesFromModifierPicks(groups, picks) : null;

  const listPriceByModifierId = new Map(
    groups.flatMap((group) =>
      group.modifiers.map((mod) => {
        const list = modifierListPriceCents(mod.priceCents, group.name, itemName, sizeInches);
        return [mod.id, list] as const;
      })
    )
  );

  const raw = picks.map((pick) => {
    const ticketName = pick.groupName?.trim();
    const sideTaggedRemove = Boolean(ticketName && halfAndHalfRemoveTicketSideFromGroupName(ticketName));
    const group =
      (pick.groupId && !sideTaggedRemove ? groupById.get(pick.groupId) : undefined) ??
      (!sideTaggedRemove && ticketName
        ? groups.find((g) => g.name.toLowerCase() === ticketName.toLowerCase())
        : undefined);
    const catalogName = group?.name;
    const groupName = sideTaggedRemove ? ticketName! : catalogName ?? ticketName ?? "";
    const priceGroupName = catalogName ?? halfAndHalfRemoveCatalogGroupName(groupName) ?? groupName;
    const db = group?.modifiers.find((mod) => mod.id === pick.modifierId);
    const list = pick.modifierId
      ? listPriceByModifierId.get(pick.modifierId) ??
        modifierListPriceCents(db?.priceCents ?? 0, priceGroupName, itemName, sizeInches)
      : modifierListPriceCents(0, priceGroupName, itemName, sizeInches);

    return {
      modifierId: pick.modifierId,
      name: pick.name,
      priceCents: list,
      groupId: sideTaggedRemove ? pick.groupId : group?.id ?? pick.groupId,
      groupName,
    };
  });

  return applyModifierFreeSelect(raw, listPriceByModifierId, groupRules);
}

export type ModifierGroupFreeRule = {
  id: string;
  name: string;
  freeSelect: number;
};

function groupKey(mod: ModifierPick): string {
  if (mod.groupId) return `id:${mod.groupId}`;
  const name = mod.groupName?.trim().toLowerCase();
  return name ? `name:${name}` : "unknown";
}

function freeSelectFor(key: string, rules: ModifierGroupFreeRule[]): number {
  if (key.startsWith("id:")) {
    const id = key.slice(3);
    return rules.find((g) => g.id === id)?.freeSelect ?? 0;
  }
  if (key.startsWith("name:")) {
    const name = key.slice(5);
    return rules.find((g) => g.name.toLowerCase() === name)?.freeSelect ?? 0;
  }
  return 0;
}

/**
 * Within each modifier group, up to `freeSelect` priced options are included (charged £0).
 * When more than the allowance are picked, the cheapest are included first; extras keep list price.
 */
export function applyModifierFreeSelect(
  mods: ModifierPick[],
  listPriceByModifierId: Map<string, number>,
  groupRules: ModifierGroupFreeRule[]
): ModifierPick[] {
  if (!mods.length || !groupRules.some((g) => g.freeSelect > 0)) return mods;

  const buckets = new Map<string, ModifierPick[]>();
  for (const mod of mods) {
    const key = groupKey(mod);
    const list = buckets.get(key);
    if (list) list.push(mod);
    else buckets.set(key, [mod]);
  }

  const freeIds = new Map<string, Set<string>>();
  for (const [key, bucket] of buckets) {
    const allowance = freeSelectFor(key, groupRules);
    if (allowance <= 0) continue;
    const priced = bucket
      .map((mod) => ({
        mod,
        list: mod.modifierId ? listPriceByModifierId.get(mod.modifierId) ?? mod.priceCents : mod.priceCents,
      }))
      .filter((row) => row.list > 0);
    const freeCount = Math.min(allowance, priced.length);
    const picked = [...priced]
      .sort((a, b) => a.list - b.list || a.mod.name.localeCompare(b.mod.name))
      .slice(0, freeCount);
    freeIds.set(
      key,
      new Set(picked.map((row) => row.mod.modifierId ?? row.mod.name))
    );
  }

  return mods.map((mod) => {
    const key = groupKey(mod);
    const list = mod.modifierId ? listPriceByModifierId.get(mod.modifierId) ?? mod.priceCents : mod.priceCents;
    if (list <= 0) return { ...mod, priceCents: 0 };
    if (freeIds.get(key)?.has(mod.modifierId ?? mod.name)) return { ...mod, priceCents: 0 };
    return { ...mod, priceCents: list };
  });
}