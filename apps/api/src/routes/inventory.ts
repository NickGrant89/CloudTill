import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole, type AuthedRequest } from "../auth.js";

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

inventoryRouter.get("/levels", async (req: AuthedRequest, res) => {
  const lowOnly = req.query.low === "1" || req.query.low === "true";
  const storeParam = typeof req.query.storeId === "string" ? req.query.storeId : "all";
  const storeFilter =
    storeParam === "all" ? undefined : storeParam === "current" ? req.user!.storeId : storeParam;

  const levels = await prisma.inventoryLevel.findMany({
    where: storeFilter ? { storeId: storeFilter } : undefined,
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
