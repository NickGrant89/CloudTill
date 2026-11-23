import { prisma } from "./db.js";

const SIZES = [
  { name: "Small", priceCents: 0 },
  { name: "Medium", priceCents: 150 },
  { name: "Large", priceCents: 300 },
];

const SAUCES = [
  { name: "Tomato", priceCents: 0 },
  { name: "BBQ", priceCents: 0 },
  { name: "Garlic white", priceCents: 50 },
];

const NAMED = [
  { name: "Margherita", priceCents: 0 },
  { name: "Pepperoni", priceCents: 0 },
  { name: "Hawaiian", priceCents: 0 },
  { name: "Veggie", priceCents: 0 },
  { name: "BBQ chicken", priceCents: 100 },
  { name: "Meat feast", priceCents: 150 },
];

const TOPPINGS = [
  { name: "Pepperoni", priceCents: 100 },
  { name: "Mushrooms", priceCents: 80 },
  { name: "Onion", priceCents: 60 },
  { name: "Peppers", priceCents: 80 },
  { name: "Olives", priceCents: 80 },
  { name: "Extra cheese", priceCents: 100 },
  { name: "Ham", priceCents: 100 },
  { name: "Pineapple", priceCents: 80 },
  { name: "Chicken", priceCents: 120 },
  { name: "Jalapeños", priceCents: 80 },
];

type Option = { name: string; priceCents: number };

async function ensureCategory(storeId: string) {
  const cats = await prisma.category.findMany({ where: { storeId } });
  const existing = cats.find((cat) => cat.name.toLowerCase() === "pizza");
  if (existing) return existing;
  return prisma.category.create({
    data: { storeId, name: "Pizza", color: "#C45C26", sortOrder: cats.length },
  });
}

async function createItemWithGroups(
  storeId: string,
  categoryId: string,
  item: { name: string; priceCents: number; sku: string; color: string },
  groups: { name: string; minSelect: number; maxSelect: number; options: Option[] }[]
) {
  const items = await prisma.item.findMany({ where: { storeId, active: true }, select: { id: true, name: true } });
  const already = items.find((row) => row.name.toLowerCase() === item.name.toLowerCase());
  if (already) return { item: already, created: false };

  const created = await prisma.item.create({
    data: {
      storeId,
      categoryId,
      name: item.name,
      color: item.color,
      variants: {
        create: {
          name: "Regular",
          sku: item.sku,
          priceCents: item.priceCents,
          trackStock: false,
        },
      },
    },
    include: { variants: true },
  });

  for (const [index, group] of groups.entries()) {
    await prisma.modifierGroup.create({
      data: {
        itemId: created.id,
        name: group.name,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        sortOrder: index,
        modifiers: {
          create: group.options.map((option, optionIndex) => ({
            name: option.name,
            priceCents: option.priceCents,
            sortOrder: optionIndex,
          })),
        },
      },
    });
  }

  return { item: created, created: true };
}

/** Creates a Pizza group and the five till buttons Nick asked for, with shared-style options. */
export async function ensurePizzaMenu(storeId: string) {
  const category = await ensureCategory(storeId);
  const stamp = Date.now().toString(36).slice(-4);
  const results = [];

  results.push(
    await createItemWithGroups(
      storeId,
      category.id,
      { name: "Create your own", priceCents: 1199, sku: `PIZ-CYO-${stamp}`, color: "#C45C26" },
      [
        { name: "Size", minSelect: 1, maxSelect: 1, options: SIZES },
        { name: "Sauce", minSelect: 1, maxSelect: 1, options: SAUCES },
        { name: "Toppings", minSelect: 0, maxSelect: TOPPINGS.length, options: TOPPINGS },
      ]
    )
  );

  results.push(
    await createItemWithGroups(
      storeId,
      category.id,
      { name: "Single pizza", priceCents: 1099, sku: `PIZ-SGL-${stamp}`, color: "#B45309" },
      [
        { name: "Size", minSelect: 1, maxSelect: 1, options: SIZES },
        { name: "Pizza", minSelect: 1, maxSelect: 1, options: NAMED },
      ]
    )
  );

  results.push(
    await createItemWithGroups(
      storeId,
      category.id,
      { name: "Half and half", priceCents: 1299, sku: `PIZ-HH-${stamp}`, color: "#9A3412" },
      [
        { name: "Size", minSelect: 1, maxSelect: 1, options: SIZES },
        { name: "Left half", minSelect: 1, maxSelect: 1, options: NAMED },
        { name: "Right half", minSelect: 1, maxSelect: 1, options: NAMED },
      ]
    )
  );

  results.push(
    await createItemWithGroups(
      storeId,
      category.id,
      { name: "Half and half pizza option", priceCents: 1299, sku: `PIZ-HHO-${stamp}`, color: "#7C2D12" },
      [
        { name: "Size", minSelect: 1, maxSelect: 1, options: SIZES },
        { name: "Left half", minSelect: 1, maxSelect: 1, options: NAMED },
        { name: "Right half", minSelect: 1, maxSelect: 1, options: NAMED },
        { name: "Extra options", minSelect: 0, maxSelect: 3, options: [
          { name: "Stuffed crust", priceCents: 200 },
          { name: "Gluten-free base", priceCents: 150 },
          { name: "Extra cheese on both", priceCents: 150 },
        ] },
      ]
    )
  );

  results.push(
    await createItemWithGroups(
      storeId,
      category.id,
      { name: "Half and half create your own", priceCents: 1399, sku: `PIZ-HHC-${stamp}`, color: "#9F1239" },
      [
        { name: "Size", minSelect: 1, maxSelect: 1, options: SIZES },
        { name: "Left sauce", minSelect: 1, maxSelect: 1, options: SAUCES },
        { name: "Left toppings", minSelect: 0, maxSelect: TOPPINGS.length, options: TOPPINGS },
        { name: "Right sauce", minSelect: 1, maxSelect: 1, options: SAUCES },
        { name: "Right toppings", minSelect: 0, maxSelect: TOPPINGS.length, options: TOPPINGS },
      ]
    )
  );

  const created = results.filter((row) => row.created).map((row) => row.item.name);
  const skipped = results.filter((row) => !row.created).map((row) => row.item.name);
  return {
    categoryId: category.id,
    created,
    skipped,
    message:
      created.length === 0
        ? "Those pizza items are already on this store."
        : `Added ${created.length} pizza item(s) under Pizza. Change the prices and options in Items or Modifiers.`,
  };
}
