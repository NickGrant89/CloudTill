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

catalogRouter.get("/modifier-sets", async (req: AuthedRequest, res) => {
  const groups = await prisma.modifierGroup.findMany({
    where: { item: { storeId: req.user!.storeId, active: true } },
    include: {
      modifiers: { where: { active: true } },
      item: { select: { id: true, name: true } },
    },
    orderBy: { name: "asc" },
  });

  const byName = new Map<
    string,
    {
      name: string;
      minSelect: number;
      maxSelect: number;
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
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        options: group.modifiers.map((modifier) => ({ name: modifier.name, priceCents: modifier.priceCents })),
        assignments: [assignment],
      });
    } else {
      existing.assignments.push(assignment);
    }
  }

  res.json([...byName.values()]);
});

catalogRouter.post("/modifier-sets", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      name: z.string().min(1),
      minSelect: z.number().int().min(0).default(0),
      maxSelect: z.number().int().min(1).default(1),
      options: z.array(z.object({ name: z.string().min(1), priceCents: z.number().int() })).min(1),
      itemIds: z.array(z.string()).min(1),
    })
    .parse(req.body);

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
        modifiers: {
          create: body.options.map((option) => ({ name: option.name.trim(), priceCents: option.priceCents })),
        },
      },
    });
    created.push({ groupId: group.id, itemId: item.id, itemName: item.name });
  }

  res.status(201).json({ created, skipped });
});

catalogRouter.get("/items/:id/modifiers", async (req, res) => {
  const groups = await prisma.modifierGroup.findMany({
    where: { itemId: req.params.id },
    include: { modifiers: true },
    orderBy: { name: "asc" },
  });
  res.json(groups);
});

catalogRouter.post("/items/:id/modifier-groups", requireRole("owner", "manager"), async (req, res) => {
  const body = z
    .object({
      name: z.string().min(1),
      minSelect: z.number().int().optional(),
      maxSelect: z.number().int().optional(),
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
      modifiers: body.modifiers?.length
        ? { create: body.modifiers.map((m) => ({ name: m.name, priceCents: m.priceCents })) }
        : undefined,
    },
    include: { modifiers: true },
  });
  res.status(201).json(group);
});

catalogRouter.patch("/modifier-groups/:id", requireRole("owner", "manager"), async (req, res) => {
  const body = z
    .object({
      name: z.string().optional(),
      minSelect: z.number().int().optional(),
      maxSelect: z.number().int().optional(),
    })
    .parse(req.body);
  const group = await prisma.modifierGroup.update({
    where: { id: req.params.id },
    data: body,
    include: { modifiers: true },
  });
  res.json(group);
});

catalogRouter.delete("/modifier-groups/:id", requireRole("owner", "manager"), async (req, res) => {
  await prisma.modifier.deleteMany({ where: { groupId: req.params.id } });
  await prisma.modifierGroup.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

catalogRouter.post("/modifier-groups/:id/modifiers", requireRole("owner", "manager"), async (req, res) => {
  const body = z
    .object({ name: z.string().min(1), priceCents: z.number().int().default(0) })
    .parse(req.body);
  const mod = await prisma.modifier.create({
    data: { groupId: req.params.id, name: body.name, priceCents: body.priceCents },
  });
  res.status(201).json(mod);
});

catalogRouter.patch("/modifiers/:id", requireRole("owner", "manager"), async (req, res) => {
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

catalogRouter.delete("/modifiers/:id", requireRole("owner", "manager"), async (req, res) => {
  await prisma.modifier.update({ where: { id: req.params.id }, data: { active: false } });
  res.status(204).end();
});
