import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { calcTax, lineSubtotal } from "../money.js";

export const publicOrderingRouter = Router();
export const kitchenRouter = Router();

async function resolveStore(slugOrId: string) {
  return prisma.store.findFirst({
    where: { OR: [{ slug: slugOrId }, { id: slugOrId }] },
  });
}

publicOrderingRouter.get("/stores", async (_req, res) => {
  const stores = await prisma.store.findMany({
    select: { id: true, slug: true, name: true, address: true, phone: true, currency: true },
    orderBy: { name: "asc" },
  });
  res.json(stores);
});

publicOrderingRouter.get("/stores/:slug/menu", async (req, res) => {
  const store = await resolveStore(req.params.slug);
  if (!store) return res.status(404).json({ error: "Store not found" });

  const [categories, items, tax] = await Promise.all([
    prisma.category.findMany({ where: { storeId: store.id }, orderBy: { sortOrder: "asc" } }),
    prisma.item.findMany({
      where: { storeId: store.id, active: true },
      include: {
        variants: { where: { active: true } },
        modifierGroups: { include: { modifiers: { where: { active: true } } } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.tax.findFirst({ where: { storeId: store.id, enabled: true } }),
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
    items,
    delivery: {
      feeCents: 399,
      freeAboveCents: 3000,
      estimateMinutes: "35–50 min",
    },
  });
});

publicOrderingRouter.post("/stores/:slug/orders", async (req, res) => {
  const store = await resolveStore(req.params.slug);
  if (!store) return res.status(404).json({ error: "Store not found" });

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
            quantity: z.number().positive().default(1),
            modifiers: z
              .array(z.object({ name: z.string(), priceCents: z.number().int() }))
              .optional(),
            note: z.string().optional(),
          })
        )
        .min(1),
    })
    .parse(req.body);

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

  const employee =
    (await prisma.employee.findFirst({ where: { storeId: store.id, role: "owner", active: true } })) ??
    (await prisma.employee.findFirst({ where: { storeId: store.id, active: true } }));
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
      include: { item: true },
    });
    if (!variant || variant.item.storeId !== store.id) {
      return res.status(400).json({ error: `Invalid variant ${line.variantId}` });
    }
    const mods = line.modifiers ?? [];
    const modSum = mods.reduce((s, m) => s + m.priceCents, 0);
    subtotal += lineSubtotal(variant.priceCents, line.quantity, modSum, 0);
    resolvedLines.push({
      variantId: variant.id,
      name: variant.item.name,
      quantity: line.quantity,
      unitPriceCents: variant.priceCents,
      modifiersJson: JSON.stringify(mods),
      note: line.note,
    });
  }

  // Flat delivery fee stub — free over $30 subtotal
  const DELIVERY_FEE_CENTS = 399;
  const deliveryFeeCents =
    body.fulfillment === "delivery" ? (subtotal >= 3000 ? 0 : DELIVERY_FEE_CENTS) : 0;
  const deliveryEstimate =
    body.fulfillment === "delivery" ? "35–50 min" : body.fulfillment === "dine_in" ? "15–25 min" : "10–20 min";
  const deliveryAddressLine = [body.deliveryAddress?.trim(), body.deliveryUnit?.trim()]
    .filter(Boolean)
    .join(", ");

  const taxCents = tax ? calcTax(subtotal, tax.rateBps, tax.inclusive) : 0;
  const totalCents = subtotal + (tax?.inclusive ? 0 : taxCents) + deliveryFeeCents;
  const count = await prisma.onlineOrder.count({ where: { storeId: store.id } });
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
      const mods = JSON.parse(l.modifiersJson || "[]") as { name: string }[];
      const modLabel = mods.length ? ` (${mods.map((m) => m.name).join(", ")})` : "";
      return `${l.quantity} x ${l.name}${modLabel}`;
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
    order: paidOrder,
    ticketId: ticket.id,
    deliveryFeeCents,
    deliveryEstimate,
    receiptNumber,
    message: "Card payment accepted — kitchen notified",
  });
});

publicOrderingRouter.get("/orders/:orderNumber", async (req, res) => {
  const order = await prisma.onlineOrder.findFirst({
    where: { orderNumber: req.params.orderNumber },
    include: { lines: true, store: true },
  });
  if (!order) return res.status(404).json({ error: "Not found" });
  res.json(order);
});

kitchenRouter.use(requireAuth);

kitchenRouter.get("/orders", async (req: AuthedRequest, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const orders = await prisma.onlineOrder.findMany({
    where: {
      storeId: req.user!.storeId,
      ...(status ? { status } : { status: { in: ["pending", "accepted", "preparing", "ready"] } }),
    },
    include: { lines: true, ticket: true },
    orderBy: { createdAt: "asc" },
  });
  res.json(orders);
});

kitchenRouter.patch("/orders/:id", async (req: AuthedRequest, res) => {
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

kitchenRouter.post("/orders/:id/recall-ticket", async (req: AuthedRequest, res) => {
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
