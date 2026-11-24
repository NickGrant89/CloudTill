export type ModifierPick = {
  modifierId?: string;
  name: string;
  priceCents: number;
  groupId?: string;
  groupName?: string;
};

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