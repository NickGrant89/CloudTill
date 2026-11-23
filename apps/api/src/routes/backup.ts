import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole, type AuthedRequest } from "../auth.js";

export const backupRouter = Router();
backupRouter.use(requireAuth);

const BACKUP_KIND = "purepos-store-backup";
const BACKUP_VERSION = 1;

async function buildStoreBackup(storeId: string) {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const [
    registers,
    categories,
    items,
    taxes,
    paymentTypes,
    settings,
    inventoryLevels,
    customers,
    employees,
    giftCards,
    openTickets,
    salesCount,
  ] = await Promise.all([
    prisma.register.findMany({ where: { storeId }, orderBy: { name: "asc" } }),
    prisma.category.findMany({ where: { storeId }, orderBy: { sortOrder: "asc" } }),
    prisma.item.findMany({
      where: { storeId },
      include: {
        variants: true,
        modifierGroups: { include: { modifiers: true } },
        kitComponents: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.tax.findMany({ where: { storeId } }),
    prisma.paymentType.findMany({ where: { storeId } }),
    prisma.setting.findMany({ where: { storeId } }),
    prisma.inventoryLevel.findMany({ where: { storeId } }),
    prisma.customer.findMany({ where: { storeId } }),
    prisma.employee.findMany({
      where: { storeId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        pinHash: true,
        pinDisplay: true,
        active: true,
        createdAt: true,
      },
    }),
    prisma.giftCard.findMany({ where: { storeId } }),
    prisma.ticket.findMany({
      where: { storeId, status: { in: ["open", "held"] } },
      include: { lines: true },
    }),
    prisma.sale.count({ where: { storeId } }),
  ]);

  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    product: "PurePOS",
    note:
      "Store backup for till/catalog restore. Unsynced offline till queues are separate — use till Export while Sync shows a count.",
    store: {
      id: store.id,
      slug: store.slug,
      name: store.name,
      address: store.address,
      phone: store.phone,
      currency: store.currency,
      timezone: store.timezone,
    },
    registers,
    categories,
    items,
    taxes,
    paymentTypes,
    settings,
    inventoryLevels,
    customers,
    employees,
    giftCards,
    openTickets,
    meta: {
      salesCount,
      itemCount: items.length,
      categoryCount: categories.length,
      customerCount: customers.length,
      openTicketCount: openTickets.length,
    },
  };
}

backupRouter.get("/backup", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const backup = await buildStoreBackup(req.user!.storeId);
  const filename = `purepos-backup-${backup.store.slug}-${backup.exportedAt.slice(0, 10)}.json`;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.json(backup);
});

backupRouter.post("/restore", requireRole("owner"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      backup: z.unknown(),
      mode: z.enum(["catalog", "catalog_customers"]).default("catalog"),
      confirm: z.literal(true),
    })
    .safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({
      error: "Provide { backup, mode, confirm: true }. mode = catalog | catalog_customers",
    });
  }

  const raw = body.data.backup as Record<string, unknown>;
  if (!raw || raw.kind !== BACKUP_KIND || Number(raw.version) !== BACKUP_VERSION) {
    return res.status(400).json({ error: "Not a PurePOS store backup (kind/version mismatch)" });
  }

  const storeId = req.user!.storeId;
  const categories = Array.isArray(raw.categories) ? (raw.categories as Array<Record<string, unknown>>) : [];
  const items = Array.isArray(raw.items) ? (raw.items as Array<Record<string, unknown>>) : [];
  const taxes = Array.isArray(raw.taxes) ? (raw.taxes as Array<Record<string, unknown>>) : [];
  const paymentTypes = Array.isArray(raw.paymentTypes)
    ? (raw.paymentTypes as Array<Record<string, unknown>>)
    : [];
  const settings = Array.isArray(raw.settings) ? (raw.settings as Array<Record<string, unknown>>) : [];
  const inventoryLevels = Array.isArray(raw.inventoryLevels)
    ? (raw.inventoryLevels as Array<Record<string, unknown>>)
    : [];
  const customers = Array.isArray(raw.customers) ? (raw.customers as Array<Record<string, unknown>>) : [];

  // Detach sale lines from variants so catalog can be replaced safely.
  const variantIds = (
    await prisma.variant.findMany({
      where: { item: { storeId } },
      select: { id: true },
    })
  ).map((v) => v.id);
  if (variantIds.length) {
    await prisma.saleLine.updateMany({
      where: { variantId: { in: variantIds } },
      data: { variantId: null },
    });
    await prisma.inventoryTransfer.deleteMany({ where: { variantId: { in: variantIds } } });
  }

  await prisma.ticket.deleteMany({ where: { storeId, status: { in: ["open", "held"] } } });
  await prisma.inventoryMovement.deleteMany({ where: { storeId } });
  await prisma.inventoryLevel.deleteMany({ where: { storeId } });
  await prisma.item.deleteMany({ where: { storeId } });
  await prisma.category.deleteMany({ where: { storeId } });

  const categoryIdMap = new Map<string, string>();
  for (const cat of categories) {
    const created = await prisma.category.create({
      data: {
        storeId,
        name: String(cat.name || "Group"),
        color: String(cat.color || "#2F6F4E"),
        sortOrder: Number(cat.sortOrder ?? 0),
      },
    });
    if (typeof cat.id === "string") categoryIdMap.set(cat.id, created.id);
  }

  const variantIdMap = new Map<string, string>();
  const itemIdMap = new Map<string, string>();
  for (const item of items) {
    const oldCategoryId = typeof item.categoryId === "string" ? item.categoryId : null;
    const createdItem = await prisma.item.create({
      data: {
        storeId,
        name: String(item.name || "Item"),
        description: (item.description as string | null) ?? null,
        color: String(item.color || "#3D5A4C"),
        soldBy: String(item.soldBy || "each"),
        isComposite: Boolean(item.isComposite),
        active: item.active === false ? false : true,
        categoryId: oldCategoryId ? categoryIdMap.get(oldCategoryId) ?? null : null,
      },
    });
    if (typeof item.id === "string") itemIdMap.set(item.id, createdItem.id);

    const variants = Array.isArray(item.variants) ? (item.variants as Array<Record<string, unknown>>) : [];
    for (const v of variants) {
      const createdVariant = await prisma.variant.create({
        data: {
          itemId: createdItem.id,
          name: String(v.name || "Regular"),
          sku: String(v.sku || `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
          barcode: (v.barcode as string | null) ?? null,
          priceCents: Number(v.priceCents ?? 0),
          costCents: Number(v.costCents ?? 0),
          trackStock: v.trackStock === false ? false : true,
          active: v.active === false ? false : true,
        },
      });
      if (typeof v.id === "string") variantIdMap.set(v.id, createdVariant.id);
    }

    const groups = Array.isArray(item.modifierGroups)
      ? (item.modifierGroups as Array<Record<string, unknown>>)
      : [];
    for (const g of groups) {
      const mods = Array.isArray(g.modifiers) ? (g.modifiers as Array<Record<string, unknown>>) : [];
      await prisma.modifierGroup.create({
        data: {
          itemId: createdItem.id,
          name: String(g.name || "Options"),
          minSelect: Number(g.minSelect ?? 0),
          maxSelect: Number(g.maxSelect ?? 1),
          sortOrder: Number(g.sortOrder ?? 0),
          modifiers: {
            create: mods.map((m, index) => ({
              name: String(m.name || "Option"),
              priceCents: Number(m.priceCents ?? 0),
              active: m.active === false ? false : true,
              sortOrder: Number(m.sortOrder ?? index),
            })),
          },
        },
      });
    }
  }

  // Second pass: kit recipes need all variants remapped.
  for (const item of items) {
    const oldItemId = typeof item.id === "string" ? item.id : "";
    const newParentId = itemIdMap.get(oldItemId);
    if (!newParentId) continue;
    const kits = Array.isArray(item.kitComponents)
      ? (item.kitComponents as Array<Record<string, unknown>>)
      : [];
    for (const kc of kits) {
      const oldVarId = typeof kc.componentVarId === "string" ? kc.componentVarId : "";
      const newVarId = variantIdMap.get(oldVarId);
      if (!newVarId) continue;
      await prisma.kitComponent.create({
        data: {
          parentItemId: newParentId,
          componentVarId: newVarId,
          quantity: Number(kc.quantity ?? 1),
        },
      });
    }
  }

  for (const level of inventoryLevels) {
    const oldVariantId = typeof level.variantId === "string" ? level.variantId : "";
    const newVariantId = variantIdMap.get(oldVariantId);
    if (!newVariantId) continue;
    await prisma.inventoryLevel.create({
      data: {
        storeId,
        variantId: newVariantId,
        quantity: Number(level.quantity ?? 0),
        lowStock: Number(level.lowStock ?? 5),
      },
    });
  }

  for (const tax of taxes) {
    const name = String(tax.name || "VAT");
    const existing = await prisma.tax.findFirst({ where: { storeId, name } });
    const data = {
      rateBps: Number(tax.rateBps ?? 2000),
      inclusive: Boolean(tax.inclusive),
      enabled: tax.enabled === false ? false : true,
    };
    if (existing) await prisma.tax.update({ where: { id: existing.id }, data });
    else await prisma.tax.create({ data: { storeId, name, ...data } });
  }

  for (const pt of paymentTypes) {
    const name = String(pt.name || "Cash");
    const existing = await prisma.paymentType.findFirst({ where: { storeId, name } });
    const data = {
      type: String(pt.type || "cash"),
      enabled: pt.enabled === false ? false : true,
      opensDrawer: Boolean(pt.opensDrawer),
    };
    if (existing) await prisma.paymentType.update({ where: { id: existing.id }, data });
    else await prisma.paymentType.create({ data: { storeId, name, ...data } });
  }

  for (const setting of settings) {
    const key = String(setting.key || "");
    if (!key) continue;
    const value = String(setting.value ?? "");
    await prisma.setting.upsert({
      where: { storeId_key: { storeId, key } },
      create: { storeId, key, value },
      update: { value },
    });
  }

  let customersRestored = 0;
  if (body.data.mode === "catalog_customers") {
    for (const c of customers) {
      const email = typeof c.email === "string" && c.email ? c.email : null;
      if (email) {
        const existing = await prisma.customer.findFirst({ where: { storeId, email } });
        if (existing) {
          await prisma.customer.update({
            where: { id: existing.id },
            data: {
              name: String(c.name || existing.name),
              phone: (c.phone as string | null) ?? existing.phone,
              storeCreditCents: Number(c.storeCreditCents ?? existing.storeCreditCents),
              loyaltyPoints: Number(c.loyaltyPoints ?? existing.loyaltyPoints),
            },
          });
          customersRestored += 1;
          continue;
        }
      }
      await prisma.customer.create({
        data: {
          storeId,
          name: String(c.name || "Customer"),
          email,
          phone: (c.phone as string | null) ?? null,
          storeCreditCents: Number(c.storeCreditCents ?? 0),
          loyaltyPoints: Number(c.loyaltyPoints ?? 0),
        },
      });
      customersRestored += 1;
    }
  }

  const storeMeta = raw.store as { name?: string; address?: string; phone?: string } | undefined;
  if (storeMeta?.name) {
    await prisma.store.update({
      where: { id: storeId },
      data: {
        name: storeMeta.name,
        address: storeMeta.address ?? undefined,
        phone: storeMeta.phone ?? undefined,
      },
    });
  }

  res.json({
    ok: true,
    message: `Restored catalog (${items.length} items, ${categories.length} groups)${
      body.data.mode === "catalog_customers" ? ` · ${customersRestored} customers` : ""
    }. Open tills were cleared — staff should refresh.`,
    restored: {
      categories: categories.length,
      items: items.length,
      inventoryLevels: inventoryLevels.length,
      taxes: taxes.length,
      paymentTypes: paymentTypes.length,
      settings: settings.length,
      customers: customersRestored,
    },
  });
});
