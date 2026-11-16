import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole, type AuthedRequest } from "../auth.js";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get("/", async (req: AuthedRequest, res) => {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: req.user!.storeId } });
  const settings = await prisma.setting.findMany({ where: { storeId: store.id } });
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  const taxes = await prisma.tax.findMany({ where: { storeId: store.id } });
  const paymentTypes = await prisma.paymentType.findMany({ where: { storeId: store.id } });
  const registers = await prisma.register.findMany({ where: { storeId: store.id } });

  res.json({
    store: {
      id: store.id,
      name: store.name,
      address: store.address,
      phone: store.phone,
      currency: store.currency,
      timezone: store.timezone,
    },
    currency: store.currency,
    currencySymbol: store.currency === "USD" ? "$" : store.currency,
    receipt: {
      header: map["receipt.header"] ?? store.name,
      footer: map["receipt.footer"] ?? "Thank you!",
      showLogo: map["receipt.showLogo"] !== "false",
      showTaxBreakdown: map["receipt.showTaxBreakdown"] !== "false",
    },
    tipPresetsPercent: JSON.parse(map["tips.presets"] ?? "[10,15,20]"),
    taxes,
    paymentTypes,
    registers,
  });
});

settingsRouter.patch("/store", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      name: z.string().optional(),
      address: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      currency: z.string().optional(),
      timezone: z.string().optional(),
    })
    .parse(req.body);
  const store = await prisma.store.update({ where: { id: req.user!.storeId }, data: body });
  res.json(store);
});

settingsRouter.patch("/receipt", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      header: z.string().optional(),
      footer: z.string().optional(),
      showTaxBreakdown: z.boolean().optional(),
    })
    .parse(req.body);

  const upserts: Promise<unknown>[] = [];
  if (body.header !== undefined) {
    upserts.push(
      prisma.setting.upsert({
        where: { storeId_key: { storeId: req.user!.storeId, key: "receipt.header" } },
        create: { storeId: req.user!.storeId, key: "receipt.header", value: body.header },
        update: { value: body.header },
      })
    );
  }
  if (body.footer !== undefined) {
    upserts.push(
      prisma.setting.upsert({
        where: { storeId_key: { storeId: req.user!.storeId, key: "receipt.footer" } },
        create: { storeId: req.user!.storeId, key: "receipt.footer", value: body.footer },
        update: { value: body.footer },
      })
    );
  }
  if (body.showTaxBreakdown !== undefined) {
    upserts.push(
      prisma.setting.upsert({
        where: { storeId_key: { storeId: req.user!.storeId, key: "receipt.showTaxBreakdown" } },
        create: {
          storeId: req.user!.storeId,
          key: "receipt.showTaxBreakdown",
          value: String(body.showTaxBreakdown),
        },
        update: { value: String(body.showTaxBreakdown) },
      })
    );
  }
  await Promise.all(upserts);
  res.json({ ok: true });
});

settingsRouter.post("/taxes", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      name: z.string(),
      rateBps: z.number().int(),
      inclusive: z.boolean().optional(),
      enabled: z.boolean().optional(),
    })
    .parse(req.body);
  const tax = await prisma.tax.create({
    data: {
      storeId: req.user!.storeId,
      name: body.name,
      rateBps: body.rateBps,
      inclusive: body.inclusive ?? false,
      enabled: body.enabled ?? true,
    },
  });
  res.status(201).json(tax);
});

settingsRouter.patch("/taxes/:id", requireRole("owner", "manager"), async (req, res) => {
  const body = z
    .object({
      name: z.string().optional(),
      rateBps: z.number().int().optional(),
      inclusive: z.boolean().optional(),
      enabled: z.boolean().optional(),
    })
    .parse(req.body);
  const tax = await prisma.tax.update({ where: { id: req.params.id }, data: body });
  res.json(tax);
});

settingsRouter.post("/payment-types", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      name: z.string(),
      type: z.enum(["cash", "card", "other", "store_credit", "gift_card"]),
      opensDrawer: z.boolean().optional(),
      enabled: z.boolean().optional(),
    })
    .parse(req.body);
  const pt = await prisma.paymentType.create({
    data: {
      storeId: req.user!.storeId,
      name: body.name,
      type: body.type,
      opensDrawer: body.opensDrawer ?? body.type === "cash",
      enabled: body.enabled ?? true,
    },
  });
  res.status(201).json(pt);
});

settingsRouter.patch("/payment-types/:id", requireRole("owner", "manager"), async (req, res) => {
  const body = z
    .object({
      name: z.string().optional(),
      enabled: z.boolean().optional(),
      opensDrawer: z.boolean().optional(),
    })
    .parse(req.body);
  const pt = await prisma.paymentType.update({ where: { id: req.params.id }, data: body });
  res.json(pt);
});
