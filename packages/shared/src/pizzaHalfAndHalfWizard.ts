import { isConsolidatedPizzaItem, tillPizzaModGroupLabel } from "./pizzaTill.js";

export const HALF_AND_HALF_PRESET_ITEM = "Pizza — Half & half";
export const HALF_AND_HALF_CYO_ITEM = "Pizza — Half & half (CYO)";

export type HalfAndHalfKind = "preset" | "cyo";

/** Consolidated half-and-half items that use the till wizard. */
export function halfAndHalfKind(itemName: string): HalfAndHalfKind | null {
  const trimmed = itemName.trim();
  if (trimmed === HALF_AND_HALF_PRESET_ITEM) return "preset";
  if (trimmed === HALF_AND_HALF_CYO_ITEM) return "cyo";
  return null;
}

export function isHalfAndHalfWizardItem(itemName: string): boolean {
  return halfAndHalfKind(itemName) !== null;
}

export type HalfAndHalfWizardStepId = "size" | "base" | "sauce" | "halves" | "options";

export const HALF_AND_HALF_WIZARD_STEPS: { id: HalfAndHalfWizardStepId; title: string; subtitle: string }[] = [
  { id: "size", title: "Size", subtitle: "9″, 12″ or 16″" },
  { id: "base", title: "Base", subtitle: "Pizza base" },
  { id: "sauce", title: "Sauce", subtitle: "Both halves or each side" },
  { id: "halves", title: "Halves", subtitle: "Right and left" },
  { id: "options", title: "Options", subtitle: "Remove toppings and extras" },
];

function normRole(name: string): string {
  return name
    .replace(/^(\d+)\s*(?:”|")\s*/i, "")
    .trim()
    .toLowerCase();
}

export function halfAndHalfWizardStepForGroup(groupName: string): HalfAndHalfWizardStepId | null {
  const role = normRole(groupName);
  if (role === "size") return "size";
  if (role === "pizza base") return "base";
  if (role === "pizza sauce" || role === "pizza sauce 2") return "sauce";
  if (isHalfAndHalfRemoveGroup(groupName)) return "options";
  if (isHalfAndHalfExtrasGroup(groupName)) return "options";
  if (/right/i.test(groupName) && /half/i.test(groupName)) return "halves";
  if (/left/i.test(groupName) && /half/i.test(groupName)) return "halves";
  return null;
}

/** Size-scoped or library extras/remove rows under the halves step. */
export function isHalfAndHalfExtrasGroup(groupName: string): boolean {
  if (/half\s*&\s*half\s*extras/i.test(groupName)) return true;
  const role = normRole(groupName);
  if (/extra\s+topping/.test(role) && /half/.test(groupName.toLowerCase())) return true;
  if (/extras/.test(role) && (/left/i.test(groupName) || /right/i.test(groupName))) return true;
  return false;
}

/** Loyverse remove lists: `Remove Toppings`, `12" Remove Toppings`, half-specific names — not extras. */
export function isPizzaRemoveToppingGroup(groupName: string): boolean {
  if (isHalfAndHalfExtrasGroup(groupName)) return false;
  const role = normRole(groupName);
  const lower = groupName.trim().toLowerCase();
  if (/remove\s+topping/.test(role)) return true;
  if (/\bremove\b/.test(lower) && !/half\s*&\s*half\s*extras/i.test(lower)) return true;
  if (/^no\s+/.test(role)) return true;
  return false;
}

export function halfAndHalfRemoveCatalogGroupName(groupName: string): string {
  return groupName.replace(/\s*\((LEFT|RIGHT) half\)\s*$/i, "").trim();
}

/** Side encoded on ticket lines for shared remove menus. */
export function halfAndHalfRemoveTicketSideFromGroupName(groupName: string): "left" | "right" | null {
  if (/\(LEFT half\)\s*$/i.test(groupName.trim())) return "left";
  if (/\(RIGHT half\)\s*$/i.test(groupName.trim())) return "right";
  return null;
}

export function halfAndHalfRemoveTicketGroupName(catalogGroupName: string, side: "left" | "right"): string {
  const tail = halfAndHalfColumnTailSide(catalogGroupName);
  if (tail === "left" || tail === "right") return catalogGroupName;
  return `${catalogGroupName} (${side === "left" ? "LEFT" : "RIGHT"} half)`;
}

export function halfAndHalfRemoveSelectionKey(groupId: string, side: "left" | "right"): string {
  return `${groupId}:hh-remove-${side}`;
}

export function isHalfAndHalfRemoveSelectionKey(key: string): boolean {
  return /:hh-remove-(left|right)$/.test(key);
}

export function halfAndHalfRemoveSelectionGroupId(key: string): string {
  return key.replace(/:hh-remove-(left|right)$/, "");
}

export function isHalfAndHalfRemoveGroup(groupName: string): boolean {
  return isPizzaRemoveToppingGroup(halfAndHalfRemoveCatalogGroupName(groupName));
}

export function isHalfAndHalfHalvesColumnGroup(groupName: string): boolean {
  return halfAndHalfWizardStepForGroup(groupName) === "halves";
}

export function halfAndHalfSauceGroups<T extends { id: string; name: string }>(
  groups: T[]
): { left?: T; right?: T } {
  const sauces = groups.filter((g) => isHalfAndHalfSauceGroup(g.name));
  const left = sauces.find((g) => normRole(g.name) === "pizza sauce") ?? sauces[0];
  const right =
    sauces.find((g) => normRole(g.name) === "pizza sauce 2") ??
    (sauces.length > 1 ? sauces.find((g) => g !== left) ?? sauces[1] : undefined);
  return { left, right };
}

/** One sauce tile list — options deduped by name from Pizza Sauce + Pizza Sauce 2. */
export function halfAndHalfMergedSauceOptions<
  G extends { id: string; name: string; modifiers: M[] },
  M extends { id: string; name: string }
>(groups: G[]): { group: G; modifier: M }[] {
  const { left, right } = halfAndHalfSauceGroups(groups);
  const seen = new Set<string>();
  const rows: { group: G; modifier: M }[] = [];
  for (const group of [left, right].filter(Boolean) as G[]) {
    for (const modifier of group.modifiers) {
      const key = modifier.name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ group, modifier });
    }
  }
  return rows;
}

