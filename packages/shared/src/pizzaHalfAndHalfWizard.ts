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

export type HalfAndHalfWizardStepId = "size" | "base" | "sauce" | "halves";

export const HALF_AND_HALF_WIZARD_STEPS: { id: HalfAndHalfWizardStepId; title: string; subtitle: string }[] = [
  { id: "size", title: "Size", subtitle: "9″, 12″ or 16″" },
  { id: "base", title: "Base", subtitle: "Pizza base" },
  { id: "sauce", title: "Sauce", subtitle: "Both halves or each side" },
  { id: "halves", title: "Halves", subtitle: "Right and left" },
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
  if (/right/i.test(groupName) && /half/i.test(groupName)) return "halves";
  if (/left/i.test(groupName) && /half/i.test(groupName)) return "halves";
  if (isHalfAndHalfExtrasGroup(groupName) || isHalfAndHalfRemoveGroup(groupName)) return "halves";
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

export function isHalfAndHalfRemoveGroup(groupName: string): boolean {
  return /remove/i.test(normRole(groupName)) && /half/i.test(groupName.toLowerCase());
}

export function isHalfAndHalfHalvesColumnGroup(groupName: string): boolean {
  if (halfAndHalfWizardStepForGroup(groupName) !== "halves") return false;
  if (isHalfAndHalfExtrasGroup(groupName) || isHalfAndHalfRemoveGroup(groupName)) return false;
  return isHalfAndHalfRightGroup(groupName) || isHalfAndHalfLeftGroup(groupName);
}

export function halfAndHalfSauceGroups<T extends { id: string; name: string }>(
  groups: T[]
): { left?: T; right?: T } {
  const left = groups.find((g) => normRole(g.name) === "pizza sauce");
  const right = groups.find((g) => normRole(g.name) === "pizza sauce 2");
  return { left, right };
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
    if (left && right) {
      const leftOk = (selected[left.id] ?? []).length >= left.minSelect;
      const rightOk = (selected[right.id] ?? []).length >= right.minSelect;
      return leftOk && rightOk;
    }
  }

  if (stepId === "halves") {
    const columnGroups = groups.filter((g) => isHalfAndHalfHalvesColumnGroup(g.name));
    const extraGroups = groups.filter(
      (g) => isHalfAndHalfExtrasGroup(g.name) || isHalfAndHalfRemoveGroup(g.name)
    );
    const required = [...columnGroups, ...extraGroups];
    return required.every((g) => (selected[g.id] ?? []).length >= g.minSelect);
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

export function halfAndHalfExtrasGroups<T extends { name: string }>(groups: T[]): T[] {
  return groups.filter(
    (g) =>
      halfAndHalfWizardStepForGroup(g.name) === "halves" &&
      (isHalfAndHalfExtrasGroup(g.name) || isHalfAndHalfRemoveGroup(g.name))
  );
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
  return halfAndHalfExtrasGroups(groups).filter((g) => halfAndHalfColumnTailSide(g.name) === side);
}

export function halfAndHalfSharedTailGroups<T extends { name: string }>(groups: T[]): T[] {
  return halfAndHalfExtrasGroups(groups).filter((g) => halfAndHalfColumnTailSide(g.name) === "shared");
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

export function displayModifierGroupLabel(itemName: string | undefined, groupName: string | undefined): string | undefined {
  if (!groupName?.trim()) return undefined;
  if (itemName && isHalfAndHalfWizardItem(itemName)) return kitchenHalfAndHalfGroupLabel(groupName);
  if (itemName && isConsolidatedPizzaItem(itemName)) return tillPizzaModGroupLabel(groupName);
  return groupName.trim();
}