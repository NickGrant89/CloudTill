import { Router } from "express";
import { z } from "zod";
import {
  DEFAULT_TEXT_PAY_MESSAGE,
  TEXT_PAY_MESSAGE_KEY,
  TEXT_PAY_MESSAGE_MAX,
} from "@cloudtill/shared";
import { prisma } from "../db.js";
import { currencySymbol } from "../money.js";
import { isBuiltinTender, sortPaymentMethods } from "../paymentMethods.js";
import { owned } from "../tenant.js";
import { requireAuth, requireRole, type AuthedRequest } from "../auth.js";
import { normalizeOrderingDomain, orderingCnameTarget } from "../orderingHost.js";

const SECRET_IN_TEXT = /(sk_live_|sk_test_|whsec_|TWILIO_|STRIPE_SECRET|AUTH_TOKEN|\bAC[0-9a-f]{32}\b)/i;

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get("/", async (req: AuthedRequest, res) => {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: req.user!.storeId } });
  const settings = await prisma.setting.findMany({ where: { storeId: store.id } });
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  const taxes = await prisma.tax.findMany({ where: { storeId: store.id } });
  const paymentTypes = sortPaymentMethods(
    await prisma.paymentType.findMany({ where: { storeId: store.id } })
  );
  const registers = await prisma.register.findMany({ where: { storeId: store.id } });

  res.json({
    store: {
      id: store.id,
      name: store.name,
      address: store.address,
      phone: store.phone,
      currency: store.currency,
      timezone: store.timezone,
      slug: store.slug,
      listedPublicly: store.listedPublicly,
      customDomain: store.customDomain,
    },
    orderingHost: orderingCnameTarget(),
    currency: store.currency,
    currencySymbol: currencySymbol(store.currency),
    receipt: {
      header: map["receipt.header"] ?? store.name,
      footer: map["receipt.footer"] ?? "Thank you!",
      showLogo: map["receipt.showLogo"] !== "false",
      showTaxBreakdown: map["receipt.showTaxBreakdown"] !== "false",
      /** When false, till skips auto customer receipt after pay (reprint still available). */
      printCustomer: map["receipt.printCustomer"] !== "false",
    },
    tipPresetsPercent: JSON.parse(map["tips.presets"] ?? "[10,15,20]"),
    textPay: {
      message: (map[TEXT_PAY_MESSAGE_KEY] ?? "").trim() || DEFAULT_TEXT_PAY_MESSAGE,
    },
    taxes,
    paymentTypes,
    registers,
  });
});

settingsRouter.patch("/text-pay", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      message: z.string().trim().min(1).max(TEXT_PAY_MESSAGE_MAX),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Write the text the customer is sent (up to 320 characters)." });
  }
  if (SECRET_IN_TEXT.test(parsed.data.message)) {
    return res.status(400).json({
      error: "Save the customer text only. Card payments and texting are already set up — don't paste keys here.",
    });
  }
  await prisma.setting.upsert({
    where: { storeId_key: { storeId: req.user!.storeId, key: TEXT_PAY_MESSAGE_KEY } },
    create: { storeId: req.user!.storeId, key: TEXT_PAY_MESSAGE_KEY, value: parsed.data.message },
    update: { value: parsed.data.message },
  });
  res.json({ ok: true, message: parsed.data.message });
});

settingsRouter.patch("/store", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      name: z.string().optional(),
      address: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      currency: z.string().optional(),
      timezone: z.string().optional(),
      listedPublicly: z.boolean().optional(),
      customDomain: z.string().nullable().optional(),
    })
    .parse(req.body);

  let customDomain: string | null | undefined;
  if (body.customDomain !== undefined) {
    const normalized = normalizeOrderingDomain(body.customDomain);
    if ("error" in normalized) return res.status(400).json({ error: normalized.error });
    if (normalized.domain) {
      const taken = await prisma.store.findFirst({
        where: { customDomain: normalized.domain, NOT: { id: req.user!.storeId } },
        select: { id: true },
      });
      if (taken) return res.status(400).json({ error: "That domain is already used by another store" });
    }
    customDomain = normalized.domain;
  }

  const { customDomain: _ignored, ...details } = body;
  const store = await prisma.store.update({
    where: { id: req.user!.storeId },
    data: { ...details, ...(customDomain !== undefined ? { customDomain } : {}) },
  });
  res.json({ ...store, orderingHost: orderingCnameTarget() });
});