/** Mirror left sauce pick into right group (modifier ids differ; match by name). */
export function withLinkedHalfAndHalfSauces<
  G extends { id: string; name: string; modifiers: M[] },
  M extends { id: string; name: string }
>(visibleGroups: G[], selected: Record<string, M[]>, sauceLinked: boolean): Record<string, M[]> {
  if (!sauceLinked) return selected;
  const { left, right } = halfAndHalfSauceGroups(visibleGroups);
  if (!left || !right) return selected;
  const pick = selected[left.id]?.[0] ?? selected[right.id]?.[0];
  if (!pick) return selected;
  const leftMod = mirrorSauceModifier(left, pick);
  const rightMod = mirrorSauceModifier(right, pick);
  const curRight = selected[right.id]?.[0];
  if (selected[left.id]?.[0]?.id === leftMod.id && curRight?.id === rightMod.id) return selected;
  return { ...selected, [left.id]: [leftMod], [right.id]: [rightMod] };
}

export function mirrorSauceModifier<T extends { id: string; name: string }>(
  group: { modifiers: T[] },
  picked: T
): T {
  return (
    group.modifiers.find((m) => m.id === picked.id) ??
    group.modifiers.find((m) => m.name === picked.name) ??
    picked
  );
}

export type HalfAndHalfStepCheck = {
  stepId: HalfAndHalfWizardStepId;
  visibleGroups: { id: string; name: string; minSelect: number }[];
  selected: Record<string, unknown[] | undefined>;
  sauceLinked?: boolean;
};

export function halfAndHalfStepSatisfied(check: HalfAndHalfStepCheck): boolean {
  const { stepId, visibleGroups, selected, sauceLinked } = check;
  const groups = visibleGroups.filter((g) => halfAndHalfWizardStepForGroup(g.name) === stepId);
  if (!groups.length) return true;

  if (stepId === "sauce" && sauceLinked) {
    const { left, right } = halfAndHalfSauceGroups(groups);
    if (!left) return groups.every((g) => (selected[g.id] ?? []).length >= g.minSelect);
    const leftSel = selected[left.id] ?? [];
    if (leftSel.length < left.minSelect) return false;
    if (!right || right.minSelect <= 0) return true;
    const rightSel = selected[right.id] ?? [];
    if (rightSel.length >= right.minSelect) return true;
    // Apply-both: one visible pick is enough — right is mirrored by name in state sync
    return leftSel.length > 0;
  }

  if (stepId === "halves") {
    const columnGroups = groups.filter((g) => isHalfAndHalfHalvesColumnGroup(g.name));
    return columnGroups.every((g) => (selected[g.id] ?? []).length >= g.minSelect);
  }

  return groups.every((g) => (selected[g.id] ?? []).length >= g.minSelect);
}

