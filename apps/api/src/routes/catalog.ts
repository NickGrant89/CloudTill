import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole, type AuthedRequest } from "../auth.js";

export const catalogRouter = Router();
catalogRouter.use(requireAuth);

catalogRouter.get("/categories", async (req: AuthedRequest, res) => {
  const cats = await prisma.category.findMany({
    where: { storeId: req.user!.storeId },
    orderBy: { sortOrder: "asc" },
  });
  res.json(cats);
});

catalogRouter.post("/categories", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({ name: z.string().min(1), color: z.string().optional(), sortOrder: z.number().optional() })
    .parse(req.body);
  const cat = await prisma.category.create({
    data: { storeId: req.user!.storeId, name: body.name, color: body.color ?? "#2F6F4E", sortOrder: body.sortOrder ?? 0 },
  });
  res.status(201).json(cat);
});

catalogRouter.patch("/categories/:id", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z.object({ name: z.string().optional(), color: z.string().optional(), sortOrder: z.number().optional() }).parse(req.body);
  const cat = await prisma.category.update({ where: { id: req.params.id }, data: body });
  res.json(cat);
});

catalogRouter.delete("/categories/:id", requireRole("owner", "manager"), async (req, res) => {
  await prisma.category.delete({ where: { id: req.params.id } });
  res.status(204).end();
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
      modifierGroups: { include: { modifiers: { where: { active: true } } } },
      kitComponents: true,
    },
    orderBy: { name: "asc" },
  });

  const levels = await prisma.inventoryLevel.findMany({ where: { storeId } });
  const levelMap = new Map(levels.map((l) => [`${l.variantId}`, l]));

  const mapped = items.map((item) => ({
    ...item,
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
            options: z.array(z.object({ name: z.string(), priceCents: z.number().int() })),
          })
        )
        .optional(),
    })
    .parse(req.body);

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
    for (const g of body.modifiers) {
      await prisma.modifierGroup.create({
        data: {
          itemId: item.id,
          name: g.name,
          minSelect: g.minSelect ?? 0,
          maxSelect: g.maxSelect ?? 1,
          modifiers: { create: g.options.map((o) => ({ name: o.name, priceCents: o.priceCents })) },
        },
      });
    }
  }

  const full = await prisma.item.findUnique({
    where: { id: item.id },
    include: {
      variants: true,
      modifierGroups: { include: { modifiers: true } },
    },
  });
  res.status(201).json(full);
});

catalogRouter.patch("/items/:id", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
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
    include: { variants: true, modifierGroups: { include: { modifiers: true } } },
  });
  res.json(full);
});

catalogRouter.delete("/items/:id", requireRole("owner", "manager"), async (req, res) => {
  await prisma.item.update({ where: { id: req.params.id }, data: { active: false } });
  res.status(204).end();
});
