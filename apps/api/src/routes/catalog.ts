import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { owned, rejectForeign } from "../tenant.js";
import { requireAuth, requireRole, type AuthedRequest } from "../auth.js";
import { companyStoreIds, sameCompany } from "../company.js";
import { storeAllowsFeature } from "./billing.js";
import { ensurePizzaMenu } from "../pizzaMenu.js";
import { cleanupPizzaModifierLibrary, consolidatePizzaTill, repairPizzaTillLayout } from "../pizzaTillConsolidate.js";
import {
  defaultModifierFolder,
  deleteModifierFolder,
  readModifierLayout,
  removeSectionHeaderModifierGroups,
  repairModifierLayoutFromMenuOrder,
  saveModifierLayout,
  setModifierFolder,
  sortFolders,
  sortMenus,
  syncModifierGroupSortOrders,
} from "../modifierFolders.js";

export const catalogRouter = Router();
catalogRouter.use(requireAuth);

catalogRouter.get("/categories", async (req: AuthedRequest, res) => {
  const cats = await prisma.category.findMany({
    where: { storeId: req.user!.storeId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  res.json(cats);
});

catalogRouter.post("/categories", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({ name: z.string().min(1), color: z.string().optional(), sortOrder: z.number().optional() })
    .parse(req.body);
  const count = await prisma.category.count({ where: { storeId: req.user!.storeId } });
  const cat = await prisma.category.create({
    data: {
      storeId: req.user!.storeId,
      name: body.name,
      color: body.color ?? "#2F6F4E",
      sortOrder: body.sortOrder ?? count,
    },
  });
  res.status(201).json(cat);
});

catalogRouter.post("/categories/order", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z.object({ categoryIds: z.array(z.string().min(1)).min(1).max(200) }).parse(req.body);
  if (await rejectForeign(res, "category", body.categoryIds, req.user!.storeId)) return;
  const unique = [...new Set(body.categoryIds)];
  if (unique.length !== body.categoryIds.length) {
    return res.status(400).json({ error: "Duplicate group ids in order list." });
  }
  const owned = await prisma.category.findMany({
    where: { storeId: req.user!.storeId, id: { in: unique } },
    select: { id: true },
  });
  if (owned.length !== unique.length) {
    return res.status(400).json({ error: "One or more groups were not found." });
  }
  for (let index = 0; index < body.categoryIds.length; index += 1) {
    await prisma.category.update({ where: { id: body.categoryIds[index] }, data: { sortOrder: index } });
  }
  res.json({ ok: true, count: body.categoryIds.length });
});

catalogRouter.patch("/categories/:id", owned("category"), requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z.object({ name: z.string().optional(), color: z.string().optional(), sortOrder: z.number().optional() }).parse(req.body);
  const cat = await prisma.category.update({ where: { id: req.params.id }, data: body });
  res.json(cat);
});

catalogRouter.delete("/categories/:id", owned("category"), requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      moveToCategoryId: z.string().min(1).nullable().optional(),
    })
  .parse(req.body ?? {});

  const categoryId = req.params.id;
  const itemCount = await prisma.item.count({
    where: { storeId: req.user!.storeId, categoryId, active: true },
  });

  if (itemCount > 0) {
    if (body.moveToCategoryId === undefined) {
      return res.status(400).json({
        error: `This group has ${itemCount} item${itemCount === 1 ? "" : "s"}. Pick another group to move them to, or pass moveToCategoryId: null to leave ungrouped.`,
        itemCount,
      });
    }
    const moveTo = body.moveToCategoryId;
    if (moveTo && moveTo === categoryId) {
      return res.status(400).json({ error: "Choose a different group to move items into." });
    }
    if (moveTo) {
      const target = await prisma.category.findFirst({ where: { id: moveTo, storeId: req.user!.storeId } });
      if (!target) return res.status(400).json({ error: "Target group not found." });
    }
    await prisma.item.updateMany({
      where: { storeId: req.user!.storeId, categoryId },
      data: { categoryId: moveTo },
    });
  }

  await prisma.category.delete({ where: { id: categoryId } });
  res.json({ ok: true, movedItems: itemCount, targetCategoryId: body.moveToCategoryId ?? null });
});

