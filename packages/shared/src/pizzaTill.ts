/** Inch size encoded in Loyverse-style modifier menu names (9" / 12" / 16"). */
export function modifierGroupInchSize(groupName: string): number | null {
  const match = groupName.match(/(\d+)\s*(?:”|")/);
  if (!match) return null;
  const inches = Number(match[1]);
  return inches === 9 || inches === 12 || inches === 16 ? inches : null;
}

export function pizzaSizeInchesFromSelection(
  groups: { id: string; name: string }[],
  selected: Record<string, { name: string }[] | undefined>
): number | null {
  const sizeGroup = groups.find((g) => g.name.trim().toLowerCase() === "size");
  if (!sizeGroup) return null;
  const picked = selected[sizeGroup.id]?.[0];
  if (!picked) return null;
  const match = picked.name.match(/(\d+)/);
  if (!match) return null;
  const inches = Number(match[1]);
  return inches === 9 || inches === 12 || inches === 16 ? inches : null;
}

/** PurePOS consolidated pizza items use the "Pizza —" prefix. */
export function isConsolidatedPizzaItem(itemName: string): boolean {
  return itemName.trim().startsWith("Pizza —");
}

export function visiblePizzaModifierGroups<
  T extends { id: string; name: string }
>(itemName: string, groups: T[], selected: Record<string, { name: string }[] | undefined>): T[] {
  if (!isConsolidatedPizzaItem(itemName)) return groups;
  const sizeInches = pizzaSizeInchesFromSelection(groups, selected);
  return groups.filter((group) => {
    if (group.name.trim().toLowerCase() === "size") return true;
    const scoped = modifierGroupInchSize(group.name);
    if (scoped) return sizeInches !== null && scoped === sizeInches;
    return sizeInches !== null;
  });
}

export function isPizzaCyoToppingGroup(groupName: string): boolean {
  const n = groupName.trim().toLowerCase();
  return (
    n.includes("cyo half & half") ||
    n.includes("create your own") && n.includes("free topping")
  );
}

/** G&A Loyverse extra-topping pence by size when CYO options are listed at £0. */
export function pizzaSizedToppingPriceCents(sizeInches: number): number {
  if (sizeInches === 9) return 80;
  if (sizeInches === 16) return 100;
  return 90;
}

function pizzaGroupRole(groupName: string): string {
  return groupName
    .replace(/^(\d+)\s*(?:”|")\s*/i, "")
    .trim()
    .toLowerCase();
}

/** Till tab / receipt labels for consolidated pizza (not half-and-half — use kitchenHalfAndHalfGroupLabel there). */
export function tillPizzaModGroupLabel(groupName: string): string {
  const n = groupName.trim();
  const role = pizzaGroupRole(n);
  if (role === "size") return "Size";
  if (role === "pizza base") return "Base";
  if (role === "pizza sauce" || role === "pizza sauce 2") return "Sauce";
  if (role.startsWith("right cyo")) return "Right toppings";
  if (role.startsWith("left cyo")) return "Left toppings";
  if (role.startsWith("right half & half pizza")) return "Right pizza";
  if (role.startsWith("left half & half")) return "Left pizza";
  if (role.includes("create your own")) return "Toppings";
  if (role === "pizza options") return "Options";
  if (/remove topping/.test(role)) return "Remove";
  const stripped = n.replace(/^(\d+)\s*(?:”|")\s*/i, "").trim();
  return stripped || n;
}