import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { receiptModifierLines } from "@cloudtill/shared";
import { buildKitchenTicketText, queueKitchenPrintJob } from "../kitchenTicket.js";
import { owned } from "../tenant.js";
import { soldOutItemIds } from "../services/soldOut.js";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { calcTax, lineSubtotal } from "../money.js";
import { storeAllowsFeature } from "./billing.js";
import { attributionEmployee } from "../company.js";
import { randomBytes } from "node:crypto";
import {
  deliveryFeeFor,
  estimateLabel,
  fulfillmentEnabled,
  isPaused,
  orderingSettingsSchema,
  publicOrderingInfo,
  readOrderingSettings,
  writeOrderingSettings,
} from "../services/orderingSettings.js";

export const publicOrderingRouter = Router();
export const kitchenRouter = Router();

async function resolveStore(slugOrId: string) {
  return prisma.store.findFirst({
    where: { OR: [{ slug: slugOrId }, { id: slugOrId }] },
  });
}

publicOrderingRouter.get("/stores", async (_req, res) => {
  const stores = await prisma.store.findMany({
    where: { listedPublicly: true },
    select: { id: true, slug: true, name: true, address: true, phone: true, currency: true },
    orderBy: { name: "asc" },
  });
  res.json(stores);
});

/** Best sellers by quantity over the last 30 days. */
async function popularItemIds(storeId: string, limit = 6) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.saleLine.groupBy({
    by: ["variantId"],
    where: { variantId: { not: null }, sale: { storeId, status: "completed", createdAt: { gte: since } } },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: limit * 3,
  });
  const variants = await prisma.variant.findMany({
    where: { id: { in: rows.map((r) => r.variantId!).filter(Boolean) } },
    select: { id: true, itemId: true },
  });
  const itemOf = new Map(variants.map((v) => [v.id, v.itemId]));
  const ordered: string[] = [];
  for (const r of rows) {
    const itemId = r.variantId ? itemOf.get(r.variantId) : undefined;
    if (itemId && !ordered.includes(itemId)) ordered.push(itemId);
  }
  return ordered.slice(0, limit);
}