catalogRouter.get("/items", async (req: AuthedRequest, res) => {
  const storeId = req.user!.storeId;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const categoryId = typeof req.query.categoryId === "string" ? req.query.categoryId : undefined;
  const barcode = typeof req.query.barcode === "string" ? req.query.barcode.trim() : undefined;

  const items = await prisma.item.findMany({
    where: {
      storeId,
      active: true,
      ...(categoryId ? { categoryId } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { variants: { some: { sku: { contains: q } } } },
              { variants: { some: { barcode: { contains: q } } } },
            ],
          }
        : {}),
      ...(barcode ? { variants: { some: { barcode } } } : {}),
    },
    include: {
      variants: { where: { active: true } },
      modifierGroups: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: {
          modifiers: { where: { active: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
        },
      },
      kitComponents: true,
    },
    orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }],
  });

  const levels = await prisma.inventoryLevel.findMany({ where: { storeId } });
  const levelMap = new Map(levels.map((l) => [`${l.variantId}`, l]));

  const mapped = items.map((item) => ({
    ...item,
    modifierGroups: item.modifierGroups.filter((group) => group.modifiers.length > 0),
    variants: item.variants.map((v) => ({
      ...v,
      stockQty: levelMap.get(v.id)?.quantity ?? 0,
      lowStock: levelMap.get(v.id)?.lowStock ?? 5,
    })),
  }));

  res.json(mapped);
});

catalogRouter.post("/items", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      name: z.string().min(1),
      categoryId: z.string().nullable().optional(),
      color: z.string().optional(),
      description: z.string().optional(),
      soldBy: z.enum(["each", "weight"]).optional(),
      isComposite: z.boolean().optional(),
      trackStock: z.boolean().optional(),
      priceCents: z.number().int(),
      costCents: z.number().int().optional(),
      sku: z.string().min(1),
      barcode: z.string().optional(),
      stockQty: z.number().optional(),
      modifiers: z
        .array(
          z.object({
            name: z.string(),
            minSelect: z.number().optional(),
            maxSelect: z.number().optional(),
            freeSelect: z.number().int().min(0).optional(),
            options: z.array(z.object({ name: z.string(), priceCents: z.number().int() })),
          })
        )
        .optional(),
    })
    .parse(req.body);
  if (await rejectForeign(res, "category", [body.categoryId], req.user!.storeId)) return;

  const item = await prisma.item.create({
    data: {
      storeId: req.user!.storeId,
      name: body.name,
      categoryId: body.categoryId ?? null,
      color: body.color ?? "#3D5A4C",
      description: body.description,
      soldBy: body.soldBy ?? "each",
      isComposite: body.isComposite ?? false,
      variants: {
        create: {
          name: "Regular",
          sku: body.sku,
          barcode: body.barcode,
          priceCents: body.priceCents,
          costCents: body.costCents ?? 0,
          trackStock: body.trackStock ?? true,
        },
      },
    },
    include: { variants: true },
  });

  await prisma.inventoryLevel.create({
    data: {
      storeId: req.user!.storeId,
      variantId: item.variants[0].id,
      quantity: body.stockQty ?? 0,
      lowStock: 5,
    },
  });

  if (body.modifiers?.length) {
    for (const [index, g] of body.modifiers.entries()) {
      await prisma.modifierGroup.create({
        data: {
          itemId: item.id,
          name: g.name,
          minSelect: g.minSelect ?? 0,
          maxSelect: g.maxSelect ?? 1,
          freeSelect: g.freeSelect ?? 0,
          sortOrder: index,
          modifiers: {
            create: g.options.map((o, optionIndex) => ({
              name: o.name,
              priceCents: o.priceCents,
              sortOrder: optionIndex,
            })),
          },
        },
      });
    }
  }

  const full = await prisma.item.findUnique({
    where: { id: item.id },
    include: {
      variants: true,
      modifierGroups: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: { modifiers: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
      },
    },
  });
  res.status(201).json(full);
});

/**
 * Which other stores already have matching SKUs (for branch assign UI).
 * Items remain store-scoped; “on a branch” means a copy exists there.
 */
