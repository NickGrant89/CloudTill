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
  return null;
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
  const lower = groupName.trim().toLowerCase();
  if (isHalfAndHalfLeftGroup(groupName)) return "LEFT";
  if (isHalfAndHalfRightGroup(groupName)) return "RIGHT";
  if (lower === "pizza sauce") return "Sauce (left)";
  if (lower === "pizza sauce 2") return "Sauce (right)";
  if (lower === "size") return "Size";
  if (lower === "pizza base") return "Base";
  return tillPizzaModGroupLabel(groupName);
}

/** Till UI label for a group inside the wizard (halves columns). */
export function halfAndHalfWizardGroupLabel(groupName: string): string {
  if (isHalfAndHalfRightGroup(groupName)) return "RIGHT";
  if (isHalfAndHalfLeftGroup(groupName)) return "LEFT";
  if (isHalfAndHalfSauceGroup(groupName)) return tillPizzaModGroupLabel(groupName);
  return tillPizzaModGroupLabel(groupName);
}

export function displayModifierGroupLabel(itemName: string | undefined, groupName: string | undefined): string | undefined {
  if (!groupName?.trim()) return undefined;
  if (itemName && isHalfAndHalfWizardItem(itemName)) return kitchenHalfAndHalfGroupLabel(groupName);
  if (itemName && isConsolidatedPizzaItem(itemName)) return tillPizzaModGroupLabel(groupName);
  return groupName.trim();
}