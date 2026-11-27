import {
  HALF_AND_HALF_CYO_ITEM,
  HALF_AND_HALF_PRESET_ITEM,
  HALF_AND_HALF_WIZARD_STEPS,
  halfAndHalfFirstIncompleteStepIndex,
  halfAndHalfStepSatisfied,
  halfAndHalfHasExplicitSizeSelection,
  halfAndHalfTicketGroupHeading,
  prepareHalfAndHalfLineModifiers,
  groupHalfAndHalfModifierLines,
} from "../dist/pizzaHalfAndHalfWizard.js";
import { receiptModifierLines as linesFromReceipt } from "../dist/receipt.js";
import { halfAndHalfSelectedModifierPicks } from "../dist/pizzaHalfAndHalfWizard.js";
import { priceModifierPicks } from "../dist/modifierPricing.js";

function roleIndex(ordered, predicate) {
  return ordered.findIndex((m) => predicate(m.groupName ?? ""));
}

const leftRemoveKey = "g-rem";
const leftRemove = { id: leftRemoveKey, name: '9" Remove Toppings', modifiers: [{ id: "r1", name: "No Jalapeno", priceCents: 0 }] };

const presetMods = [
  { name: '9"', groupName: "Size" },
  { name: "Deep Crust", groupName: "Pizza Base" },
  { name: "No Jalapeno", groupName: 'Remove Toppings (LEFT half)' },
  { name: "Garlic Base", groupName: '9" Pizza Sauce' },
  { name: "Spicy Beef Pizza", groupName: '9" Left Half & Half' },
  { name: "Extra Tomato", groupName: "Half & Half Extras (LEFT half)" },
  { name: "Extra Chillies", groupName: "Half & Half Extras (LEFT half)" },
  { name: "BBQ", groupName: '9" Pizza Sauce 2' },
  { name: "Beef & Mushroom", groupName: '9" Right Half & Half Pizza' },
  { name: "Extra Olives", groupName: "Half & Half Extras (RIGHT half)" },
];

const cyoMods = [
  { name: '12"', groupName: "Size" },
  { name: "Classic", groupName: "Pizza Base" },
  { name: "No Cheese", groupName: 'Remove Toppings (RIGHT half)' },
  { name: "Tomato", groupName: '12" Pizza Sauce' },
  { name: "Pepperoni", groupName: '12" Left CYO Half & Half' },
  { name: "Jalapeño", groupName: "Half & Half Extras (LEFT half)" },
  { name: "BBQ", groupName: '12" Pizza Sauce 2' },
  { name: "Ham", groupName: '12" Right CYO Half & Half' },
  { name: "Olives", groupName: "Half & Half Extras (RIGHT half)" },
];

for (const [item, mods] of [
  [HALF_AND_HALF_PRESET_ITEM, presetMods],
  [HALF_AND_HALF_CYO_ITEM, cyoMods],
]) {
  const { mods: ordered } = prepareHalfAndHalfLineModifiers(item, mods);
  const iSize = roleIndex(ordered, (g) => /^size$/i.test(g.replace(/^.*"\s*/, "").trim()) || g === "Size");
  const iBase = roleIndex(ordered, (g) => /pizza base/i.test(g));
  const iLeftRem = roleIndex(ordered, (g) => /remove.*\(LEFT half\)/i.test(g));
  const iSauceL = roleIndex(ordered, (g) => /pizza sauce$/i.test(g.replace(/^.*"\s*/, "")) || norm(g) === "pizza sauce");
  const iLeftHalf = roleIndex(ordered, (g) => /left/i.test(g) && /half/i.test(g) && !/extra/i.test(g) && !/sauce/i.test(g) && !/remove/i.test(g));
  const iLeftExtras = roleIndex(ordered, (g) => /extras \(LEFT half\)/i.test(g));
  const iRightRem = roleIndex(ordered, (g) => /remove.*\(RIGHT half\)/i.test(g));
  const iSauceR = roleIndex(ordered, (g) => /pizza sauce 2/i.test(g));
  const iRightHalf = roleIndex(ordered, (g) => /right/i.test(g) && /half/i.test(g) && !/extra/i.test(g) && !/sauce/i.test(g) && !/remove/i.test(g));
  const iRightExtras = roleIndex(ordered, (g) => /extras \(RIGHT half\)/i.test(g));

  const chain = [
    iSize,
    iBase,
    iLeftRem,
    iSauceL,
    iLeftHalf,
    iLeftExtras,
    iRightRem,
    iSauceR,
    iRightHalf,
    iRightExtras,
  ];
  for (let i = 1; i < chain.length; i++) {
    if (chain[i] === -1 || chain[i - 1] === -1) continue;
    if (chain[i] <= chain[i - 1]) {
      console.error("FAIL: half-and-half ticket order", item, {
        groups: ordered.map((m) => m.groupName),
        chain,
      });
      process.exit(1);
    }
  }
}

function norm(g) {
  return g.replace(/^(\d+)\s*(?:”|")\s*/i, "").trim().toLowerCase();
}

const blocks = groupHalfAndHalfModifierLines(HALF_AND_HALF_PRESET_ITEM, presetMods, {});
const leftExtras = blocks.filter((b) => b.heading.includes("LEFT half") && b.heading.includes("Extras"));
if (leftExtras.length !== 1 || leftExtras[0].names.length !== 2) {
  console.error("FAIL: left extras must be one heading with two picks", leftExtras);
  process.exit(1);
}
const removeHeading = halfAndHalfTicketGroupHeading("Remove Toppings (LEFT half)");
if (!removeHeading.includes("Remove") || !removeHeading.includes("LEFT half")) {
  console.error("FAIL: remove heading", removeHeading);
  process.exit(1);
}

const selected = { [`${leftRemoveKey}:hh-remove-left`]: [{ id: "r1", name: "No Jalapeno" }] };
const picks = halfAndHalfSelectedModifierPicks(HALF_AND_HALF_PRESET_ITEM, [leftRemove], selected);
const priced = priceModifierPicks(HALF_AND_HALF_PRESET_ITEM, [{ ...leftRemove, freeSelect: 0 }], picks);
if (!priced[0]?.groupName?.includes("LEFT half")) {
  console.error("FAIL: till must persist LEFT half remove groupName", priced);
  process.exit(1);
}

const text = linesFromReceipt(presetMods, HALF_AND_HALF_PRESET_ITEM).join("\n");
if (!text.includes("Remove Toppings (LEFT half)")) {
  console.error("FAIL: receipt must show remove heading", text);
  process.exit(1);
}

const sizeGroup = { id: "g-size", name: "Size", minSelect: 0, modifiers: [{ id: "s9", name: '9"' }] };
const visible = [sizeGroup];
const emptySelected = {};
const need = halfAndHalfFirstIncompleteStepIndex(
  HALF_AND_HALF_WIZARD_STEPS.map((s) => s.id),
  visible,
  emptySelected,
  true
);
if (need !== 0) {
  console.error("FAIL: new wizard must start on Size (index 0), got", need);
  process.exit(1);
}

const baseSatisfiedWithoutSize = halfAndHalfStepSatisfied({
  stepId: "base",
  visibleGroups: visible,
  selected: emptySelected,
  sauceLinked: true,
});
if (baseSatisfiedWithoutSize) {
  console.error("FAIL: base step must not be satisfied before size pick");
  process.exit(1);
}
if (halfAndHalfHasExplicitSizeSelection(visible, emptySelected)) {
  console.error("FAIL: empty state must not count as size selected");
  process.exit(1);
}

console.log("ok half-and-half display order");