export function isHalfAndHalfSauceGroup(groupName: string): boolean {
  const role = normRole(groupName);
  return role === "pizza sauce" || role === "pizza sauce 2";
}

export function isHalfAndHalfRightGroup(groupName: string): boolean {
  return /right/i.test(groupName) && /half/i.test(groupName);
}

export function isHalfAndHalfLeftGroup(groupName: string): boolean {
  return /left/i.test(groupName) && /half/i.test(groupName);
}

/** Kitchen / ticket heading for a modifier group on half-and-half items. */
export function kitchenHalfAndHalfGroupLabel(groupName: string): string {
  const role = normRole(groupName);
  if (isHalfAndHalfLeftGroup(groupName) && !isHalfAndHalfExtrasGroup(groupName)) return "LEFT";
  if (isHalfAndHalfRightGroup(groupName) && !isHalfAndHalfExtrasGroup(groupName)) return "RIGHT";
  if (role === "pizza sauce") return "Sauce (left)";
  if (role === "pizza sauce 2") return "Sauce (right)";
  if (role === "size") return "Size";
  if (role === "pizza base") return "Base";
  return tillPizzaModGroupLabel(groupName);
}

/** Till UI label for a group inside the wizard (halves columns). */
export function halfAndHalfWizardGroupLabel(groupName: string): string {
  if (isHalfAndHalfRightGroup(groupName) && !isHalfAndHalfExtrasGroup(groupName)) return "RIGHT";
  if (isHalfAndHalfLeftGroup(groupName) && !isHalfAndHalfExtrasGroup(groupName)) return "LEFT";
  if (isHalfAndHalfSauceGroup(groupName)) {
    return normRole(groupName) === "pizza sauce 2" ? "Sauce (right)" : "Sauce (left)";
  }
  return tillPizzaModGroupLabel(groupName);
}

