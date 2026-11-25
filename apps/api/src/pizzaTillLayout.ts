/** Consolidated pizza till modifier tab order (G&A / Loyverse parity). */

export type TillLayoutRule = {
  order: string[];
  drop: (name: string) => boolean;
  freeSelect?: Record<string, number>;
};

export const PIZZA_CONSOLIDATED_ITEM_NAMES = [
  "Pizza — Single",
  "Pizza — Half & half",
  "Pizza — Create your own",
  "Pizza — Half & half (CYO)",
] as const;

export const TILL_LAYOUT: Record<string, TillLayoutRule> = {
  "Pizza — Half & half (CYO)": {
    order: ["Size", "Pizza Base", "Pizza Sauce", "Pizza Sauce 2", "Right CYO Half & Half", "Left CYO Half & Half"],
    drop: (name) => /extras/i.test(name) || /extra toppings/i.test(name) || /remove/i.test(name),
    freeSelect: { "Right CYO Half & Half": 4, "Left CYO Half & Half": 4 },
  },
  "Pizza — Create your own": {
    order: ["Size", "Pizza Base", "Pizza Sauce", "Create Your Own (4 x Free Toppings)"],
    drop: (name) => /extra toppings/i.test(name),
    freeSelect: { "Create Your Own (4 x Free Toppings)": 4 },
  },
  "Pizza — Single": {
    order: ["Size", "Pizza Base", "Pizza Sauce", "Pizza Options", "Remove Toppings"],
    drop: (name) => /extra toppings/i.test(name),
  },
  "Pizza — Half & half": {
    order: ["Size", "Pizza Base", "Pizza Sauce", "Right Half & Half Pizza", "Pizza Sauce 2", "Left Half & Half"],
    drop: (name) => {
      const n = name.toLowerCase();
      if (n.includes("extra toppings") && !n.includes("half")) return true;
      return false;
    },
  },
};

/** Back-office modifier library menu order for pizza-related sets. */
export const PIZZA_MODIFIER_MENU_ORDER = [
  "Size",
  "Pizza Base",
  "Pizza Sauce",
  "Pizza Options",
  "Right Half & Half Pizza",
  "Pizza Sauce 2",
  "Left Half & Half",
  "Right CYO Half & Half",
  "Left CYO Half & Half",
  "Create Your Own (4 x Free Toppings)",
  "Remove Toppings",
  "Remove Topping 2",
] as const;

function inchSizeInName(name: string): number | null {
  const match = name.match(/(\d+)\s*(?:”|")/);
  if (!match) return null;
  const n = Number(match[1]);
  return n === 9 || n === 12 || n === 16 ? n : null;
}

function normalizeModifierRole(name: string): string {
  return name
    .replace(/^(\d+)\s*(?:”|")\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function pizzaGroupSortRank(groupName: string, order: string[]): number {
  if (groupName.trim().toLowerCase() === "size") return -1;
  const lower = groupName.toLowerCase();
  const role = normalizeModifierRole(groupName);
  for (let i = 0; i < order.length; i++) {
    const key = order[i]!.toLowerCase();
    if (lower === key || role === key) return i;
  }
  if (/half & half extras/i.test(groupName)) {
    const inch = inchSizeInName(groupName) ?? 99;
    const side = /left/i.test(groupName) ? 0.25 : 0.05;
    return 15 + inch / 1000 + side;
  }
  if (/remove topping/i.test(groupName)) return 35;
  if (/extra toppings/i.test(groupName)) return 30;
  return 100;
}

export function comparePizzaModifierGroups(itemName: string, aName: string, bName: string): number {
  const rule = TILL_LAYOUT[itemName];
  if (!rule) return aName.localeCompare(bName, undefined, { sensitivity: "base" });
  const ra = pizzaGroupSortRank(aName, rule.order);
  const rb = pizzaGroupSortRank(bName, rule.order);
  if (ra !== rb) return ra - rb;
  const ia = inchSizeInName(aName) ?? 0;
  const ib = inchSizeInName(bName) ?? 0;
  if (ia !== ib) return ia - ib;
  return aName.localeCompare(bName, undefined, { sensitivity: "base" });
}

export function pizzaItemGroupSortRank(itemName: string, groupName: string): number {
  const rule = TILL_LAYOUT[itemName];
  if (!rule) return 10_000;
  return pizzaGroupSortRank(groupName, rule.order);
}