catalogRouter.get("/items/store-presence", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const storeId = req.user!.storeId;
  const items = await prisma.item.findMany({
    where: { storeId, active: true },
    include: { variants: { where: { active: true }, select: { sku: true } } },
  });
  const skus = [...new Set(items.flatMap((i) => i.variants.map((v) => v.sku).filter(Boolean)))];
  const companyIds = await companyStoreIds(storeId);
  const stores = await prisma.store.findMany({
    where: { id: { in: companyIds } },
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  });
  const elsewhere =
    skus.length === 0
      ? []
      : await prisma.variant.findMany({
          where: {
            sku: { in: skus },
            active: true,
            item: { storeId: { in: companyIds.filter((id) => id !== storeId) }, active: true },
          },
          select: {
            sku: true,
            item: { select: { storeId: true, store: { select: { id: true, name: true } } } },
          },
        });

  const bySku = new Map<string, { storeId: string; storeName: string }[]>();
  for (const row of elsewhere) {
    const list = bySku.get(row.sku) ?? [];
    if (!list.some((s) => s.storeId === row.item.storeId)) {
      list.push({ storeId: row.item.storeId, storeName: row.item.store.name });
    }
    bySku.set(row.sku, list);
  }

  const presence = items.map((item) => {
    const itemSkus = item.variants.map((v) => v.sku);
    const storesPresent = new Map<string, string>();
    for (const sku of itemSkus) {
      for (const hit of bySku.get(sku) ?? []) {
        storesPresent.set(hit.storeId, hit.storeName);
      }
    }
    return {
      itemId: item.id,
      name: item.name,
      skus: itemSkus,
      stores: [...storesPresent.entries()].map(([id, name]) => ({ id, name })),
    };
  });

  res.json({
    currentStoreId: storeId,
    stores,
    presence,
  });
});

/** Copy selected items onto other branches (by SKU; skip if already there). */
catalogRouter.post("/items/assign-stores", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      itemIds: z.array(z.string()).min(1),
      storeIds: z.array(z.string()).min(1),
      stockQty: z.number().optional(),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "itemIds and storeIds required" });

  const sourceStoreId = req.user!.storeId;
  if (!(await storeAllowsFeature(sourceStoreId, "multi_store"))) {
    return res.status(402).json({
      error: "Assigning items to branches needs an active Multi plan. Upgrade in Settings → Billing.",
      feature: "multi_store",
    });
  }
  const targetIds = body.data.storeIds.filter((id) => id !== sourceStoreId);
  if (!targetIds.length) return res.status(400).json({ error: "Pick at least one other branch/store" });

  if (!(await sameCompany(sourceStoreId, targetIds))) {
    return res.status(403).json({ error: "You can only send items to your own branches" });
  }
  if (await rejectForeign(res, "item", body.data.itemIds, sourceStoreId)) return;
  const targets = await prisma.store.findMany({ where: { id: { in: targetIds } } });
  if (targets.length !== targetIds.length) {
    return res.status(400).json({ error: "One or more target stores were not found" });
  }

  const sources = await prisma.item.findMany({
    where: { id: { in: body.data.itemIds }, storeId: sourceStoreId, active: true },
    include: {
      variants: { where: { active: true } },
      category: true,
      modifierGroups: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: {
          modifiers: { where: { active: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
        },
      },
    },
  });
  if (!sources.length) return res.status(404).json({ error: "No items found in this store" });

  const created: { itemName: string; storeName: string }[] = [];
  const skipped: { itemName: string; storeName: string; reason: string }[] = [];
  const openingStock = body.data.stockQty ?? 0;

  for (const target of targets) {
    for (const source of sources) {
      const primarySku = source.variants[0]?.sku;
      if (!primarySku) {
        skipped.push({ itemName: source.name, storeName: target.name, reason: "No SKU" });
        continue;
      }
      const existing = await prisma.variant.findFirst({
        where: {
          sku: primarySku,
          active: true,
          item: { storeId: target.id, active: true },
        },
      });
      if (existing) {
        skipped.push({ itemName: source.name, storeName: target.name, reason: "Already on branch (same SKU)" });
        continue;
      }

      let categoryId: string | null = null;
      if (source.category) {
        const match =
          (await prisma.category.findFirst({
            where: { storeId: target.id, name: source.category.name },
          })) ??
          (await prisma.category.create({
            data: {
              storeId: target.id,
              name: source.category.name,
              color: source.category.color,
              sortOrder: source.category.sortOrder,
            },
          }));
        categoryId = match.id;
      }

      const copied = await prisma.item.create({
        data: {
          storeId: target.id,
          name: source.name,
          description: source.description,
          color: source.color,
          soldBy: source.soldBy,
          isComposite: source.isComposite,
          categoryId,
          variants: {
            create: source.variants.map((v) => ({
              name: v.name,
              sku: v.sku,
              barcode: v.barcode,
              priceCents: v.priceCents,
              costCents: v.costCents,
              trackStock: v.trackStock,
            })),
          },
        },
        include: { variants: true },
      });

      for (const v of copied.variants) {
        await prisma.inventoryLevel.create({
          data: {
            storeId: target.id,
            variantId: v.id,
            quantity: openingStock,
            lowStock: 5,
          },
        });
      }

      for (const g of source.modifierGroups) {
        await prisma.modifierGroup.create({
          data: {
            itemId: copied.id,
            name: g.name,
            minSelect: g.minSelect,
            maxSelect: g.maxSelect,
            sortOrder: g.sortOrder,
            modifiers: {
              create: g.modifiers.map((m) => ({
                name: m.name,
                priceCents: m.priceCents,
                sortOrder: m.sortOrder,
              })),
            },
          },
        });
      }

      created.push({ itemName: source.name, storeName: target.name });
    }
  }

  res.json({
    ok: true,
    createdCount: created.length,
    skippedCount: skipped.length,
    created,
    skipped,
    message:
      created.length === 0
        ? "Nothing new to assign — those items may already be on the selected branches."
        : `Assigned ${created.length} item(s) to branch(es).`,
  });
});

