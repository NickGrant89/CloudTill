import {
  halfAndHalfModifierDisplayRank,
  prepareHalfAndHalfLineModifiers,
  HALF_AND_HALF_CYO_ITEM,
} from "../dist/pizzaHalfAndHalfWizard.js";
import { receiptModifierLines as linesFromReceipt } from "../dist/receipt.js";

const item = HALF_AND_HALF_CYO_ITEM;
const mods = [
  { name: "Pepperoni", groupName: '12" Right CYO Half & Half' },
  { name: "Mushroom", groupName: '12" Left CYO Half & Half' },
  { name: "12\"", groupName: "Size" },
  { name: "Tomato", groupName: '12" Pizza Sauce 2' },
  { name: "Tomato", groupName: '12" Pizza Sauce' },
  { name: "Classic", groupName: "Pizza Base" },
];

const { mods: ordered } = prepareHalfAndHalfLineModifiers(item, mods);
const groups = ordered.map((m) => m.groupName);
const rightIdx = groups.findIndex((g) => /right/i.test(g ?? "") && /half/i.test(g ?? ""));
const leftIdx = groups.findIndex((g) => /left/i.test(g ?? "") && /half/i.test(g ?? "") && !/sauce/i.test(g ?? ""));
if (leftIdx === -1 || rightIdx === -1 || leftIdx >= rightIdx) {
  console.error("FAIL: LEFT must appear before RIGHT half toppings", { groups, leftIdx, rightIdx });
  process.exit(1);
}

const text = linesFromReceipt(mods, item).join("\n");
if (/RIGHT/.test(text) && /LEFT/.test(text)) {
  const rightPos = text.indexOf("RIGHT");
  const leftPos = text.indexOf("LEFT");
  if (rightPos < leftPos) {
    console.error("FAIL: receipt shows RIGHT before LEFT", text);
    process.exit(1);
  }
}

if (halfAndHalfModifierDisplayRank('12" Pizza Sauce 2') <= halfAndHalfModifierDisplayRank('12" Pizza Sauce')) {
  console.error("FAIL: sauce left must rank before sauce right");
  process.exit(1);
}

console.log("ok half-and-half display order");