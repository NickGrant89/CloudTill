import { prisma } from "./db.js";
import { readModifierLayout, saveModifierLayout } from "./modifierFolders.js";

const SIZE_GROUP = "Size";
const PIZZA_SIZES = [
  { name: '9"', priceCents: 800 },
  { name: '12"', priceCents: 1000 },
  { name: '16"', priceCents: 1200 },
];

const CONSOLIDATED = [
  { name: "Pizza — Single", color: "#B45309", template: '12" Single Pizza', sizes: ['9" Single Pizza', '12" Single Pizza', '16" Single Pizza'] },
  { name: "Pizza — Half & half", color: "#9A3412", template: '12" Half & Half', sizes: ['9" Half & Half', '12" Half & Half', '16" Half & Half'] },
  {
    name: "Pizza — Create your own",
    color: "#C45C26",
    template: '12” Create Your Own Single Pizza',
    sizes: ['9” Create Your Own Single Pizza', '12” Create Your Own Single Pizza', '16” Create Your Own Single Pizza'],
  },
  { name: "Pizza — Half & half (CYO)", color: "#7C2D12", template: '12" CYO - Half & Half', sizes: ['9" CYO - Half & Half', '12" CYO - Half & Half', '16" CYO - Half & Half'] },
] as const;

const LEGACY_HIDE = [
  "Single pizza",
  "Half and half",
  "Half and half pizza option",
  "Half and half create your own",
  '9" Single Pizza',
  '12" Single Pizza',
  '16" Single Pizza',
  '9" Half & Half',
  '12" Half & Half',
  '16" Half & Half',
  '9" CYO - Half & Half',
  '12" CYO - Half & Half',
  '16" CYO - Half & Half',
  '9" Create Your Own Single Pizza',
  '12" Create Your Own Single Pizza',
  '16" Create Your Own Single Pizza',
];

type ItemWithGroups = Awaited<ReturnType<typeof loadItem>>;