catalogRouter.patch("/items/:id", owned("item"), requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      name: z.string().optional(),
      categoryId: z.string().nullable().optional(),
      color: z.string().optional(),
      description: z.string().nullable().optional(),
      active: z.boolean().optional(),
      priceCents: z.number().int().optional(),
      sku: z.string().optional(),
      barcode: z.string().nullable().optional(),
      trackStock: z.boolean().optional(),
    })
    .parse(req.body);
  if (await rejectForeign(res, "category", [body.categoryId], req.user!.storeId)) return;

  const { priceCents, sku, barcode, trackStock, ...itemData } = body;
  await prisma.item.update({ where: { id: req.params.id }, data: itemData });

  if (priceCents !== undefined || sku || barcode !== undefined || trackStock !== undefined) {
    const variant = await prisma.variant.findFirst({ where: { itemId: req.params.id } });
    if (variant) {
      await prisma.variant.update({
        where: { id: variant.id },
        data: {
          ...(priceCents !== undefined ? { priceCents } : {}),
          ...(sku ? { sku } : {}),
          ...(barcode !== undefined ? { barcode } : {}),
          ...(trackStock !== undefined ? { trackStock } : {}),
        },
      });
    }
  }

  const full = await prisma.item.findUnique({
    where: { id: req.params.id },
    include: {
      variants: true,
      modifierGroups: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: { modifiers: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
      },
    },
  });
  res.json(full);
});

catalogRouter.delete("/items/:id", owned("item"), requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const item = await prisma.item.findFirst({
    where: { id, storeId: req.user!.storeId },
    include: { variants: { select: { id: true } } },
  });
  if (!item) return res.status(404).json({ error: "Item not found" });

  const variantIds = item.variants.map((v) => v.id);
  const sales =
    variantIds.length > 0
      ? await prisma.saleLine.count({ where: { variantId: { in: variantIds } } })
      : 0;

  if (sales > 0) {
    await prisma.item.update({ where: { id }, data: { active: false } });
    await prisma.variant.updateMany({ where: { itemId: id }, data: { active: false } });
    return res.json({
      ok: true,
      deactivated: true,
      message: `${item.name} has sales history — hidden from till and items list`,
    });
  }

  if (variantIds.length > 0) {
    const openTicketLines = await prisma.ticketLine.count({
      where: {
        variantId: { in: variantIds },
        ticket: { storeId: req.user!.storeId, status: { in: ["open", "held"] } },
      },
    });
    if (openTicketLines > 0) {
      return res.status(400).json({ error: "Item is on an open ticket — remove it on the till first" });
    }

    const kitUse = await prisma.kitComponent.count({
      where: {
        OR: [{ parentItemId: id }, { componentVarId: { in: variantIds } }],
      },
    });
    if (kitUse > 0) {
      return res.status(400).json({ error: "Item is used in a kit — remove it from the kit first" });
    }

    await prisma.ticketLine.deleteMany({ where: { variantId: { in: variantIds } } });
  }

  await prisma.item.delete({ where: { id } });
  res.json({ ok: true, deleted: true, message: `${item.name} deleted` });
});

