import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole, type AuthedRequest } from "../auth.js";
import { storeAllowsFeature } from "./billing.js";
import { companyStoreIds, sameCompany } from "../company.js";
import { allOwned, rejectForeign } from "../tenant.js";

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

inventoryRouter.get("/levels", async (req: AuthedRequest, res) => {
  const lowOnly = req.query.low === "1" || req.query.low === "true";
  const storeParam = typeof req.query.storeId === "string" ? req.query.storeId : "all";
  const companyIds = await companyStoreIds(req.user!.storeId);
  const storeFilter =
    storeParam === "all" ? undefined : storeParam === "current" ? req.user!.storeId : storeParam;
  if (storeFilter && !companyIds.includes(storeFilter)) {
    return res.status(403).json({ error: "That store is not part of your business" });
  }

  const levels = await prisma.inventoryLevel.findMany({
    where: storeFilter ? { storeId: storeFilter } : { storeId: { in: companyIds } },
    include: {
      variant: { include: { item: { include: { category: true } } } },
      store: true,
    },
  });

  let rows = levels.map((l) => ({
    id: l.id,
    storeId: l.storeId,
    storeName: l.store.name,
    variantId: l.variantId,
    itemName: l.variant.item.name,
    variantName: l.variant.name,
    sku: l.variant.sku,
    barcode: l.variant.barcode,
    category: l.variant.item.category?.name ?? null,
    quantity: l.quantity,
    lowStock: l.lowStock,
    trackStock: l.variant.trackStock,
    isLow: l.variant.trackStock && l.quantity <= l.lowStock,
  }));

  if (lowOnly) rows = rows.filter((r) => r.isLow);
  res.json(rows);
});

inventoryRouter.post("/receive", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      variantId: z.string(),
      quantity: z.number().positive(),
      note: z.string().optional(),
      storeId: z.string().optional(),
    })
    .parse(req.body);

  const storeId = body.storeId ?? req.user!.storeId;
  if (!(await sameCompany(req.user!.storeId, [storeId]))) {
    return res.status(403).json({ error: "That store is not part of your business" });
  }
  if (await rejectForeign(res, "variant", [body.variantId], storeId)) return;
  const level = await prisma.inventoryLevel.findUnique({
    where: { storeId_variantId: { storeId, variantId: body.variantId } },
  });

  let updated;
  if (level) {
    updated = await prisma.inventoryLevel.update({
      where: { id: level.id },
      data: { quantity: level.quantity + body.quantity },
    });
  } else {
    updated = await prisma.inventoryLevel.create({
      data: { storeId, variantId: body.variantId, quantity: body.quantity },
    });
  }

  await prisma.inventoryMovement.create({
    data: {
      storeId,
      variantId: body.variantId,
      type: "receive",
      quantity: body.quantity,
      note: body.note ?? "Stock receive",
      employeeId: req.user!.sub,
    },
  });

  res.status(201).json(updated);
});

inventoryRouter.post("/adjust", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      variantId: z.string(),
      quantity: z.number(),
      note: z.string().optional(),
    })
    .parse(req.body);

  const storeId = req.user!.storeId;
  if (await rejectForeign(res, "variant", [body.variantId], storeId)) return;
  const level = await prisma.inventoryLevel.findUniqueOrThrow({
    where: { storeId_variantId: { storeId, variantId: body.variantId } },
  });
  const updated = await prisma.inventoryLevel.update({
    where: { id: level.id },
    data: { quantity: body.quantity },
  });
  await prisma.inventoryMovement.create({
    data: {
      storeId,
      variantId: body.variantId,
      type: "adjust",
      quantity: body.quantity - level.quantity,
      note: body.note ?? "Manual adjust",
      employeeId: req.user!.sub,
    },
  });
  res.json(updated);
});