function inchSizeInName(name: string): number | null {
  const match = name.match(/(\d+)\s*(?:”|")/);
  if (!match) return null;
  const n = Number(match[1]);
  return n === 9 || n === 12 || n === 16 ? n : null;
}

function nameVariants(name: string): string[] {
  return [...new Set([name, name.replace(/"/g, '"'), name.replace(/"/g, '"'), name.replace(/\u201d/g, '"')])];
}

async function loadItem(storeId: string, name: string) {
  return prisma.item.findFirst({
    where: { storeId, active: true, name: { in: nameVariants(name) } },
    include: {
      modifierGroups: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: { modifiers: { where: { active: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
      },
      variants: true,
    },
  });
}

async function copyModifierGroup(sourceGroupId: string, targetItemId: string, sortOrder: number) {
  const source = await prisma.modifierGroup.findUnique({
    where: { id: sourceGroupId },
    include: { modifiers: { where: { active: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
  });
  if (!source) return null;
  return prisma.modifierGroup.create({
    data: {
      itemId: targetItemId,
      name: source.name,
      minSelect: source.minSelect,
      maxSelect: source.maxSelect,
      freeSelect: source.freeSelect,
      sortOrder,
      modifiers: {
        create: source.modifiers.map((mod, index) => ({
          name: mod.name,
          priceCents: mod.priceCents,
          sortOrder: index,
          active: true,
        })),
      },
    },
  });
}

function sizedRoleKey(name: string): string {
  return name
    .replace(/(\d+)\s*(?:”|")/g, "INCH")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function findSizedGroup(item: ItemWithGroups | null, inches: number, roleFromTemplate: string) {
  if (!item) return null;
  const role = sizedRoleKey(roleFromTemplate);
  return (
    item.modifierGroups.find((g) => inchSizeInName(g.name) === inches && sizedRoleKey(g.name) === role) ??
    item.modifierGroups.find((g) => inchSizeInName(g.name) === inches && sizedRoleKey(g.name).includes(role.split(" ").slice(-3).join(" ")))
  );
}

async function ensurePizzaCategory(storeId: string) {
  const cats = await prisma.category.findMany({ where: { storeId } });
  const pizza = cats.find((c) => c.name.toLowerCase() === "pizza");
  if (pizza) return pizza;
  return prisma.category.create({
    data: { storeId, name: "Pizza", color: "#C45C26", sortOrder: cats.length },
  });
}

async function buildConsolidatedItem(storeId: string, categoryId: string, spec: (typeof CONSOLIDATED)[number]) {
  const template = await loadItem(storeId, spec.template);
  if (!template) return { name: spec.name, error: `Missing template: ${spec.template}` };

  const bySize: Record<number, ItemWithGroups | null> = {};
  for (const label of spec.sizes) {
    const row = await loadItem(storeId, label);
    if (row) bySize[inchSizeInName(label) ?? 0] = row;
  }

  const stamp = Date.now().toString(36).slice(-4);
  let item = await prisma.item.findFirst({ where: { storeId, name: spec.name } });

  if (!item) {
    item = await prisma.item.create({
      data: {
        storeId,
        categoryId,
        name: spec.name,
        color: spec.color,
        variants: {
          create: { name: "Regular", sku: `PIZ-CON-${stamp}`, priceCents: 0, trackStock: false },
        },
      },
      include: { variants: true },
    });
    await prisma.inventoryLevel.create({
      data: { storeId, variantId: item.variants[0]!.id, quantity: 0, lowStock: 0 },
    });
  } else {
    await prisma.modifier.deleteMany({ where: { group: { itemId: item.id } } });
    await prisma.modifierGroup.deleteMany({ where: { itemId: item.id } });
    item = await prisma.item.update({
      where: { id: item.id },
      data: { active: true, categoryId, color: spec.color },
      include: { variants: true },
    });
  }

  let sortOrder = 0;
  await prisma.modifierGroup.create({
    data: {
      itemId: item.id,
      name: SIZE_GROUP,
      minSelect: 1,
      maxSelect: 1,
      freeSelect: 0,
      sortOrder: sortOrder++,
      modifiers: {
        create: PIZZA_SIZES.map((row, index) => ({ name: row.name, priceCents: row.priceCents, sortOrder: index })),
      },
    },
  });

  const copiedSized = new Set<string>();

  for (const group of template.modifierGroups) {
    if (inchSizeInName(group.name)) {
      for (const inches of [9, 12, 16] as const) {
        const from =
          inches === 12
            ? group
            : findSizedGroup(bySize[inches] ?? null, inches, group.name) ??
              bySize[inches]?.modifierGroups.find((g) => inchSizeInName(g.name) === inches && sizedRoleKey(g.name) === sizedRoleKey(group.name));
        if (!from) continue;
        const key = `${inches}:${from.name}`;
        if (copiedSized.has(key)) continue;
        copiedSized.add(key);
        await copyModifierGroup(from.id, item.id, sortOrder++);
      }
    } else {
      await copyModifierGroup(group.id, item.id, sortOrder++);
    }
  }

  for (const inches of [9, 12, 16] as const) {
    const src = bySize[inches];
    if (!src) continue;
    for (const group of src.modifierGroups) {
      if (!inchSizeInName(group.name)) continue;
      const key = `${inches}:${group.name}`;
      if (copiedSized.has(key)) continue;
      copiedSized.add(key);
      await copyModifierGroup(group.id, item.id, sortOrder++);
    }
  }

  return { name: spec.name, itemId: item.id, created: true };
}

export async function consolidatePizzaTill(storeId: string) {
  const category = await ensurePizzaCategory(storeId);
  const items = [];
  for (const spec of CONSOLIDATED) {
    items.push(await buildConsolidatedItem(storeId, category.id, spec));
  }

  const hidden: string[] = [];
  for (const legacyName of LEGACY_HIDE) {
    for (const name of nameVariants(legacyName)) {
      const row = await prisma.item.findFirst({ where: { storeId, name } });
      if (!row?.active) continue;
      await prisma.item.update({ where: { id: row.id }, data: { active: false } });
      hidden.push(row.name);
      break;
    }
  }

  const layout = await readModifierLayout(storeId);
  const map = { ...layout.map };
  for (const row of CONSOLIDATED) map[row.name.toLowerCase()] = "PIZZAS OPTIONS";
  map[SIZE_GROUP.toLowerCase()] = "PIZZAS OPTIONS";
  await saveModifierLayout(storeId, { map, folderOrder: layout.folderOrder, menuOrder: layout.menuOrder }, { tillOrder: "none" });

  return {
    category: category.name,
    items,
    hidden: [...new Set(hidden)],
    message: `Till shows ${CONSOLIDATED.length} pizza buttons (pick size first). Hid ${hidden.length} legacy tiles. Deals unchanged.`,
  };
}