catalogRouter.get("/modifier-sets", async (req: AuthedRequest, res) => {
  const storeId = req.user!.storeId;
  let [groups, layout] = await Promise.all([
    prisma.modifierGroup.findMany({
      where: { item: { storeId, active: true } },
      include: {
        modifiers: { where: { active: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
        item: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
    }),
    readModifierLayout(storeId),
  ]);

  const repaired = repairModifierLayoutFromMenuOrder(layout);
  if (repaired.changed) {
    await saveModifierLayout(storeId, repaired.layout, { tillOrder: "none" });
    layout = repaired.layout;
  }
  const headerGroupsRemoved = await removeSectionHeaderModifierGroups(storeId);
  if (headerGroupsRemoved) {
    groups = await prisma.modifierGroup.findMany({
      where: { item: { storeId, active: true } },
      include: {
        modifiers: { where: { active: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
        item: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
    });
  }

  const byName = new Map<
    string,
    {
      name: string;
      folder: string;
      minSelect: number;
      maxSelect: number;
      freeSelect: number;
      options: { name: string; priceCents: number }[];
      assignments: { groupId: string; itemId: string; itemName: string }[];
    }
  >();

  for (const group of groups) {
    const assignment = { groupId: group.id, itemId: group.item.id, itemName: group.item.name };
    const existing = byName.get(group.name.toLowerCase());
    if (!existing) {
      byName.set(group.name.toLowerCase(), {
        name: group.name,
        folder: layout.map[group.name.toLowerCase()] || defaultModifierFolder(group.name),
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        freeSelect: group.freeSelect,
        options: group.modifiers.map((modifier) => ({ name: modifier.name, priceCents: modifier.priceCents })),
        assignments: [assignment],
      });
    } else {
      existing.assignments.push(assignment);
    }
  }

  const rows = [...byName.values()];
  const folderNames = sortFolders(
    [...new Set([...layout.folderOrder, ...rows.map((row) => row.folder)])],
    layout.folderOrder
  );
  const menuNames = sortMenus(
    rows.map((row) => row.name),
    layout.menuOrder.length ? layout.menuOrder : rows.map((row) => row.name)
  );
  const folderRank = new Map(folderNames.map((name, index) => [name.toLowerCase(), index]));
  const menuRank = new Map(menuNames.map((name, index) => [name.toLowerCase(), index]));
  rows.sort((a, b) => {
    const folderCmp = (folderRank.get(a.folder.toLowerCase()) ?? 0) - (folderRank.get(b.folder.toLowerCase()) ?? 0);
    if (folderCmp) return folderCmp;
    return (menuRank.get(a.name.toLowerCase()) ?? 0) - (menuRank.get(b.name.toLowerCase()) ?? 0);
  });

  res.json({
    sets: rows,
    folderOrder: folderNames,
    menuOrder: menuNames,
  });
});

catalogRouter.patch("/modifier-sets/folder", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      name: z.string().min(1).max(80),
      folder: z.string().min(1).max(40),
    })
    .parse(req.body);
  const folder = await setModifierFolder(req.user!.storeId, body.name, body.folder);
  res.json({ ok: true, name: body.name.trim(), folder });
});

catalogRouter.patch("/modifier-sets/layout", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      folderOrder: z.array(z.string().min(1).max(40)).max(40).optional(),
      menuOrder: z.array(z.string().min(1).max(80)).max(80).optional(),
      renameFolder: z.object({ from: z.string().min(1).max(40), to: z.string().min(1).max(40) }).optional(),
      renameSet: z.object({ from: z.string().min(1).max(80), to: z.string().min(1).max(80) }).optional(),
      deleteFolder: z
        .object({
          name: z.string().min(1).max(40),
          moveTo: z.string().min(1).max(40).optional(),
        })
        .optional(),
      syncTillOrder: z.boolean().optional(),
    })
    .parse(req.body);
  if (body.deleteFolder) {
    try {
      const removed = await deleteModifierFolder(
        req.user!.storeId,
        body.deleteFolder.name,
        body.deleteFolder.moveTo
      );
      const synced = body.syncTillOrder ? await syncModifierGroupSortOrders(req.user!.storeId) : 0;
      return res.json({ ok: true, ...removed, syncedGroups: synced });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not delete group";
      return res.status(400).json({ error: message });
    }
  }
  const layout = await saveModifierLayout(req.user!.storeId, body);
  let synced = 0;
  if (body.syncTillOrder || body.menuOrder || body.folderOrder || body.renameSet || body.renameFolder) {
    synced = await syncModifierGroupSortOrders(req.user!.storeId, layout.menuOrder);
  }
  res.json({ ok: true, layout, syncedGroups: synced });
});