inventoryRouter.get("/history", async (req: AuthedRequest, res) => {
  const variantId = typeof req.query.variantId === "string" ? req.query.variantId : undefined;
  const movements = await prisma.inventoryMovement.findMany({
    where: {
      storeId: req.user!.storeId,
      ...(variantId ? { variantId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(movements);
});

inventoryRouter.get("/transfers", async (req: AuthedRequest, res) => {
  const transfers = await prisma.inventoryTransfer.findMany({
    where: {
      OR: [{ fromStoreId: req.user!.storeId }, { toStoreId: req.user!.storeId }],
    },
    include: {
      fromStore: true,
      toStore: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const variantIds = [...new Set(transfers.map((t) => t.variantId))];
  const variants = await prisma.variant.findMany({
    where: { id: { in: variantIds } },
    include: { item: true },
  });
  const vMap = new Map(variants.map((v) => [v.id, v]));
  res.json(
    transfers.map((t) => ({
      id: t.id,
      fromStoreId: t.fromStoreId,
      fromStoreName: t.fromStore.name,
      toStoreId: t.toStoreId,
      toStoreName: t.toStore.name,
      variantId: t.variantId,
      itemName: vMap.get(t.variantId)?.item.name ?? t.variantId,
      sku: vMap.get(t.variantId)?.sku ?? "",
      quantity: t.quantity,
      status: t.status,
      note: t.note,
      employeeId: t.employeeId,
      createdAt: t.createdAt.toISOString(),
    }))
  );
});

inventoryRouter.post("/transfers", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  if (!(await storeAllowsFeature(req.user!.storeId, "multi_store"))) {
    return res.status(402).json({
      error: "Multi-store transfers require the Multi plan. Upgrade under Settings → Billing.",
      feature: "multi_store",
    });
  }
  const body = z
    .object({
      fromStoreId: z.string(),
      toStoreId: z.string(),
      variantId: z.string(),
      quantity: z.number().positive(),
      note: z.string().optional(),
    })
    .parse(req.body);

  if (body.fromStoreId === body.toStoreId) {
    return res.status(400).json({ error: "from and to stores must differ" });
  }
  if (!(await sameCompany(req.user!.storeId, [body.fromStoreId, body.toStoreId]))) {
    return res.status(403).json({ error: "Transfers are only allowed between your own branches" });
  }
  const onFrom = await allOwned("variant", [body.variantId], body.fromStoreId);
  const onTo = await allOwned("variant", [body.variantId], body.toStoreId);
  if (!onFrom && !onTo) return res.status(404).json({ error: "Not found" });

  const fromLevel = await prisma.inventoryLevel.findUnique({
    where: { storeId_variantId: { storeId: body.fromStoreId, variantId: body.variantId } },
  });
  if (!fromLevel || fromLevel.quantity < body.quantity) {
    return res.status(400).json({ error: "Insufficient stock at source store" });
  }

  await prisma.inventoryLevel.update({
    where: { id: fromLevel.id },
    data: { quantity: fromLevel.quantity - body.quantity },
  });

  const toLevel = await prisma.inventoryLevel.findUnique({
    where: { storeId_variantId: { storeId: body.toStoreId, variantId: body.variantId } },
  });
  if (toLevel) {
    await prisma.inventoryLevel.update({
      where: { id: toLevel.id },
      data: { quantity: toLevel.quantity + body.quantity },
    });
  } else {
    await prisma.inventoryLevel.create({
      data: { storeId: body.toStoreId, variantId: body.variantId, quantity: body.quantity },
    });
  }

  await prisma.inventoryMovement.createMany({
    data: [
      {
        storeId: body.fromStoreId,
        variantId: body.variantId,
        type: "transfer",
        quantity: -body.quantity,
        note: body.note ?? `Transfer to ${body.toStoreId}`,
        employeeId: req.user!.sub,
      },
      {
        storeId: body.toStoreId,
        variantId: body.variantId,
        type: "transfer",
        quantity: body.quantity,
        note: body.note ?? `Transfer from ${body.fromStoreId}`,
        employeeId: req.user!.sub,
      },
    ],
  });

  const transfer = await prisma.inventoryTransfer.create({
    data: {
      fromStoreId: body.fromStoreId,
      toStoreId: body.toStoreId,
      variantId: body.variantId,
      quantity: body.quantity,
      status: "completed",
      note: body.note,
      employeeId: req.user!.sub,
    },
    include: { fromStore: true, toStore: true },
  });

  res.status(201).json({
    id: transfer.id,
    fromStoreName: transfer.fromStore.name,
    toStoreName: transfer.toStore.name,
    variantId: transfer.variantId,
    quantity: transfer.quantity,
    status: transfer.status,
    createdAt: transfer.createdAt.toISOString(),
  });
});
