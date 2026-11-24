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