catalogRouter.post("/modifier-sets", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      name: z.string().min(1),
      minSelect: z.number().int().min(0).default(0),
      maxSelect: z.number().int().min(1).default(1),
      freeSelect: z.number().int().min(0).default(0),
      options: z.array(z.object({ name: z.string().min(1), priceCents: z.number().int() })).min(1),
      itemIds: z.array(z.string()).min(1),
    })
    .parse(req.body);
  if (await rejectForeign(res, "item", body.itemIds, req.user!.storeId)) return;

  const items = await prisma.item.findMany({
    where: { id: { in: body.itemIds }, storeId: req.user!.storeId, active: true },
    include: { modifierGroups: { select: { name: true } } },
  });

  const created: { groupId: string; itemId: string; itemName: string }[] = [];
  const skipped: string[] = [];
  for (const item of items) {
    if (item.modifierGroups.some((group) => group.name.toLowerCase() === body.name.toLowerCase())) {
      skipped.push(item.name);
      continue;
    }
    const group = await prisma.modifierGroup.create({
      data: {
        itemId: item.id,
        name: body.name.trim(),
        minSelect: Math.min(body.minSelect, body.maxSelect),
        maxSelect: body.maxSelect,
        freeSelect: body.freeSelect,
        modifiers: {
          create: body.options.map((option, index) => ({
            name: option.name.trim(),
            priceCents: option.priceCents,
            sortOrder: index,
          })),
        },
      },
    });
    created.push({ groupId: group.id, itemId: item.id, itemName: item.name });
  }

  res.status(201).json({ created, skipped });
});

catalogRouter.post("/pizza-menu", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const result = await ensurePizzaMenu(req.user!.storeId);
  res.status(result.created.length ? 201 : 200).json(result);
});

catalogRouter.post("/pizza-consolidate", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const result = await consolidatePizzaTill(req.user!.storeId);
  res.json({ ok: true, ...result });
});

catalogRouter.post("/pizza-till-repair", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const result = await repairPizzaTillLayout(req.user!.storeId);
  res.json({ ok: true, ...result });
});

catalogRouter.post("/pizza-modifier-cleanup", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const result = await cleanupPizzaModifierLibrary(req.user!.storeId);
  res.json({ ok: true, ...result });
});

catalogRouter.delete("/modifier-sets", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z.object({ name: z.string().min(1).max(80) }).parse(req.body);
  const wanted = body.name.trim().toLowerCase();
  const groups = await prisma.modifierGroup.findMany({
    where: { item: { storeId: req.user!.storeId } },
    select: { id: true, name: true },
  });
  const matching = groups.filter((group) => group.name.toLowerCase() === wanted);
  if (!matching.length) return res.status(404).json({ error: "Modifier not found" });

  const ids = matching.map((group) => group.id);
  await prisma.modifier.deleteMany({ where: { groupId: { in: ids } } });
  await prisma.modifierGroup.deleteMany({ where: { id: { in: ids } } });

  const layout = await readModifierLayout(req.user!.storeId);
  const nextMenuOrder = layout.menuOrder.filter((name) => name.toLowerCase() !== wanted);
  const nextMap = { ...layout.map };
  delete nextMap[wanted];
  await saveModifierLayout(req.user!.storeId, {
    menuOrder: nextMenuOrder,
    map: nextMap,
  });

  res.json({ ok: true, deletedGroups: matching.length, name: body.name.trim() });
});

