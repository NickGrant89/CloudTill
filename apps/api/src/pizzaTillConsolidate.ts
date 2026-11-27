import { prisma } from "./db.js";
import { readModifierLayout, saveModifierLayout, syncModifierGroupSortOrders } from "./modifierFolders.js";
import { isPizzaRemoveToppingGroup } from "@cloudtill/shared";
import {
  comparePizzaModifierGroups,
  PIZZA_MODIFIER_MENU_ORDER,
  TILL_LAYOUT,
} from "./pizzaTillLayout.js";

function pizzaModifierRole(groupName: string): string {
  return groupName
    .replace(/^(\d+)\s*(?:”|")\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

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
  '9” Create Your Own Single Pizza',
  '12” Create Your Own Single Pizza',
  '16” Create Your Own Single Pizza',
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

  if (spec.name.includes("Half & half")) {
    await attachRemoveToppingMenusFromSingle(storeId, item.id, sortOrder);
  }

  return { name: spec.name, itemId: item.id, created: true };
}

function groupNameKey(name: string): string {
  return pizzaModifierRole(name);
}

async function attachRemoveToppingMenusFromSingle(storeId: string, targetItemId: string, startSortOrder: number) {
  const targetGroups = await prisma.modifierGroup.findMany({ where: { itemId: targetItemId } });
  const haveRemoveKeys = new Set(
    targetGroups.filter((g) => isPizzaRemoveToppingGroup(g.name)).map((g) => groupNameKey(g.name))
  );

  const sources: { id: string; name: string }[] = [];
  const single = await loadItem(storeId, "Pizza — Single");
  for (const g of single?.modifierGroups ?? []) {
    if (isPizzaRemoveToppingGroup(g.name)) sources.push({ id: g.id, name: g.name });
  }
  for (const label of ['9" Single Pizza', '12" Single Pizza', '16" Single Pizza']) {
    const row = await loadItem(storeId, label);
    for (const g of row?.modifierGroups ?? []) {
      if (isPizzaRemoveToppingGroup(g.name)) sources.push({ id: g.id, name: g.name });
    }
  }
  for (const label of CONSOLIDATED.filter((c) => c.name.includes("Half")).flatMap((c) => c.sizes)) {
    const row = await loadItem(storeId, label);
    for (const g of row?.modifierGroups ?? []) {
      if (isPizzaRemoveToppingGroup(g.name)) sources.push({ id: g.id, name: g.name });
    }
  }

  const seen = new Set<string>();
  let sortOrder = startSortOrder;
  let attached = 0;
  for (const src of sources) {
    const key = groupNameKey(src.name);
    if (seen.has(key)) continue;
    if (haveRemoveKeys.has(key)) continue;
    seen.add(key);
    await copyModifierGroup(src.id, targetItemId, sortOrder++);
    attached += 1;
  }
  return attached;
}

async function applyMenuFreeSelect(storeId: string, menuName: string, freeSelect: number) {
  await prisma.modifierGroup.updateMany({
    where: { item: { storeId }, name: menuName },
    data: { freeSelect },
  });
}

/** Strip redundant extra-topping tabs, fix order, set free topping counts on consolidated pizza items. */
const LEGACY_TEMPLATE_ITEMS = ["Create your own", "Single pizza", "Half and half", "Half and half pizza option", "Half and half create your own"];

/** Remove modifier menus that only belonged to hidden legacy pizza tiles and tidy BO layout. */
export async function cleanupPizzaModifierLibrary(storeId: string) {
  const deactivated: string[] = [];
  for (const name of LEGACY_TEMPLATE_ITEMS) {
    for (const variant of nameVariants(name)) {
      const row = await prisma.item.findFirst({ where: { storeId, name: variant, active: true } });
      if (!row) continue;
      await prisma.item.update({ where: { id: row.id }, data: { active: false } });
      deactivated.push(row.name);
      break;
    }
  }

  const inactive = await prisma.item.findMany({
    where: { storeId, active: false },
    select: { id: true, name: true },
  });
  for (const item of inactive) {
    await prisma.modifier.deleteMany({ where: { group: { itemId: item.id } } });
    await prisma.modifierGroup.deleteMany({ where: { itemId: item.id } });
  }

  const activeGroupNames = new Set(
    (
      await prisma.modifierGroup.findMany({
        where: { item: { storeId, active: true } },
        select: { name: true },
      })
    ).map((row) => row.name.toLowerCase())
  );

  const layout = await readModifierLayout(storeId);
  const nextMenuOrder = layout.menuOrder.filter((name) => activeGroupNames.has(name.toLowerCase()));
  const nextMap: Record<string, string> = {};
  for (const [key, folder] of Object.entries(layout.map)) {
    if (activeGroupNames.has(key.toLowerCase())) nextMap[key] = folder;
  }
  const folderSet = new Set(Object.values(nextMap));
  const nextFolderOrder = layout.folderOrder.filter((f) => folderSet.has(f));

  const redundantTemplates = ["pizza", "toppings", "left half", "right half", "left sauce", "right sauce", "left toppings", "right toppings", "extra options"];
  const deletedMenus: string[] = [];
  for (const name of redundantTemplates) {
    if (activeGroupNames.has(name)) continue;
    const leftovers = (
      await prisma.modifierGroup.findMany({ where: { item: { storeId } }, select: { id: true, name: true } })
    ).filter((group) => group.name.toLowerCase() === name);
    if (!leftovers.length) continue;
    await prisma.modifier.deleteMany({ where: { groupId: { in: leftovers.map((g) => g.id) } } });
    await prisma.modifierGroup.deleteMany({ where: { id: { in: leftovers.map((g) => g.id) } } });
    deletedMenus.push(name);
  }

  await saveModifierLayout(
    storeId,
    { map: nextMap, folderOrder: nextFolderOrder.length ? nextFolderOrder : layout.folderOrder, menuOrder: nextMenuOrder },
    { tillOrder: "none" }
  );

  return {
    deactivated,
    strippedInactiveItems: inactive.length,
    deletedMenus,
    menusInLibrary: activeGroupNames.size,
    message: "Modifier library trimmed — legacy pizza templates removed from hidden items and layout.",
  };
}

export async function repairPizzaTillLayout(storeId: string) {
  const itemNames = Object.keys(TILL_LAYOUT);
  const changed: { item: string; removed: string[]; attachedRemoves?: number; order: string[] }[] = [];

  for (const itemName of itemNames) {
    const rule = TILL_LAYOUT[itemName]!;
    const item = await prisma.item.findFirst({
      where: { storeId, name: itemName, active: true },
      include: {
        modifierGroups: {
          include: { modifiers: true },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!item) continue;

    const removed: string[] = [];
    const orderKeys = new Set(rule.order.map((name) => name.toLowerCase()));
    const singlePizza =
      itemName === "Pizza — Single" || itemName === "Pizza — Create your own";

    for (const group of [...item.modifierGroups]) {
      if (rule.drop(group.name)) {
        await prisma.modifier.deleteMany({ where: { groupId: group.id } });
        await prisma.modifierGroup.delete({ where: { id: group.id } });
        removed.push(group.name);
        continue;
      }
      const role = pizzaModifierRole(group.name);
      if (singlePizza) {
        if (role === "pizza sauce 2" || (/half/i.test(group.name) && /left|right/i.test(group.name))) {
          await prisma.modifier.deleteMany({ where: { groupId: group.id } });
          await prisma.modifierGroup.delete({ where: { id: group.id } });
          removed.push(group.name);
          continue;
        }
      }
      if (
        !singlePizza &&
        role === "pizza sauce 2" &&
        !orderKeys.has("pizza sauce 2") &&
        !itemName.includes("Half")
      ) {
        await prisma.modifier.deleteMany({ where: { groupId: group.id } });
        await prisma.modifierGroup.delete({ where: { id: group.id } });
        removed.push(group.name);
      }
    }

    if (rule.freeSelect) {
      for (const [menuName, freeSelect] of Object.entries(rule.freeSelect)) {
        await applyMenuFreeSelect(storeId, menuName, freeSelect);
      }
    }

    const fresh = await prisma.modifierGroup.findMany({
      where: { itemId: item.id },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    const sorted = [...fresh].sort((a, b) => comparePizzaModifierGroups(itemName, a.name, b.name));
    for (let index = 0; index < sorted.length; index += 1) {
      const group = sorted[index]!;
      if (group.sortOrder === index) continue;
      await prisma.modifierGroup.update({ where: { id: group.id }, data: { sortOrder: index } });
    }

    const attachedRemoves =
      itemName === "Pizza — Half & half" || itemName === "Pizza — Half & half (CYO)"
        ? await attachRemoveToppingMenusFromSingle(storeId, item.id, sorted.length)
        : 0;

    const afterAttach =
      attachedRemoves > 0
        ? await prisma.modifierGroup.findMany({
            where: { itemId: item.id },
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          })
        : sorted;
    const finalOrder =
      attachedRemoves > 0
        ? [...afterAttach].sort((a, b) => comparePizzaModifierGroups(itemName, a.name, b.name))
        : sorted;
    if (attachedRemoves > 0) {
      for (let index = 0; index < finalOrder.length; index += 1) {
        const group = finalOrder[index]!;
        if (group.sortOrder === index) continue;
        await prisma.modifierGroup.update({ where: { id: group.id }, data: { sortOrder: index } });
      }
    }

  changed.push({
      item: itemName,
      removed,
      attachedRemoves,
      order: finalOrder.map((g) => g.name),
    });
  }

  const layout = await readModifierLayout(storeId);
  const map = { ...layout.map };
  const pizzaFolder = map["pizza base"] || map["pizza options"] || "PIZZAS OPTIONS";
  for (const menu of PIZZA_MODIFIER_MENU_ORDER) {
    map[menu.toLowerCase()] = pizzaFolder;
  }
  map["size"] = pizzaFolder;
  const seen = new Set<string>();
  const menuOrder: string[] = [];
  for (const menu of PIZZA_MODIFIER_MENU_ORDER) {
    const key = menu.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    menuOrder.push(menu);
  }
  for (const name of layout.menuOrder) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    menuOrder.push(name);
  }
  await saveModifierLayout(storeId, { map, folderOrder: layout.folderOrder, menuOrder }, { tillOrder: "none" });
  const syncedGroups = await syncModifierGroupSortOrders(storeId, menuOrder);

  return {
    repaired: changed.length,
    items: changed,
    syncedGroups,
    message: "Pizza till order updated — Size → Base → Sauce → toppings; BO menu order aligned.",
  };
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
  const repair = await repairPizzaTillLayout(storeId);

  return {
    category: category.name,
    items,
    hidden: [...new Set(hidden)],
    repair,
    message: `Till shows ${CONSOLIDATED.length} pizza buttons (pick size first). Hid ${hidden.length} legacy tiles. Deals unchanged.`,
  };
}