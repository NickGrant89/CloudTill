import { isConsolidatedPizzaItem, modifierGroupInchSize, tillPizzaModGroupLabel } from "./pizzaTill.js";

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
  return groupName
    .replace(/\s*\((LEFT|RIGHT) half\)\s*$/i, "")
    .replace(/^(\d+)\s*(?:”|")\s*/i, "")
    .trim();
}

/** Side encoded on ticket lines for shared remove menus. */
export function halfAndHalfRemoveTicketSideFromGroupName(groupName: string): "left" | "right" | null {
  if (!isPizzaRemoveToppingGroup(halfAndHalfRemoveCatalogGroupName(groupName))) return null;
  if (/\(LEFT half\)\s*$/i.test(groupName.trim())) return "left";
  if (/\(RIGHT half\)\s*$/i.test(groupName.trim())) return "right";
  return null;
}

export function halfAndHalfRemoveTicketGroupName(catalogGroupName: string, side: "left" | "right"): string {
  const tail = halfAndHalfColumnTailSide(catalogGroupName);
  const stripped = catalogGroupName.replace(/^(\d+)\s*(?:”|")\s*/i, "").trim();
  if (tail === "left" || tail === "right") return catalogGroupName;
  return `${stripped} (${side === "left" ? "LEFT" : "RIGHT"} half)`;
}

export const HALF_AND_HALF_EXTRAS_TICKET_LABEL = "Half & Half Extras";

export function halfAndHalfExtrasTicketSideFromGroupName(groupName: string): "left" | "right" | null {
  const trimmed = groupName.trim();
  const ticket = trimmed.startsWith(HALF_AND_HALF_EXTRAS_TICKET_LABEL);
  if (!ticket && !isHalfAndHalfExtrasGroup(trimmed)) return null;
  if (/\(LEFT half\)\s*$/i.test(trimmed)) return "left";
  if (/\(RIGHT half\)\s*$/i.test(trimmed)) return "right";
  return null;
}

export function halfAndHalfExtrasTicketGroupName(_catalogGroupName: string, side: "left" | "right"): string {
  return `${HALF_AND_HALF_EXTRAS_TICKET_LABEL} (${side === "left" ? "LEFT" : "RIGHT"} half)`;
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

/** Till picker must not use catalog group.id for removes — migrate legacy rows into left-only side keys. */
export function normalizeHalfAndHalfRemoveSelectionState<T>(
  itemName: string,
  groups: { id: string; name: string }[],
  selected: Record<string, T[] | undefined>
): Record<string, T[] | undefined> {
  if (!isHalfAndHalfWizardItem(itemName)) return selected;
  let next: Record<string, T[] | undefined> | null = null;
  const touch = (): Record<string, T[] | undefined> => {
    if (!next) next = { ...selected };
    return next;
  };
  for (const group of groups) {
    if (!isHalfAndHalfRemoveGroup(group.name)) continue;
    const legacy = selected[group.id];
    if (!legacy?.length) {
      if (group.id in selected) {
        touch();
        delete next![group.id];
      }
      continue;
    }
    const out = touch();
    const leftKey = halfAndHalfRemoveSelectionKey(group.id, "left");
    if (!(out[leftKey]?.length)) out[leftKey] = [...legacy];
    delete out[group.id];
  }
  return next ?? selected;
}

export function isHalfAndHalfRemoveGroup(groupName: string): boolean {
  return isPizzaRemoveToppingGroup(halfAndHalfRemoveCatalogGroupName(groupName));
}

/** Match a persisted ticket modifier row to a catalog modifier group. */
export function catalogGroupNameMatchesLineModifier(
  itemName: string,
  catalogGroupName: string,
  lineGroupName: string
): boolean {
  const line = lineGroupName.trim();
  const catalog = catalogGroupName.trim();
  if (line.toLowerCase() === catalog.toLowerCase()) return true;
  if (isHalfAndHalfWizardItem(itemName) && isHalfAndHalfRemoveGroup(line)) {
    return (
      halfAndHalfRemoveCatalogGroupName(line).toLowerCase() ===
      halfAndHalfRemoveCatalogGroupName(catalog).toLowerCase()
    );
  }
  const extrasTicketSide = halfAndHalfExtrasTicketSideFromGroupName(line);
  if (isHalfAndHalfWizardItem(itemName) && extrasTicketSide && isHalfAndHalfExtrasGroup(catalog)) {
    return halfAndHalfColumnTailSide(catalog) === extrasTicketSide;
  }
  if (normRole(line) !== normRole(catalog)) return false;
  const lineInch = modifierGroupInchSize(line);
  const catalogInch = modifierGroupInchSize(catalog);
  if (lineInch === null && catalogInch === null) return true;
  return lineInch === catalogInch;
}

/** Rebuild till picker state from ticket line modifiers (edit flow). */
export function pickerStateFromLineModifiers<
  G extends { id: string; name: string; modifiers: { id: string; name: string }[] }
>(
  itemName: string,
  groups: G[],
  lineMods: { groupName?: string; name: string; modifierId?: string }[]
): Record<string, G["modifiers"][number][]> {
  const initial: Record<string, G["modifiers"][number][]> = {};
  for (const group of groups) {
    if (isHalfAndHalfWizardItem(itemName) && isHalfAndHalfRemoveGroup(group.name)) {
      initial[halfAndHalfRemoveSelectionKey(group.id, "left")] = [];
      initial[halfAndHalfRemoveSelectionKey(group.id, "right")] = [];
    }
  }

  for (const picked of lineMods) {
    const gn = picked.groupName?.trim();
    if (!gn) continue;

    const extrasTicketSide = halfAndHalfExtrasTicketSideFromGroupName(gn);
    if (isHalfAndHalfWizardItem(itemName) && extrasTicketSide) {
      const candidates = groups.filter(
        (g) => isHalfAndHalfExtrasGroup(g.name) && halfAndHalfColumnTailSide(g.name) === extrasTicketSide
      );
      let placed = false;
      for (const group of candidates) {
        const option = group.modifiers.find(
          (m) => (picked.modifierId && m.id === picked.modifierId) || m.name === picked.name
        );
        if (!option) continue;
        const list = initial[group.id] ?? [];
        if (!list.some((m) => m.id === option.id)) list.push(option);
        initial[group.id] = list;
        placed = true;
      }
      if (placed) continue;
    }

    if (isHalfAndHalfWizardItem(itemName) && isHalfAndHalfRemoveGroup(gn)) {
      const catalog = halfAndHalfRemoveCatalogGroupName(gn);
      const group = groups.find(
        (g) => isHalfAndHalfRemoveGroup(g.name) && catalogGroupNameMatchesLineModifier(itemName, g.name, gn)
      );
      if (!group) continue;
      const option = group.modifiers.find(
        (m) => (picked.modifierId && m.id === picked.modifierId) || m.name === picked.name
      );
      if (!option) continue;
      let side = halfAndHalfRemoveTicketSideFromGroupName(gn);
      if (!side) {
        const tail = halfAndHalfColumnTailSide(catalog);
        side = tail === "right" ? "right" : "left";
      }
      const key = halfAndHalfRemoveSelectionKey(group.id, side);
      const list = initial[key] ?? [];
      if (!list.some((m) => m.id === option.id)) list.push(option);
      initial[key] = list;
      continue;
    }

    const group = groups.find((g) => catalogGroupNameMatchesLineModifier(itemName, g.name, gn));
    if (!group) continue;
    const option = group.modifiers.find(
      (m) => (picked.modifierId && m.id === picked.modifierId) || m.name === picked.name
    );
    if (!option) continue;
    const list = initial[group.id] ?? [];
    if (!list.some((m) => m.id === option.id)) list.push(option);
    initial[group.id] = list;
  }

  if (isHalfAndHalfWizardItem(itemName)) {
    return normalizeHalfAndHalfRemoveSelectionState(itemName, groups, initial) as Record<
      string,
      G["modifiers"][number][]
    >;
  }
  return initial;
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

function halfAndHalfWizardMinPicks(group: { minSelect: number }, stepId: HalfAndHalfWizardStepId): number {
  if (stepId === "size") return Math.max(1, group.minSelect);
  return Math.max(0, group.minSelect);
}

export function halfAndHalfStepSatisfied(check: HalfAndHalfStepCheck): boolean {
  const { stepId, visibleGroups, selected, sauceLinked } = check;
  const groups = visibleGroups.filter((g) => halfAndHalfWizardStepForGroup(g.name) === stepId);
  if (!groups.length) return stepId !== "size";

  if (stepId === "size") {
    return groups.every((g) => (selected[g.id] ?? []).length >= halfAndHalfWizardMinPicks(g, stepId));
  }

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

  if (stepId === "options") {
    return groups.every((g) => {
      if (isHalfAndHalfRemoveGroup(g.name)) {
        const picked = [
          ...(selected[halfAndHalfRemoveSelectionKey(g.id, "left")] ?? []),
          ...(selected[halfAndHalfRemoveSelectionKey(g.id, "right")] ?? []),
        ];
        return picked.length >= g.minSelect;
      }
      return (selected[g.id] ?? []).length >= g.minSelect;
    });
  }

  return groups.every((g) => (selected[g.id] ?? []).length >= halfAndHalfWizardMinPicks(g, stepId));
}

/** Wizard tab index for the first step the user still needs to complete. */
export function halfAndHalfFirstIncompleteStepIndex(
  steps: HalfAndHalfWizardStepId[],
  visibleGroups: { id: string; name: string; minSelect: number }[],
  selected: Record<string, { length: number }[] | undefined>,
  sauceLinked: boolean
): number {
  for (let i = 0; i < steps.length; i++) {
    const stepId = steps[i]!;
    if (
      !halfAndHalfStepSatisfied({
        stepId,
        visibleGroups,
        selected,
        sauceLinked,
      })
    ) {
      return i;
    }
  }
  return Math.max(0, steps.length - 1);
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
): { modifierId: string; name: string; groupId?: string; groupName: string }[] {
  const rows: { modifierId: string; name: string; groupId?: string; groupName: string }[] = [];
  for (const group of groups) {
    if (isHalfAndHalfWizardItem(itemName) && isHalfAndHalfRemoveGroup(group.name)) {
      for (const side of ["left", "right"] as const) {
        const key = halfAndHalfRemoveSelectionKey(group.id, side);
        for (const option of selected[key] ?? []) {
          rows.push({
            modifierId: option.id,
            name: option.name,
            groupName: halfAndHalfRemoveTicketGroupName(group.name, side),
          });
        }
      }
      continue;
    }
    for (const option of selected[group.id] ?? []) {
      let ticketGroupName = group.name;
      if (isHalfAndHalfExtrasGroup(group.name)) {
        const side = halfAndHalfColumnTailSide(group.name);
        if (side === "left" || side === "right") {
          ticketGroupName = halfAndHalfExtrasTicketGroupName(group.name, side);
        }
      }
      rows.push({
        modifierId: option.id,
        name: option.name,
        groupId: isHalfAndHalfExtrasGroup(group.name) ? undefined : group.id,
        groupName: ticketGroupName,
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

type HalfAndHalfTicketBlock = "shared" | "left" | "right";
type HalfAndHalfTicketKind = "size" | "base" | "remove" | "sauce" | "half" | "extras" | "other";

function halfAndHalfTicketBlockAndKind(groupName: string): {
  block: HalfAndHalfTicketBlock;
  kind: HalfAndHalfTicketKind;
} {
  const gn = groupName.trim();
  if (!gn) return { block: "shared", kind: "other" };
  const role = normRole(gn);
  if (role === "size") return { block: "shared", kind: "size" };
  if (role === "pizza base") return { block: "shared", kind: "base" };

  const removeSide = halfAndHalfRemoveTicketSideFromGroupName(gn);
  if (removeSide) return { block: removeSide, kind: "remove" };
  if (isHalfAndHalfRemoveGroup(gn)) {
    const side = halfAndHalfColumnTailSide(halfAndHalfRemoveCatalogGroupName(gn));
    return { block: side === "right" ? "right" : "left", kind: "remove" };
  }

  const extrasSide = halfAndHalfExtrasTicketSideFromGroupName(gn);
  if (extrasSide) return { block: extrasSide, kind: "extras" };
  if (isHalfAndHalfExtrasGroup(gn)) {
    const side = halfAndHalfColumnTailSide(gn);
    return { block: side === "right" ? "right" : side === "left" ? "left" : "shared", kind: "extras" };
  }

  if (role === "pizza sauce") return { block: "left", kind: "sauce" };
  if (role === "pizza sauce 2") return { block: "right", kind: "sauce" };
  if (isHalfAndHalfLeftGroup(gn)) return { block: "left", kind: "half" };
  if (isHalfAndHalfRightGroup(gn)) return { block: "right", kind: "half" };
  return { block: "shared", kind: "other" };
}

const HALF_TICKET_BLOCK_RANK: Record<HalfAndHalfTicketBlock, number> = { shared: 0, left: 1, right: 2 };
const HALF_TICKET_KIND_RANK: Record<HalfAndHalfTicketKind, number> = {
  size: 0,
  base: 1,
  remove: 2,
  sauce: 3,
  half: 4,
  extras: 5,
  other: 9,
};

/**
 * Size, base, then full left half (removes → sauce → half → extras), then full right half.
 */
export function halfAndHalfModifierDisplayRank(groupName: string): number {
  const { block, kind } = halfAndHalfTicketBlockAndKind(groupName);
  return HALF_TICKET_BLOCK_RANK[block] * 100 + HALF_TICKET_KIND_RANK[kind] * 10;
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
  return { mods: ordered, mirroredSauces };
}

/** Ticket / kitchen heading for one modifier group row on half-and-half. */
export function halfAndHalfTicketGroupHeading(
  groupName: string,
  opts?: { mirroredSauces?: boolean }
): string {
  const gn = groupName.trim();
  const removeSide = halfAndHalfRemoveTicketSideFromGroupName(gn);
  if (removeSide || isHalfAndHalfRemoveGroup(gn)) {
    const catalog = halfAndHalfRemoveCatalogGroupName(gn);
    const stripped = catalog.replace(/^(\d+)\s*(?:”|")\s*/i, "").trim();
    const side =
      removeSide ?? (halfAndHalfColumnTailSide(catalog) === "right" ? "right" : "left");
    return `${stripped} (${side === "left" ? "LEFT" : "RIGHT"} half)`;
  }
  const extrasSide = halfAndHalfExtrasTicketSideFromGroupName(gn);
  if (extrasSide) return gn;
  if (isHalfAndHalfExtrasGroup(gn)) {
    const side = halfAndHalfColumnTailSide(gn);
    if (side === "left" || side === "right") return halfAndHalfExtrasTicketGroupName(gn, side);
  }
  const role = normRole(gn);
  if (opts?.mirroredSauces && role === "pizza sauce") return "Sauce (LEFT half)";
  if (role === "size") return "Size";
  if (role === "pizza base") return "Base";
  if (role === "pizza sauce") return "Sauce (LEFT half)";
  if (role === "pizza sauce 2") return "Sauce (RIGHT half)";
  if (isHalfAndHalfLeftGroup(gn) && !isHalfAndHalfExtrasGroup(gn)) return "Left half";
  if (isHalfAndHalfRightGroup(gn) && !isHalfAndHalfExtrasGroup(gn)) return "Right half";
  return tillPizzaModGroupLabel(gn);
}

export type HalfAndHalfModifierBlock = { groupName?: string; heading: string; names: string[] };

export function groupHalfAndHalfModifierLines(
  itemName: string,
  mods: { name?: string; groupName?: string }[],
  opts?: { mirroredSauces?: boolean }
): HalfAndHalfModifierBlock[] {
  const { mods: ordered } = prepareHalfAndHalfLineModifiers(itemName, mods);
  const blocks: HalfAndHalfModifierBlock[] = [];
  for (const mod of ordered) {
    const name = mod.name?.trim();
    if (!name) continue;
    const rawGroup = mod.groupName?.trim() || undefined;
    const heading = rawGroup ? halfAndHalfTicketGroupHeading(rawGroup, opts) : "";
    const last = blocks[blocks.length - 1];
    if (last && last.heading === heading) last.names.push(name);
    else blocks.push({ groupName: rawGroup, heading, names: [name] });
  }
  return blocks;
}

export function displayModifierGroupLabel(
  itemName: string | undefined,
  groupName: string | undefined,
  opts?: { mirroredSauces?: boolean }
): string | undefined {
  if (!groupName?.trim()) return undefined;
  if (itemName && isHalfAndHalfWizardItem(itemName)) {
    if (opts?.mirroredSauces && normRole(groupName) === "pizza sauce 2") return undefined;
    return halfAndHalfTicketGroupHeading(groupName, opts);
  }
  if (itemName && isConsolidatedPizzaItem(itemName)) return tillPizzaModGroupLabel(groupName);
  return groupName.trim();
}