catalogRouter.patch("/modifier-sets", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      name: z.string().min(1).max(80),
      minSelect: z.number().int().min(0).optional(),
      maxSelect: z.number().int().min(1).optional(),
      freeSelect: z.number().int().min(0).optional(),
      options: z
        .array(
          z.object({
            name: z.string().min(1).max(80),
            priceCents: z.number().int(),
            active: z.boolean().optional(),
          })
        )
        .min(1)
        .max(40),
    })
    .parse(req.body);
  const wanted = body.name.trim().toLowerCase();
  const groups = await prisma.modifierGroup.findMany({
    where: { item: { storeId: req.user!.storeId } },
    include: { modifiers: true },
  });
  const matching = groups.filter((group) => group.name.toLowerCase() === wanted);
  if (!matching.length) return res.status(404).json({ error: "modifier not found" });

  for (const group of matching) {
    if (body.minSelect !== undefined || body.maxSelect !== undefined || body.freeSelect !== undefined) {
      await prisma.modifierGroup.update({
        where: { id: group.id },
        data: {
          ...(body.minSelect !== undefined ? { minSelect: Math.min(body.minSelect, body.maxSelect ?? group.maxSelect) } : {}),
          ...(body.maxSelect !== undefined ? { maxSelect: body.maxSelect } : {}),
          ...(body.freeSelect !== undefined ? { freeSelect: body.freeSelect } : {}),
        },
      });
    }
    const keep = new Set(body.options.map((option) => option.name.trim().toLowerCase()));
    for (const modifier of group.modifiers) {
      if (!keep.has(modifier.name.toLowerCase()) && modifier.active) {
        await prisma.modifier.update({ where: { id: modifier.id }, data: { active: false } });
      }
    }
    for (const [index, option] of body.options.entries()) {
      const found = group.modifiers.find((modifier) => modifier.name.toLowerCase() === option.name.trim().toLowerCase());
      if (found) {
        await prisma.modifier.update({
          where: { id: found.id },
          data: {
            name: option.name.trim(),
            priceCents: option.priceCents,
            sortOrder: index,
            active: option.active !== false,
          },
        });
      } else {
        await prisma.modifier.create({
          data: {
            groupId: group.id,
            name: option.name.trim(),
            priceCents: option.priceCents,
            sortOrder: index,
            active: option.active !== false,
          },
        });
      }
    }
  }
  res.json({ ok: true, updatedGroups: matching.length });
});

catalogRouter.post("/modifier-sets/order", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      name: z.string().min(1).max(80),
      optionNames: z.array(z.string().min(1).max(80)).min(1).max(40),
    })
    .parse(req.body);
  const wanted = body.name.trim().toLowerCase();
  const groups = await prisma.modifierGroup.findMany({
    where: { item: { storeId: req.user!.storeId } },
    include: { modifiers: true },
  });
  const matching = groups.filter((group) => group.name.toLowerCase() === wanted);
  if (!matching.length) return res.status(404).json({ error: "Modifier not found" });
  const rank = new Map(body.optionNames.map((name, index) => [name.trim().toLowerCase(), index]));
  for (const group of matching) {
    for (const modifier of group.modifiers) {
      const index = rank.get(modifier.name.toLowerCase());
      if (index === undefined || modifier.sortOrder === index) continue;
      await prisma.modifier.update({ where: { id: modifier.id }, data: { sortOrder: index } });
    }
  }
  res.json({ ok: true });
});