export function halfAndHalfExtrasRowLabel(groupName: string): string {
  const stripped = groupName.replace(/^(\d+)\s*(?:”|")\s*/i, "").trim();
  return stripped || groupName;
}

export function halfAndHalfColumnGroupsForSide<
  T extends { id: string; name: string; modifiers: { id: string; name: string }[] }
>(groups: T[], side: "right" | "left"): T[] {
  return groups.filter((g) => {
    if (!isHalfAndHalfHalvesColumnGroup(g.name)) return false;
    return side === "right" ? isHalfAndHalfRightGroup(g.name) : isHalfAndHalfLeftGroup(g.name);
  });
}

/** @deprecated use halfAndHalfWizardExtrasGroups */
export function halfAndHalfExtrasGroups<T extends { name: string }>(groups: T[]): T[] {
  return halfAndHalfWizardExtrasGroups(groups);
}

export function halfAndHalfWizardExtrasGroups<T extends { name: string }>(groups: T[]): T[] {
  return groups.filter((g) => isHalfAndHalfExtrasGroup(g.name));
}

export function halfAndHalfWizardRemoveGroups<T extends { name: string }>(groups: T[]): T[] {
  return groups.filter((g) => isHalfAndHalfRemoveGroup(g.name));
}

export type HalfAndHalfColumnTailSide = "right" | "left" | "shared";

/** Which halves column owns an extras/remove group (shared = full-width row below both columns). */
export function halfAndHalfColumnTailSide(groupName: string): HalfAndHalfColumnTailSide {
  if (!isHalfAndHalfExtrasGroup(groupName) && !isHalfAndHalfRemoveGroup(groupName)) return "shared";
  const lower = groupName.toLowerCase();
  const hasRight = /\bright\b/.test(lower);
  const hasLeft = /\bleft\b/.test(lower);
  if (hasRight && !hasLeft) return "right";
  if (hasLeft && !hasRight) return "left";
  if (isHalfAndHalfRemoveGroup(groupName)) return "shared";
  if (isHalfAndHalfRightGroup(groupName)) return "right";
  if (isHalfAndHalfLeftGroup(groupName)) return "left";
  return "shared";
}

export function halfAndHalfColumnTailGroupsForSide<T extends { name: string }>(
  groups: T[],
  side: "right" | "left"
): T[] {
  return halfAndHalfWizardExtrasGroups(groups).filter((g) => halfAndHalfColumnTailSide(g.name) === side);
}

/** Remove lists per Options column — shared `Remove Toppings` menus appear on both sides; L/R-named lists on matching side. */
export function halfAndHalfRemoveGroupsForSide<T extends { name: string }>(
  groups: T[],
  side: "right" | "left"
): T[] {
  return halfAndHalfWizardRemoveGroups(groups).filter((g) => {
    const tail = halfAndHalfColumnTailSide(g.name);
    if (tail === "left") return side === "left";
    if (tail === "right") return side === "right";
    return tail === "shared";
  });
}

/** Till Options step section headings (one line per side). */
export function halfAndHalfWizardOptionsSectionTitle(
  side: "left" | "right",
  section: "remove" | "extras"
): string {
  const half = side === "left" ? "Left" : "Right";
  return section === "remove" ? `${half} remove` : `${half} extras`;
}

/** Flatten till picker state into priced ticket rows (separate remove picks per half). */
export function halfAndHalfSelectedModifierPicks(
  itemName: string,
  groups: { id: string; name: string }[],
  selected: Record<string, { id: string; name: string }[] | undefined>
): { modifierId: string; name: string; groupId: string; groupName: string }[] {
  const rows: { modifierId: string; name: string; groupId: string; groupName: string }[] = [];
  for (const group of groups) {
    if (isHalfAndHalfWizardItem(itemName) && isHalfAndHalfRemoveGroup(group.name)) {
      for (const side of ["left", "right"] as const) {
        const key = halfAndHalfRemoveSelectionKey(group.id, side);
        for (const option of selected[key] ?? []) {
          rows.push({
            modifierId: option.id,
            name: option.name,
            groupId: group.id,
            groupName: halfAndHalfRemoveTicketGroupName(group.name, side),
          });
        }
      }
      continue;
    }
    for (const option of selected[group.id] ?? []) {
      rows.push({
        modifierId: option.id,
        name: option.name,
        groupId: group.id,
        groupName: group.name,
      });
    }
  }
  return rows;
}

/** @deprecated full-width removes — use per-side columns */
export function halfAndHalfSharedTailGroups<T extends { name: string }>(groups: T[]): T[] {
  return halfAndHalfWizardRemoveGroups(groups);
}

/** One merged tile list per side (CYO main + extra topping menus). */
export function halfAndHalfMergedColumnOptions<
  G extends { id: string; modifiers: { id: string; name: string }[] }
>(columnGroups: G[]): { group: G; modifier: G["modifiers"][number] }[] {
  const seen = new Set<string>();
  const rows: { group: G; modifier: G["modifiers"][number] }[] = [];
  for (const group of columnGroups) {
    for (const modifier of group.modifiers) {
      if (seen.has(modifier.id)) continue;
      seen.add(modifier.id);
      rows.push({ group, modifier });
    }
  }
  return rows;
}

/**
 * Sale / kitchen / receipt display order for half-and-half (full left block, then full right):
 * Size → Base → Sauce L → Left half → Left removes → Left extras → Sauce R → Right half → Right removes → Right extras.
 * Shared remove lists sort with the left block and are duplicated after the right half in prepareHalfAndHalfLineModifiers.
 */
export function halfAndHalfModifierDisplayRank(groupName: string): number {
  const role = normRole(groupName);
  if (role === "size") return 0;
  if (role === "pizza base") return 10;
  if (role === "pizza sauce") return 20;
  if (isHalfAndHalfLeftGroup(groupName) && !isHalfAndHalfExtrasGroup(groupName)) return 30;
  if (isHalfAndHalfRemoveGroup(groupName)) {
    const ticketSide = halfAndHalfRemoveTicketSideFromGroupName(groupName);
    if (ticketSide === "right") return 65;
    if (ticketSide === "left") return 35;
    const side = halfAndHalfColumnTailSide(halfAndHalfRemoveCatalogGroupName(groupName));
    return side === "right" ? 65 : 35;
  }
  if (isHalfAndHalfExtrasGroup(groupName) && halfAndHalfColumnTailSide(groupName) === "left") return 40;
  if (role === "pizza sauce 2") return 50;
  if (isHalfAndHalfRightGroup(groupName) && !isHalfAndHalfExtrasGroup(groupName)) return 60;
  if (isHalfAndHalfExtrasGroup(groupName) && halfAndHalfColumnTailSide(groupName) === "right") return 70;
  if (isHalfAndHalfExtrasGroup(groupName)) return 45;
  return 100;
}

export function sortHalfAndHalfModifiersForDisplay<T extends { groupName?: string }>(
  mods: T[]
): T[] {
  return [...mods].sort((a, b) => {
    const ra = halfAndHalfModifierDisplayRank(a.groupName ?? "");
    const rb = halfAndHalfModifierDisplayRank(b.groupName ?? "");
    if (ra !== rb) return ra - rb;
    return (a.groupName ?? "").localeCompare(b.groupName ?? "", undefined, { sensitivity: "base" });
  });
}

/** Kitchen / sale display order for modifiers on a line item. */
export function orderModifiersForDisplay<T extends { name?: string; groupName?: string }>(
  itemName: string | undefined,
  mods: T[]
): T[] {
  if (!itemName || !isHalfAndHalfWizardItem(itemName)) return mods;
  return sortHalfAndHalfModifiersForDisplay(mods);
}

export function halfAndHalfSaucesMirrored<T extends { name?: string; groupName?: string }>(mods: T[]): boolean {
  const left = mods.find((m) => normRole(m.groupName ?? "") === "pizza sauce");
  const right = mods.find((m) => normRole(m.groupName ?? "") === "pizza sauce 2");
  if (!left?.name?.trim() || !right?.name?.trim()) return false;
  return left.name.trim().toLowerCase() === right.name.trim().toLowerCase();
}

/** Sorted (L before R) modifiers for ticket/receipt/KDS; drops duplicate right sauce when mirrored. */
export function prepareHalfAndHalfLineModifiers<T extends { name?: string; groupName?: string }>(
  itemName: string | undefined,
  mods: T[]
): { mods: T[]; mirroredSauces: boolean } {
  if (!itemName || !isHalfAndHalfWizardItem(itemName)) return { mods, mirroredSauces: false };
  const mirroredSauces = halfAndHalfSaucesMirrored(mods);
  let ordered = sortHalfAndHalfModifiersForDisplay(mods);
  if (mirroredSauces) {
    ordered = ordered.filter((m) => normRole(m.groupName ?? "") !== "pizza sauce 2");
  }
  ordered = duplicateSharedRemoveToppingsForRightHalf(ordered);
  return { mods: ordered, mirroredSauces };
}

/** Loyverse shared `Remove Toppings` — show under left block and again under right half on kitchen/receipt. */
function duplicateSharedRemoveToppingsForRightHalf<T extends { name?: string; groupName?: string }>(
  ordered: T[]
): T[] {
  const shared = ordered.filter((m) => {
    const gn = m.groupName ?? "";
    if (halfAndHalfRemoveTicketSideFromGroupName(gn)) return false;
    return isHalfAndHalfRemoveGroup(gn) && halfAndHalfColumnTailSide(halfAndHalfRemoveCatalogGroupName(gn)) === "shared";
  });
  if (!shared.length) return ordered;
  const out: T[] = [];
  let duplicated = false;
  for (const m of ordered) {
    out.push(m);
    const gn = m.groupName ?? "";
    if (
      !duplicated &&
      isHalfAndHalfRightGroup(gn) &&
      !isHalfAndHalfExtrasGroup(gn) &&
      !isHalfAndHalfRemoveGroup(gn)
    ) {
      for (const row of shared) out.push({ ...row });
      duplicated = true;
    }
  }
  return out;
}

export function displayModifierGroupLabel(
  itemName: string | undefined,
  groupName: string | undefined,
  opts?: { mirroredSauces?: boolean }
): string | undefined {
  if (!groupName?.trim()) return undefined;
  if (itemName && isHalfAndHalfWizardItem(itemName)) {
    const role = normRole(groupName);
    if (opts?.mirroredSauces && role === "pizza sauce") return "Sauce";
    if (opts?.mirroredSauces && role === "pizza sauce 2") return undefined;
    return kitchenHalfAndHalfGroupLabel(groupName);
  }
  if (itemName && isConsolidatedPizzaItem(itemName)) return tillPizzaModGroupLabel(groupName);
  return groupName.trim();
}