publicOrderingRouter.get("/stores/:slug/menu", async (req, res) => {
  const store = await resolveStore(req.params.slug);
  if (!store) return res.status(404).json({ error: "Store not found" });

  const [categories, items, tax, settings, soldOut, popular] = await Promise.all([
    prisma.category.findMany({ where: { storeId: store.id }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.item.findMany({
      where: { storeId: store.id, active: true },
      include: {
        variants: { where: { active: true } },
        modifierGroups: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          include: {
            modifiers: { where: { active: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
          },
        },
      },
      orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }],
    }),
    prisma.tax.findFirst({ where: { storeId: store.id, enabled: true } }),
    readOrderingSettings(store.id),
    soldOutItemIds(store.id),
    popularItemIds(store.id),
  ]);

  res.json({
    store: {
      id: store.id,
      slug: store.slug,
      name: store.name,
      address: store.address,
      phone: store.phone,
      currency: store.currency,
    },
    tax,
    categories,
    items: items.map((item) => ({
      ...item,
      soldOut: soldOut.has(item.id),
      modifierGroups: item.modifierGroups.filter((group) => group.modifiers.length > 0),
    })),
    popularItemIds: popular,
    ordering: publicOrderingInfo(settings),
    delivery: {
      feeCents: settings.deliveryFeeCents,
      freeAboveCents: settings.freeDeliveryAboveCents,
      estimateMinutes: estimateLabel(settings, "delivery"),
    },
  });
});

publicOrderingRouter.post("/stores/:slug/orders", async (req, res) => {
  const store = await resolveStore(req.params.slug);
  if (!store) return res.status(404).json({ error: "Store not found" });
  if (!(await storeAllowsFeature(store.id, "online_ordering"))) {
    return res.status(402).json({ error: "Online ordering needs an active Shop or Group plan. Upgrade in Settings → Billing." });
  }

  const body = z
    .object({
      customerName: z.string().min(1),
      customerPhone: z.string().optional(),
      customerEmail: z.string().email().optional(),
      fulfillment: z.enum(["pickup", "dine_in", "delivery"]).default("pickup"),
      deliveryAddress: z.string().optional(),
      deliveryUnit: z.string().optional(),
      deliveryInstructions: z.string().optional(),
      note: z.string().optional(),
      card: z.object({
        name: z.string().min(1),
        number: z.string().min(12),
        expMonth: z.number().int().min(1).max(12),
        expYear: z.number().int(),
        cvc: z.string().min(3).max(4),
      }),
      lines: z
        .array(
          z.object({
            variantId: z.string(),
            quantity: z.number().int().min(1).max(99).default(1),
            modifiers: z
              .array(z.object({ id: z.string().optional(), name: z.string(), priceCents: z.number().int().optional() }))
              .max(30)
              .optional(),
            note: z.string().max(200).optional(),
          })
        )
        .min(1)
        .max(60),
    })
    .parse(req.body);

  const settings = await readOrderingSettings(store.id);
  if (isPaused(settings)) {
    const until = settings.pausedUntil !== "off" ? new Date(settings.pausedUntil) : null;
    return res.status(409).json({
      error: until
        ? `${store.name} has paused online orders until ${until.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: store.timezone || "Europe/London" })}.`
        : `${store.name} isn't taking online orders right now.`,
    });
  }
  if (!fulfillmentEnabled(settings, body.fulfillment)) {
    const label = body.fulfillment === "dine_in" ? "Dine in" : body.fulfillment === "delivery" ? "Delivery" : "Pickup";
    return res.status(409).json({ error: `${label} isn't available right now. Choose another option.` });
  }
  const soldOut = await soldOutItemIds(store.id);

  if (body.fulfillment === "delivery") {
    if (!body.deliveryAddress?.trim()) {
      return res.status(400).json({ error: "Delivery address is required" });
    }
    if (!body.customerPhone?.trim()) {
      return res.status(400).json({ error: "Phone is required for delivery" });
    }
  }

  const card = authorizeCard(body.card);
  if ("error" in card) return res.status(400).json({ error: card.error });

  const employee = await attributionEmployee(store.id);
  const cardType = await prisma.paymentType.findFirst({
    where: { storeId: store.id, type: "card", enabled: true },
  });
  if (!employee || !cardType) {
    return res.status(400).json({ error: "Card payments aren't set up for this café." });
  }

  const register =
    (await prisma.register.findFirst({ where: { storeId: store.id, name: { contains: "Front" } } })) ??
    (await prisma.register.findFirst({ where: { storeId: store.id } }));
  if (!register) return res.status(400).json({ error: "No register configured" });

  const tax = await prisma.tax.findFirst({ where: { storeId: store.id, enabled: true } });
  let subtotal = 0;
  const resolvedLines: {
    variantId: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    modifiersJson: string;
    note?: string;
  }[] = [];

  for (const line of body.lines) {
    const variant = await prisma.variant.findUnique({
      where: { id: line.variantId },
      include: {
        item: { include: { modifierGroups: { include: { modifiers: { where: { active: true } } } } } },
      },
    });
    if (!variant || variant.item.storeId !== store.id || !variant.active || !variant.item.active) {
      return res.status(400).json({ error: "Something in your basket is no longer on the menu. Please remove it." });
    }
    if (soldOut.has(variant.itemId)) {
      return res.status(409).json({ error: `Sorry, ${variant.item.name} has just sold out. Please remove it.` });
    }
    const allowed = variant.item.modifierGroups.flatMap((group) =>
      group.modifiers.map((modifier) => ({ ...modifier, groupName: group.name, groupOrder: group.sortOrder }))
    );
    const mods: { name: string; priceCents: number; groupName?: string; groupOrder: number; optionOrder: number; groupId: string }[] = [];
    for (const m of line.modifiers ?? []) {
      const match = allowed.find((a) => (m.id ? a.id === m.id : a.name === m.name));
      if (!match) {
        return res.status(400).json({ error: `"${m.name}" isn't available for ${variant.item.name} any more.` });
      }
      mods.push({
        name: match.name,
        priceCents: match.priceCents,
        groupName: match.groupName,
        groupOrder: match.groupOrder,
        optionOrder: match.sortOrder,
        groupId: match.groupId,
      });
    }
    mods.sort((a, b) => a.groupOrder - b.groupOrder || a.groupId.localeCompare(b.groupId) || a.optionOrder - b.optionOrder);
    const modSum = mods.reduce((s, m) => s + m.priceCents, 0);
    subtotal += lineSubtotal(variant.priceCents, line.quantity, modSum, 0);
    resolvedLines.push({
      variantId: variant.id,
      name: variant.item.name,
      quantity: line.quantity,
      unitPriceCents: variant.priceCents,
      modifiersJson: JSON.stringify(
        mods.map((mod) => ({ name: mod.name, priceCents: mod.priceCents, ...(mod.groupName ? { groupName: mod.groupName } : {}) }))
      ),
      note: line.note,
    });
  }

  const deliveryFeeCents = body.fulfillment === "delivery" ? deliveryFeeFor(settings, subtotal) : 0;
  const deliveryEstimate = estimateLabel(settings, body.fulfillment);
  const deliveryAddressLine = [body.deliveryAddress?.trim(), body.deliveryUnit?.trim()]
    .filter(Boolean)
    .join(", ");

  const taxCents = tax ? calcTax(subtotal, tax.rateBps, tax.inclusive) : 0;
  const totalCents = subtotal + (tax?.inclusive ? 0 : taxCents) + deliveryFeeCents;
  const count = await prisma.onlineOrder.count({ where: { storeId: store.id, channel: "web" } });
  const orderNumber = `OL-${1000 + count + 1}`;

  const orderNoteParts = [
    body.note?.trim(),
    body.fulfillment === "delivery" && body.deliveryInstructions?.trim()
      ? `Delivery notes: ${body.deliveryInstructions.trim()}`
      : null,
  ].filter(Boolean);
  const orderNote = orderNoteParts.length ? orderNoteParts.join(" · ") : null;

  const ticketNote = [
    body.fulfillment === "delivery" ? "DELIVERY" : body.fulfillment,
    body.customerName,
    body.customerPhone,
    deliveryAddressLine || null,
    orderNote,
  ]
    .filter(Boolean)
    .join(" · ");

  const ticket = await prisma.ticket.create({
    data: {
      storeId: store.id,
      registerId: register.id,
      name: `Online ${orderNumber}`,
      status: "held",
      source: "online",
      kitchenStatus: "queued",
      note: ticketNote,
      lines: {
        create: resolvedLines.map((l) => ({
          variantId: l.variantId,
          name: l.name,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          modifiersJson: l.modifiersJson,
          note: l.note,
        })),
      },
    },
  });

  const order = await prisma.onlineOrder.create({
    data: {
      storeId: store.id,
      ticketId: ticket.id,
      orderNumber,
      customerName: body.customerName,
      customerPhone: body.customerPhone,
      customerEmail: body.customerEmail,
      fulfillment: body.fulfillment,
      status: "pending",
      channel: "web",
      trackingToken: randomBytes(16).toString("base64url"),
      note: orderNote,
      deliveryAddress: body.fulfillment === "delivery" ? deliveryAddressLine || null : null,
      deliveryFeeCents,
      subtotalCents: subtotal,
      taxCents,
      totalCents,
      lines: {
        create: resolvedLines.map((l) => ({
          variantId: l.variantId,
          name: l.name,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          modifiersJson: l.modifiersJson,
          note: l.note,
        })),
      },
    },
    include: { lines: true },
  });

  // Kitchen print job (mock) — delivery clearly labeled for runners
  const kitchenText = [
    `KITCHEN · ${orderNumber}`,
    body.fulfillment === "delivery" ? ">>> DELIVERY <<<" : body.fulfillment.toUpperCase(),
    body.customerName,
    body.customerPhone || null,
    body.fulfillment === "delivery" && deliveryAddressLine ? `Addr: ${deliveryAddressLine}` : null,
    body.fulfillment === "delivery" ? `Ready in ${deliveryEstimate}` : null,
    `PAID ${card.brand} •••• ${card.last4}`,
    "----",
    ...resolvedLines.map((l) => {
      let extra = "";
      try {
        const lines = receiptModifierLines(JSON.parse(l.modifiersJson || "[]") as { name?: string; groupName?: string }[]);
        extra = lines.length ? `\n${lines.join("\n")}` : "";
      } catch {
        extra = "";
      }
      return `${l.quantity} x ${l.name}${extra}`;
    }),
    orderNote ? `Note: ${orderNote}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const encoder = new TextEncoder();
  const payload = encoder.encode(`\x1b\x40${kitchenText}\n\n\x1d\x56\x01`);
  const printer = await prisma.printerDevice.findFirst({
    where: { storeId: store.id, enabled: true },
    orderBy: { isDefault: "desc" },
  });
  await prisma.printJob.create({
    data: {
      storeId: store.id,
      printerId: printer?.id,
      type: "kitchen",
      status: "queued",
      payloadB64: Buffer.from(payload).toString("base64"),
      preview: kitchenText,
      ticketId: ticket.id,
    },
  });

  const saleCount = await prisma.sale.count({ where: { storeId: store.id } });
  const receiptNumber = `CT-${10000 + saleCount + 1}`;
  const openShift = await prisma.shift.findFirst({
    where: { storeId: store.id, registerId: register.id, status: "open" },
  });
  const saleLines: {
    variantId?: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
    modifiersJson: string;
  }[] = resolvedLines.map((line) => {
    const mods = JSON.parse(line.modifiersJson || "[]") as { priceCents?: number }[];
    const modSum = mods.reduce((sum, mod) => sum + (mod.priceCents ?? 0), 0);
    return {
      variantId: line.variantId,
      name: line.name,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      totalCents: lineSubtotal(line.unitPriceCents, line.quantity, modSum, 0),
      modifiersJson: line.modifiersJson,
    };
  });
  if (deliveryFeeCents > 0) {
    saleLines.push({
      name: "Delivery",
      quantity: 1,
      unitPriceCents: deliveryFeeCents,
      totalCents: deliveryFeeCents,
      modifiersJson: "[]",
    });
  }

  await prisma.sale.create({
    data: {
      receiptNumber,
      storeId: store.id,
      registerId: register.id,
      employeeId: employee.id,
      shiftId: openShift?.id,
      status: "completed",
      subtotalCents: subtotal,
      taxCents,
      totalCents,
      paidCents: totalCents,
      note: `Online ${orderNumber}`,
      lines: { create: saleLines },
      payments: {
        create: {
          paymentTypeId: cardType.id,
          paymentTypeName: cardType.name,
          amountCents: totalCents,
        },
      },
    },
  });

  for (const line of resolvedLines) {
    const variant = await prisma.variant.findUnique({
      where: { id: line.variantId },
      include: { item: { include: { kitComponents: true } } },
    });
    if (!variant) continue;
    if (variant.item.isComposite) {
      for (const component of variant.item.kitComponents) {
        await sellStock(store.id, component.componentVarId, -component.quantity * line.quantity, receiptNumber, employee.id);
      }
    } else if (variant.trackStock) {
      await sellStock(store.id, variant.id, -line.quantity, receiptNumber, employee.id);
    }
  }

  const paidOrder = await prisma.onlineOrder.update({
    where: { id: order.id },
    data: { cardBrand: card.brand, cardLast4: card.last4, receiptNumber },
    include: { lines: true },
  });
  await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      status: "paid",
      note: [ticket.note, `PAID ${card.brand} •••• ${card.last4}`, receiptNumber].filter(Boolean).join(" · "),
    },
  });

  res.status(201).json({
    order: publicOrderView(paidOrder, store, deliveryEstimate),
    trackingToken: paidOrder.trackingToken,
    ticketId: ticket.id,
    deliveryFeeCents,
    deliveryEstimate,
    receiptNumber,
    message: "Card payment accepted — kitchen notified",
  });
});

type OrderWithLines = Awaited<ReturnType<typeof prisma.onlineOrder.findFirstOrThrow<{ include: { lines: true } }>>>;

/** What the customer's tracking page may see: no phone, email or internal ids. */
function publicOrderView(
  order: OrderWithLines,
  store: { name: string; address: string | null; phone: string | null },
  estimate: string
) {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    fulfillment: order.fulfillment,
    customerName: order.customerName,
    deliveryAddress: order.deliveryAddress,
    deliveryFeeCents: order.deliveryFeeCents,
    subtotalCents: order.subtotalCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
    cardBrand: order.cardBrand,
    cardLast4: order.cardLast4,
    receiptNumber: order.receiptNumber,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    estimate,
    lines: order.lines.map((l) => ({
      name: l.name,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      modifiersJson: l.modifiersJson,
      note: l.note,
    })),
    store: { name: store.name, address: store.address, phone: store.phone },
  };
}

publicOrderingRouter.get("/orders/:token", async (req, res) => {
  const token = String(req.params.token);
  if (token.length < 16) return res.status(404).json({ error: "Not found" });
  const order = await prisma.onlineOrder.findFirst({
    where: { trackingToken: token },
    include: { lines: true, store: true },
  });
  if (!order) return res.status(404).json({ error: "Not found" });
  const settings = await readOrderingSettings(order.storeId);
  res.json(publicOrderView(order, order.store, estimateLabel(settings, order.fulfillment as "pickup")));
});

kitchenRouter.use(requireAuth);

kitchenRouter.get("/orders", async (req: AuthedRequest, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const recent = req.query.recent === "1";
  const orders = await prisma.onlineOrder.findMany({
    where: {
      storeId: req.user!.storeId,
      ...(recent
        ? { status: { in: ["completed", "cancelled"] }, updatedAt: { gte: new Date(Date.now() - 3 * 60 * 60 * 1000) } }
        : status
          ? { status }
          : { status: { in: ["pending", "accepted", "preparing", "ready"] } }),
    },
    include: { lines: true, ticket: true },
    orderBy: recent ? { updatedAt: "desc" } : { createdAt: "asc" },
    ...(recent ? { take: 12 } : {}),
  });
  res.setHeader("X-Server-Time", new Date().toISOString());
  res.json(orders);
});

/** The till sends a ticket to the kitchen screen. No payment is taken here. */
kitchenRouter.post("/orders", async (req: AuthedRequest, res) => {
  const body = z
    .object({
      name: z.string().trim().min(1).max(60),
      fulfillment: z.enum(["pickup", "dine_in", "delivery"]).default("dine_in"),
      note: z.string().max(300).optional(),
      ticketId: z.string().optional(),
      lines: z
        .array(
          z.object({
            variantId: z.string(),
            name: z.string().max(120),
            quantity: z.number().positive().max(999),
            unitPriceCents: z.number().int().default(0),
            modifiersJson: z.string().max(4000).default("[]"),
            note: z.string().max(200).nullable().optional(),
          })
        )
        .min(1)
        .max(100),
    })
    .parse(req.body);
  const storeId = req.user!.storeId;
  const variantIds = [...new Set(body.lines.map((l) => l.variantId))];
  const known = await prisma.variant.count({ where: { id: { in: variantIds }, item: { storeId } } });
  if (known !== variantIds.length) return res.status(400).json({ error: "Some items aren't on this store's menu." });
  if (body.ticketId && !(await prisma.ticket.count({ where: { id: body.ticketId, storeId } }))) {
    return res.status(404).json({ error: "Ticket not found" });
  }
  const count = await prisma.onlineOrder.count({ where: { storeId, channel: "till" } });
  const subtotal = body.lines.reduce((s, l) => s + Math.round(l.unitPriceCents * l.quantity), 0);
  const order = await prisma.onlineOrder.create({
    data: {
      storeId,
      ticketId: body.ticketId,
      orderNumber: `T-${100 + count + 1}`,
      customerName: body.name,
      fulfillment: body.fulfillment,
      channel: "till",
      status: "pending",
      note: body.note?.trim() || null,
      subtotalCents: subtotal,
      totalCents: subtotal,
      lines: {
        create: body.lines.map((l) => ({
          variantId: l.variantId,
          name: l.name,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          modifiersJson: l.modifiersJson,
          note: l.note ?? null,
        })),
      },
    },
    include: { lines: true },
  });
  if (body.ticketId) {
    await prisma.ticket.update({ where: { id: body.ticketId }, data: { kitchenStatus: "queued" } });
  }

  const kitchenText = buildKitchenTicketText({
    orderNumber: order.orderNumber,
    customerName: body.name,
    fulfillment: body.fulfillment,
    lines: order.lines,
    note: body.note,
  });
  await queueKitchenPrintJob({
    storeId,
    text: kitchenText,
    ticketId: body.ticketId,
  });

  res.status(201).json(order);
});

kitchenRouter.get("/settings", async (req: AuthedRequest, res) => {
  const settings = await readOrderingSettings(req.user!.storeId);
  res.json({ ...settings, paused: isPaused(settings) });
});

/** Pause and prep time are for anyone in the kitchen; the rest is owner/manager. */
kitchenRouter.patch("/settings", async (req: AuthedRequest, res) => {
  const patch = orderingSettingsSchema.partial().parse(req.body);
  const managerOnly = Object.keys(patch).some((k) => k !== "pausedUntil" && k !== "prepMinutes");
  if (managerOnly && !["owner", "manager"].includes(req.user!.role)) {
    return res.status(403).json({ error: "Only an owner or manager can change delivery and order types." });
  }
  if (patch.pausedUntil && patch.pausedUntil !== "off" && !Number.isFinite(Date.parse(patch.pausedUntil))) {
    return res.status(400).json({ error: "Invalid pause time" });
  }
  const settings = await writeOrderingSettings(req.user!.storeId, patch);
  res.json({ ...settings, paused: isPaused(settings) });
});

kitchenRouter.get("/items", async (req: AuthedRequest, res) => {
  const items = await prisma.item.findMany({
    where: { storeId: req.user!.storeId, active: true },
    select: { id: true, name: true, soldOut: true, color: true, category: { select: { name: true } } },
    orderBy: [{ soldOut: "desc" }, { name: "asc" }],
  });
  res.json(items);
});

kitchenRouter.patch("/items/:id", owned("item"), async (req: AuthedRequest, res) => {
  const { soldOut } = z.object({ soldOut: z.boolean() }).parse(req.body);
  const item = await prisma.item.update({
    where: { id: String(req.params.id) },
    data: { soldOut },
    select: { id: true, name: true, soldOut: true },
  });
  res.json(item);
});

kitchenRouter.patch("/orders/:id", owned("onlineOrder"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      status: z.enum(["pending", "accepted", "preparing", "ready", "completed", "cancelled"]),
    })
    .parse(req.body);

  const kitchenMap: Record<string, string | null> = {
    pending: "queued",
    accepted: "queued",
    preparing: "preparing",
    ready: "ready",
    completed: "done",
    cancelled: null,
  };

  const order = await prisma.onlineOrder.update({
    where: { id: req.params.id },
    data: { status: body.status },
    include: { lines: true },
  });

  if (order.ticketId) {
    await prisma.ticket.update({
      where: { id: order.ticketId },
      data: {
        kitchenStatus: kitchenMap[body.status] ?? undefined,
        status: body.status === "cancelled" ? "voided" : order.cardLast4 ? "paid" : body.status === "completed" ? "open" : "held",
      },
    });
  }

  res.json(order);
});

kitchenRouter.post("/orders/:id/recall-ticket", owned("onlineOrder"), async (req: AuthedRequest, res) => {
  const order = await prisma.onlineOrder.findUniqueOrThrow({ where: { id: req.params.id } });
  if (!order.ticketId) return res.status(400).json({ error: "No ticket linked" });
  const ticket = await prisma.ticket.update({
    where: { id: order.ticketId },
    data: {
      status: order.cardLast4 ? "paid" : "open",
      kitchenStatus: order.status === "ready" ? "ready" : "preparing",
    },
    include: { lines: true },
  });
  res.json(ticket);
});

function luhn(digits: string) {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = Number(digits[i]);
    if (alternate) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function cardBrand(digits: string) {
  if (digits.startsWith("4")) return "Visa";
  if (/^5[1-5]/.test(digits) || /^2(?:2[2-9]|[3-6]\d|7[01]|720)/.test(digits)) return "Mastercard";
  if (/^3[47]/.test(digits)) return "Amex";
  if (/^6(?:011|5)/.test(digits)) return "Discover";
  return "Card";
}

function authorizeCard(card: { name: string; number: string; expMonth: number; expYear: number; cvc: string }) {
  const digits = card.number.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19 || !luhn(digits)) {
    return { error: "That card number isn't valid." };
  }
  if (!/^\d{3,4}$/.test(card.cvc)) return { error: "Check the security code." };
  if (!card.name.trim()) return { error: "Name on card is required." };
  const expires = new Date(card.expYear, card.expMonth, 0, 23, 59, 59);
  if (Number.isNaN(expires.getTime()) || expires.getTime() < Date.now()) {
    return { error: "This card is expired." };
  }
  return { brand: cardBrand(digits), last4: digits.slice(-4) };
}

async function sellStock(storeId: string, variantId: string, quantity: number, note: string, employeeId: string) {
  const level = await prisma.inventoryLevel.findUnique({
    where: { storeId_variantId: { storeId, variantId } },
  });
  if (level) {
    await prisma.inventoryLevel.update({
      where: { id: level.id },
      data: { quantity: level.quantity + quantity },
    });
  }
  await prisma.inventoryMovement.create({
    data: { storeId, variantId, type: "sale", quantity, note, employeeId },
  });
}