settingsRouter.patch("/receipt", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      header: z.string().optional(),
      footer: z.string().optional(),
      showTaxBreakdown: z.boolean().optional(),
      printCustomer: z.boolean().optional(),
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
  if (body.printCustomer !== undefined) {
    upserts.push(
      prisma.setting.upsert({
        where: { storeId_key: { storeId: req.user!.storeId, key: "receipt.printCustomer" } },
        create: {
          storeId: req.user!.storeId,
          key: "receipt.printCustomer",
          value: String(body.printCustomer),
        },
        update: { value: String(body.printCustomer) },
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

settingsRouter.patch("/taxes/:id", owned("tax"), requireRole("owner", "manager"), async (req, res) => {
  const id = String(req.params.id);
  const body = z
    .object({
      name: z.string().optional(),
      rateBps: z.number().int().optional(),
      inclusive: z.boolean().optional(),
      enabled: z.boolean().optional(),
    })
    .parse(req.body);
  const tax = await prisma.tax.update({ where: { id }, data: body });
  res.json(tax);
});

settingsRouter.delete("/taxes/:id", owned("tax"), requireRole("owner", "manager"), async (req, res) => {
  await prisma.tax.delete({ where: { id: String(req.params.id) } });
  res.json({ ok: true });
});

async function paymentNameTaken(storeId: string, name: string, exceptId?: string) {
  const key = name.trim().toLowerCase();
  const rows = await prisma.paymentType.findMany({
    where: { storeId },
    select: { id: true, name: true },
  });
  return rows.some((row) => row.id !== exceptId && row.name.trim().toLowerCase() === key);
}

settingsRouter.post("/payment-types", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(40),
      type: z.enum(["cash", "card", "other", "store_credit", "gift_card"]).optional(),
      opensDrawer: z.boolean().optional(),
      enabled: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Enter a payment method name (up to 40 characters)." });
  }
  const body = parsed.data;
  const type = body.type ?? "other";
  if (await paymentNameTaken(req.user!.storeId, body.name)) {
    return res.status(400).json({ error: "A payment method with that name already exists." });
  }
  const pt = await prisma.paymentType.create({
    data: {
      storeId: req.user!.storeId,
      name: body.name,
      type,
      opensDrawer: body.opensDrawer ?? type === "cash",
      enabled: body.enabled ?? true,
    },
  });
  res.status(201).json(pt);
});

settingsRouter.patch("/payment-types/:id", owned("paymentType"), requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(40).optional(),
      enabled: z.boolean().optional(),
      opensDrawer: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Enter a payment method name (up to 40 characters)." });
  }
  const body = parsed.data;
  const existing = await prisma.paymentType.findFirst({
    where: { id, storeId: req.user!.storeId },
  });
  if (!existing) return res.status(404).json({ error: "Payment method not found" });
  if (body.name && (await paymentNameTaken(existing.storeId, body.name, id))) {
    return res.status(400).json({ error: "A payment method with that name already exists." });
  }
  if (body.enabled === false && existing.enabled) {
    const others = await prisma.paymentType.count({
      where: { storeId: existing.storeId, enabled: true, NOT: { id } },
    });
    if (others === 0) {
      return res.status(400).json({ error: "Leave at least one payment method turned on." });
    }
  }
  const pt = await prisma.paymentType.update({ where: { id }, data: body });
  res.json(pt);
});

settingsRouter.delete("/payment-types/:id", owned("paymentType"), requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const existing = await prisma.paymentType.findFirst({
    where: { id, storeId: req.user!.storeId },
  });
  if (!existing) return res.status(404).json({ error: "Payment method not found" });
  if (isBuiltinTender(existing.type)) {
    return res.status(400).json({
      error: "Cash and Card stay in Settings so existing sales keep working. Turn the method off to hide it on the till.",
    });
  }
  if (existing.enabled) {
    const others = await prisma.paymentType.count({
      where: { storeId: existing.storeId, enabled: true, NOT: { id } },
    });
    if (others === 0) {
      return res.status(400).json({ error: "Leave at least one payment method turned on." });
    }
  }
  await prisma.paymentType.delete({ where: { id } });
  res.json({ ok: true });
});
