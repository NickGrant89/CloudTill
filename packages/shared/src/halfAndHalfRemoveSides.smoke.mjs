import {
  halfAndHalfRemoveSelectionKey,
  halfAndHalfSelectedModifierPicks,
  normalizeHalfAndHalfRemoveSelectionState,
  pickerStateFromLineModifiers,
  preserveHalfAndHalfTicketGroupName,
  HALF_AND_HALF_PRESET_ITEM,
} from "../dist/pizzaHalfAndHalfWizard.js";
import { priceModifierPicks } from "../dist/modifierPricing.js";

const group = { id: "grp-remove", name: '12" Remove Toppings' };
const mod = { id: "mod-pepperoni", name: "No Pepperoni" };

const legacy = {
  [group.id]: [mod],
};
const normalized = normalizeHalfAndHalfRemoveSelectionState(HALF_AND_HALF_PRESET_ITEM, [group], legacy);
const leftKey = halfAndHalfRemoveSelectionKey(group.id, "left");
const rightKey = halfAndHalfRemoveSelectionKey(group.id, "right");
if (normalized[group.id]?.length) {
  console.error("FAIL: legacy group.id must be cleared");
  process.exit(1);
}
if (normalized[leftKey]?.length !== 1 || normalized[rightKey]?.length) {
  console.error("FAIL: legacy picks should migrate to left side key only", normalized);
  process.exit(1);
}

const onlyLeft = {
  [leftKey]: [mod],
};
const picks = halfAndHalfSelectedModifierPicks(HALF_AND_HALF_PRESET_ITEM, [group], onlyLeft);
if (picks.length !== 1 || !picks[0].groupName.includes("LEFT half")) {
  console.error("FAIL: expect one LEFT-half ticket row", picks);
  process.exit(1);
}

const bothSides = {
  [leftKey]: [mod],
  [rightKey]: [{ id: "mod-ham", name: "No Ham" }],
};
const picks2 = halfAndHalfSelectedModifierPicks(HALF_AND_HALF_PRESET_ITEM, [group], bothSides);
if (picks2.length !== 2) {
  console.error("FAIL: expect independent left and right rows", picks2);
  process.exit(1);
}
if (!picks2.some((p) => p.groupName.includes("LEFT")) || !picks2.some((p) => p.groupName.includes("RIGHT"))) {
  console.error("FAIL: ticket group names must encode side", picks2);
  process.exit(1);
}

const pricedGroup = {
  id: group.id,
  name: group.name,
  freeSelect: 0,
  modifiers: [mod, { id: "mod-ham", name: "No Ham", priceCents: 0 }],
};
const priced = priceModifierPicks(HALF_AND_HALF_PRESET_ITEM, [pricedGroup], picks);
if (!priced[0]?.groupName?.includes("LEFT half")) {
  console.error("FAIL: priced ticket row must keep LEFT half groupName", priced);
  process.exit(1);
}

const hydrated = pickerStateFromLineModifiers(
  HALF_AND_HALF_PRESET_ITEM,
  [pricedGroup],
  [
    { name: mod.name, modifierId: mod.id, groupName: picks[0].groupName },
    { name: "12\"", groupName: "Size", modifierId: "sz" },
  ]
);
if ((hydrated[leftKey] ?? []).length !== 1) {
  console.error("FAIL: edit hydrate must restore left remove", hydrated);
  process.exit(1);
}

const kept = preserveHalfAndHalfTicketGroupName("Remove Toppings (LEFT half)", "Remove Toppings");
if (kept !== "Remove Toppings (LEFT half)") {
  console.error("FAIL: persist must keep LEFT half tag over catalog name", kept);
  process.exit(1);
}
const catalogFallback = preserveHalfAndHalfTicketGroupName(undefined, "Remove Toppings");
if (catalogFallback !== "Remove Toppings") {
  console.error("FAIL: catalog name used when no ticket side tag", catalogFallback);
  process.exit(1);
}

console.log("ok half-and-half remove sides");