import {
  HALF_AND_HALF_CYO_ITEM,
  HALF_AND_HALF_PRESET_ITEM,
  halfAndHalfModifierDisplayRank,
  prepareHalfAndHalfLineModifiers,
} from "../dist/pizzaHalfAndHalfWizard.js";
import { receiptModifierLines as linesFromReceipt } from "../dist/receipt.js";

function roleIndex(ordered, predicate) {
  return ordered.findIndex((m) => predicate(m.groupName ?? ""));
}

const cyoMods = [
  { name: '12"', groupName: "Size" },
  { name: "Classic", groupName: "Pizza Base" },
  { name: "Tomato", groupName: '12" Pizza Sauce' },
  { name: "Pepperoni", groupName: '12" Left CYO Half & Half' },
  { name: "Jalapeño", groupName: '12" Left Half & Half Extras' },
  { name: "BBQ", groupName: '12" Pizza Sauce 2' },
  { name: "Ham", groupName: '12" Right CYO Half & Half' },
  { name: "Olives", groupName: '12" Right Half & Half Extras' },
];

const presetMods = [
  { name: '12"', groupName: "Size" },
  { name: "Classic", groupName: "Pizza Base" },
  { name: "Tomato", groupName: '12" Pizza Sauce' },
  { name: "Hawaiian", groupName: '12" Left Half & Half' },
  { name: "Extra cheese", groupName: '12" Left Half & Half Extras' },
  { name: "Garlic", groupName: '12" Pizza Sauce 2' },
  { name: "Pepperoni", groupName: '12" Right Half & Half Pizza' },
  { name: "Mushroom", groupName: '12" Right Half & Half Extras' },
];

for (const [item, mods] of [
  [HALF_AND_HALF_CYO_ITEM, cyoMods],
  [HALF_AND_HALF_PRESET_ITEM, presetMods],
]) {
  const { mods: ordered } = prepareHalfAndHalfLineModifiers(item, mods);
  const iSize = roleIndex(ordered, (g) => /^size$/i.test(g.replace(/^.*"\s*/, "").trim()) || g === "Size");
  const iBase = roleIndex(ordered, (g) => /pizza base/i.test(g));
  const iSauceL = roleIndex(ordered, (g) => /pizza sauce$/i.test(g.replace(/^.*"\s*/, "")) || norm(g) === "pizza sauce");
  const iLeftHalf = roleIndex(ordered, (g) => /left/i.test(g) && /half/i.test(g) && !/extra/i.test(g) && !/sauce/i.test(g));
  const iLeftExtras = roleIndex(ordered, (g) => /left/i.test(g) && /extra/i.test(g));
  const iSauceR = roleIndex(ordered, (g) => /pizza sauce 2/i.test(g));
  const iLeftRemoves = roleIndex(ordered, (g) => /remove/i.test(g));
  const iRightHalf = roleIndex(ordered, (g) => /right/i.test(g) && /half/i.test(g) && !/extra/i.test(g) && !/sauce/i.test(g));
  const iRightExtras = roleIndex(ordered, (g) => /right/i.test(g) && /extra/i.test(g));

  const chain = [iSize, iBase, iSauceL, iLeftHalf, iLeftExtras, iSauceR, iRightHalf, iRightExtras];
  for (let i = 1; i < chain.length; i++) {
    if (chain[i] === -1 || chain[i - 1] === -1) continue;
    if (chain[i] <= chain[i - 1]) {
      console.error("FAIL: half-and-half line order", item, {
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

const { mods: ordered } = prepareHalfAndHalfLineModifiers(HALF_AND_HALF_CYO_ITEM, cyoMods);
const groups = ordered.map((m) => m.groupName);
const rightIdx = groups.findIndex((g) => /right/i.test(g ?? "") && /half/i.test(g ?? "") && !/extra/i.test(g));
const leftIdx = groups.findIndex((g) => /left/i.test(g ?? "") && /half/i.test(g ?? "") && !/extra/i.test(g) && !/sauce/i.test(g));
if (leftIdx === -1 || rightIdx === -1 || leftIdx >= rightIdx) {
  console.error("FAIL: LEFT half toppings before RIGHT", { groups, leftIdx, rightIdx });
  process.exit(1);
}

const text = linesFromReceipt(cyoMods, HALF_AND_HALF_CYO_ITEM).join("\n");
const leftHalfPos = text.indexOf("LEFT");
const rightHalfPos = text.indexOf("RIGHT");
if (leftHalfPos === -1 || rightHalfPos === -1 || leftHalfPos >= rightHalfPos) {
  console.error("FAIL: receipt/kitchen blocks LEFT before RIGHT", text);
  process.exit(1);
}

const sauce2AfterLeftExtras =
  halfAndHalfModifierDisplayRank('12" Pizza Sauce 2') >
  halfAndHalfModifierDisplayRank('12" Left Half & Half Extras');
if (!sauce2AfterLeftExtras) {
  console.error("FAIL: sauce right must follow left extras");
  process.exit(1);
}

if (halfAndHalfModifierDisplayRank('12" Pizza Sauce 2') <= halfAndHalfModifierDisplayRank('12" Pizza Sauce')) {
  console.error("FAIL: sauce left must rank before sauce right");
  process.exit(1);
}

console.log("ok half-and-half display order");