catalogRouter.get("/items/:id/modifiers", owned("item"), async (req, res) => {
  const groups = await prisma.modifierGroup.findMany({
    where: { itemId: req.params.id },
    include: { modifiers: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  res.json(groups);
});

catalogRouter.post("/items/:id/modifier-order", owned("item"), requireRole("owner", "manager"), async (req, res) => {
  const body = z.object({ groupIds: z.array(z.string()).min(1).max(40) }).parse(req.body);
  const itemId = String(req.params.id);
  const groups = await prisma.modifierGroup.findMany({ where: { itemId } });
  const ids = new Set(groups.map((group) => group.id));
  if (body.groupIds.length !== groups.length || body.groupIds.some((id) => !ids.has(id))) {
    return res.status(400).json({ error: "Send every modifier on this item, in the new order." });
  }
  await Promise.all(
    body.groupIds.map((id, index) => prisma.modifierGroup.update({ where: { id }, data: { sortOrder: index } }))
  );
  res.json({ ok: true });
});

catalogRouter.post("/items/:id/modifier-groups", owned("item"), requireRole("owner", "manager"), async (req, res) => {
  const body = z
    .object({
      name: z.string().min(1),
      minSelect: z.number().int().optional(),
      maxSelect: z.number().int().optional(),
      freeSelect: z.number().int().min(0).optional(),
      modifiers: z
        .array(z.object({ name: z.string(), priceCents: z.number().int().default(0) }))
        .optional(),
    })
    .parse(req.body);
  const group = await prisma.modifierGroup.create({
    data: {
      itemId: req.params.id,
      name: body.name,
      minSelect: body.minSelect ?? 0,
      maxSelect: body.maxSelect ?? 1,
      freeSelect: body.freeSelect ?? 0,
      sortOrder: await prisma.modifierGroup.count({ where: { itemId: String(req.params.id) } }),
      modifiers: body.modifiers?.length
        ? {
            create: body.modifiers.map((m, index) => ({ name: m.name, priceCents: m.priceCents, sortOrder: index })),
          }
        : undefined,
    },
    include: { modifiers: true },
  });
  res.status(201).json(group);
});

catalogRouter.patch("/modifier-groups/:id", owned("modifierGroup"), requireRole("owner", "manager"), async (req, res) => {
  const body = z
    .object({
      name: z.string().optional(),
      minSelect: z.number().int().optional(),
      maxSelect: z.number().int().optional(),
      freeSelect: z.number().int().min(0).optional(),
    })
    .parse(req.body);
  const group = await prisma.modifierGroup.update({
    where: { id: req.params.id },
    data: body,
    include: { modifiers: true },
  });
  res.json(group);
});

catalogRouter.delete("/modifier-groups/:id", owned("modifierGroup"), requireRole("owner", "manager"), async (req, res) => {
  await prisma.modifier.deleteMany({ where: { groupId: req.params.id } });
  await prisma.modifierGroup.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

catalogRouter.post("/modifier-groups/:id/modifiers", owned("modifierGroup"), requireRole("owner", "manager"), async (req, res) => {
  const body = z
    .object({ name: z.string().min(1), priceCents: z.number().int().default(0) })
    .parse(req.body);
  const mod = await prisma.modifier.create({
    data: {
      groupId: req.params.id,
      name: body.name,
      priceCents: body.priceCents,
      sortOrder: await prisma.modifier.count({ where: { groupId: String(req.params.id) } }),
    },
  });
  res.status(201).json(mod);
});

catalogRouter.patch("/modifiers/:id", owned("modifier"), requireRole("owner", "manager"), async (req, res) => {
  const body = z
    .object({
      name: z.string().optional(),
      priceCents: z.number().int().optional(),
      active: z.boolean().optional(),
    })
    .parse(req.body);
  const mod = await prisma.modifier.update({ where: { id: req.params.id }, data: body });
  res.json(mod);
});

catalogRouter.post(
  "/modifier-groups/:id/modifier-order",
  owned("modifierGroup"),
  requireRole("owner", "manager"),
  async (req, res) => {
    const body = z.object({ modifierIds: z.array(z.string()).min(1).max(40) }).parse(req.body);
    const groupId = String(req.params.id);
    const modifiers = await prisma.modifier.findMany({ where: { groupId } });
    const ids = new Set(modifiers.map((modifier) => modifier.id));
    if (body.modifierIds.length !== modifiers.length || body.modifierIds.some((id) => !ids.has(id))) {
      return res.status(400).json({ error: "Send every option in this modifier, in the new order." });
    }
    await Promise.all(
      body.modifierIds.map((id, index) => prisma.modifier.update({ where: { id }, data: { sortOrder: index } }))
    );
    res.json({ ok: true });
  }
);

catalogRouter.delete("/modifiers/:id", owned("modifier"), requireRole("owner", "manager"), async (req, res) => {
  await prisma.modifier.update({ where: { id: String(req.params.id) }, data: { active: false } });
  res.status(204).end();
});
