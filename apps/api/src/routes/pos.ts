import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { prisma } from "../db.js";
import { orderStoredModifiers } from "../modifierOrder.js";
import { ensureKitchenTicketForSale } from "../kitchenTicket.js";
import { owned, rejectForeign } from "../tenant.js";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { calcTax, lineSubtotal } from "../money.js";

export const posRouter = Router();
posRouter.use(requireAuth);

function parseModifiers(json: string): { modifierId?: string; name: string; priceCents: number }[] {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

async function getActiveTax(storeId: string) {
  return prisma.tax.findFirst({ where: { storeId, enabled: true } });
}

async function ticketTotals(ticketId: string) {
  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: { lines: true },
  });
  const tax = await getActiveTax(ticket.storeId);
  let subtotal = 0;
  for (const line of ticket.lines) {
    const mods = parseModifiers(line.modifiersJson);
    const modSum = mods.reduce((s, m) => s + m.priceCents, 0);
    subtotal += lineSubtotal(line.unitPriceCents, line.quantity, modSum, line.discountCents);
  }
  const afterPct =
    ticket.discountPercent > 0 ? Math.round(subtotal * (1 - ticket.discountPercent / 100)) : subtotal;
  const afterDisc = Math.max(0, afterPct - ticket.discountCents);
  const taxCents = tax ? calcTax(afterDisc, tax.rateBps, tax.inclusive) : 0;
  const total = afterDisc + (tax?.inclusive ? 0 : taxCents) + ticket.tipCents;
  return {
    subtotalCents: subtotal,
    taxCents,
    totalCents: total,
    discountCents: subtotal - afterDisc,
    tipCents: ticket.tipCents,
  };
}

export async function serializeTicket(ticketId: string) {
  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: { lines: true, customer: true, register: true },
  });
  const totals = await ticketTotals(ticketId);
  return {
    id: ticket.id,
    name: ticket.name,
    status: ticket.status,
    registerId: ticket.registerId,
    registerName: ticket.register?.name ?? null,
    customerId: ticket.customerId,
    customer: ticket.customer,
    discountCents: ticket.discountCents,
    discountPercent: ticket.discountPercent,
    tipCents: ticket.tipCents,
    note: ticket.note,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    ...totals,
    lines: ticket.lines.map((l) => ({
      key: l.id,
      variantId: l.variantId,
      itemId: "",
      name: l.name,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      discountCents: l.discountCents,
      note: l.note ?? undefined,
      modifiers: parseModifiers(l.modifiersJson),
    })),
  };
}

/** Void empty open tickets that have sat unused — keep recent ones for the active till. */
async function voidStaleEmptyOpenTickets(storeId: string, keepId?: string | null) {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);
  const empties = await prisma.ticket.findMany({
    where: {
      storeId,
      status: "open",
      lines: { none: {} },
      updatedAt: { lt: cutoff },
      ...(keepId ? { NOT: { id: keepId } } : {}),
    },
    select: { id: true },
  });
  if (!empties.length) return 0;
  await prisma.ticket.updateMany({
    where: { id: { in: empties.map((row) => row.id) } },
    data: { status: "voided" },
  });
  return empties.length;
}

/** On one till, only one empty open ticket is needed — void the rest. */
async function voidExtraEmptyOnRegister(storeId: string, registerId: string, keepId: string) {
  const extras = await prisma.ticket.findMany({
    where: {
      storeId,
      registerId,
      status: "open",
      lines: { none: {} },
      NOT: { id: keepId },
    },
    select: { id: true },
  });
  if (!extras.length) return;
  await prisma.ticket.updateMany({
    where: { id: { in: extras.map((row) => row.id) } },
    data: { status: "voided" },
  });
}

posRouter.get("/tickets", async (req: AuthedRequest, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const storeId = req.user!.storeId;
  if (status === "open" || !status) {
    await voidStaleEmptyOpenTickets(storeId);
  }
  const tickets = await prisma.ticket.findMany({
    where:
      status === "held"
        ? { storeId, status: "held" }
        : status === "open"
          ? // Hide empty placeholders from Tickets · N and the open rail
            { storeId, status: "open", lines: { some: {} } }
          : {
              storeId,
              OR: [{ status: "held" }, { status: "open", lines: { some: {} } }],
            },
    orderBy: { updatedAt: "desc" },
  });
  const result = [];
  for (const t of tickets) result.push(await serializeTicket(t.id));
  res.json(result);
});

posRouter.post("/tickets", async (req: AuthedRequest, res) => {
  const body = z
    .object({
      registerId: z.string(),
      name: z.string().optional(),
    })
    .parse(req.body);
  if (await rejectForeign(res, "register", [body.registerId], req.user!.storeId)) return;

  const storeId = req.user!.storeId;
  // Reuse an empty open ticket on this till instead of creating another Sale · 0 lines
  const empty = await prisma.ticket.findFirst({
    where: {
      storeId,
      registerId: body.registerId,
      status: "open",
      lines: { none: {} },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (empty) {
    await voidExtraEmptyOnRegister(storeId, body.registerId, empty.id);
    const name = body.name?.trim();
    if (name && name !== empty.name) {
      await prisma.ticket.update({
        where: { id: empty.id },
        data: { name, updatedAt: new Date() },
      });
    } else {
      await prisma.ticket.update({ where: { id: empty.id }, data: { updatedAt: new Date() } });
    }
    return res.json(await serializeTicket(empty.id));
  }

  await voidStaleEmptyOpenTickets(storeId);

  const ticket = await prisma.ticket.create({
    data: {
      storeId,
      registerId: body.registerId,
      employeeId: req.user!.sub,
      name: body.name ?? `Ticket ${nanoid(4)}`,
      status: "open",
    },
  });
  res.status(201).json(await serializeTicket(ticket.id));
});

posRouter.get("/tickets/:id", owned("ticket"), async (req, res) => {
  res.json(await serializeTicket(req.params.id));
});

posRouter.post("/tickets/:id/lines", owned("ticket"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      variantId: z.string(),
      quantity: z.number().positive().default(1),
      modifiers: z
        .array(
          z.object({
            modifierId: z.string().optional(),
            name: z.string(),
            priceCents: z.number().int(),
            groupName: z.string().max(80).optional(),
          })
        )
        .optional(),
      note: z.string().optional(),
    })
    .parse(req.body);
  if (await rejectForeign(res, "variant", [body.variantId], req.user!.storeId)) return;
  if (await rejectForeign(res, "modifier", (body.modifiers ?? []).map((mod) => mod.modifierId), req.user!.storeId)) return;

  const variant = await prisma.variant.findUniqueOrThrow({
    where: { id: body.variantId },
    include: { item: true },
  });

  await prisma.ticketLine.create({
    data: {
      ticketId: req.params.id,
      variantId: variant.id,
      name: variant.item.name + (variant.name !== "Regular" ? ` (${variant.name})` : ""),
      quantity: body.quantity,
      unitPriceCents: variant.priceCents,
      modifiersJson: JSON.stringify(await orderStoredModifiers(body.modifiers ?? [], { variantId: variant.id })),
      note: body.note,
    },
  });
  await prisma.ticket.update({ where: { id: req.params.id }, data: { updatedAt: new Date() } });
  res.status(201).json(await serializeTicket(req.params.id));
});

posRouter.patch("/tickets/:id/lines/:lineId", owned("ticket"), owned("ticketLine", "lineId"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      quantity: z.number().positive().optional(),
      discountCents: z.number().int().optional(),
      note: z.string().nullable().optional(),
      modifiers: z
        .array(
          z.object({
            modifierId: z.string().optional(),
            name: z.string(),
            priceCents: z.number().int(),
            groupName: z.string().max(80).optional(),
          })
        )
        .optional(),
    })
    .parse(req.body);
  if (body.modifiers && (await rejectForeign(res, "modifier", body.modifiers.map((mod) => mod.modifierId), req.user!.storeId))) {
    return;
  }
  const { modifiers, ...rest } = body;
  const lineRow = modifiers
    ? await prisma.ticketLine.findUnique({ where: { id: String(req.params.lineId) }, select: { variantId: true } })
    : null;
  await prisma.ticketLine.update({
    where: { id: String(req.params.lineId) },
    data: {
      ...rest,
      ...(modifiers
        ? {
            modifiersJson: JSON.stringify(
              await orderStoredModifiers(modifiers, lineRow ? { variantId: lineRow.variantId } : undefined)
            ),
          }
        : {}),
    },
  });
  await prisma.ticket.update({ where: { id: String(req.params.id) }, data: { updatedAt: new Date() } });
  res.json(await serializeTicket(String(req.params.id)));
});

posRouter.delete("/tickets/:id/lines/:lineId", owned("ticket"), owned("ticketLine", "lineId"), async (req, res) => {
  await prisma.ticketLine.delete({ where: { id: req.params.lineId } });
  res.json(await serializeTicket(req.params.id));
});

posRouter.patch("/tickets/:id", owned("ticket"), async (req, res) => {
  const body = z
    .object({
      name: z.string().optional(),
      status: z.enum(["open", "held", "voided"]).optional(),
      customerId: z.string().nullable().optional(),
      discountCents: z.number().int().optional(),
      discountPercent: z.number().optional(),
      tipCents: z.number().int().optional(),
      note: z.string().nullable().optional(),
    })
    .parse(req.body);
  if (await rejectForeign(res, "customer", [body.customerId], (req as AuthedRequest).user!.storeId)) return;
  await prisma.ticket.update({ where: { id: req.params.id }, data: body });
  res.json(await serializeTicket(req.params.id));
});

posRouter.post("/tickets/:id/hold", owned("ticket"), async (req, res) => {
  await prisma.ticket.update({ where: { id: req.params.id }, data: { status: "held" } });
  res.json(await serializeTicket(req.params.id));
});

posRouter.post("/tickets/:id/recall", owned("ticket"), async (req, res) => {
  await prisma.ticket.update({ where: { id: req.params.id }, data: { status: "open" } });
  res.json(await serializeTicket(req.params.id));
});

/** Pull an open/held ticket onto this till (live sync across registers). */
posRouter.post("/tickets/:id/claim", owned("ticket"), async (req: AuthedRequest, res) => {
  const body = z.object({ registerId: z.string() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "registerId required" });
  const existing = await prisma.ticket.findFirst({
    where: { id: req.params.id, storeId: req.user!.storeId },
  });
  if (!existing) return res.status(404).json({ error: "Ticket not found" });
  if (existing.status !== "open" && existing.status !== "held") {
    return res.status(400).json({ error: "Ticket is no longer open" });
  }
  const register = await prisma.register.findFirst({
    where: { id: body.data.registerId, storeId: req.user!.storeId },
  });
  if (!register) return res.status(400).json({ error: "Register not found" });
  await prisma.ticket.update({
    where: { id: existing.id },
    data: {
      status: "open",
      registerId: register.id,
      employeeId: req.user!.sub,
      updatedAt: new Date(),
    },
  });
  res.json(await serializeTicket(existing.id));
});

posRouter.post("/tickets/:id/pay", owned("ticket"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      payments: z
        .array(
          z.object({
            paymentTypeId: z.string(),
            amountCents: z.number().int().positive(),
            tenderedCents: z.number().int().optional(),
            giftCardCode: z.string().optional(),
          })
        )
        .min(1),
      tipCents: z.number().int().optional(),
    })
    .parse(req.body);

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: req.params.id },
    include: { lines: true },
  });
  if (ticket.status === "paid") return res.status(400).json({ error: "Already paid" });
  if (await rejectForeign(res, "paymentType", body.payments.map((p) => p.paymentTypeId), ticket.storeId)) return;

  if (body.tipCents !== undefined) {
    await prisma.ticket.update({ where: { id: req.params.id }, data: { tipCents: body.tipCents } });
  }

  const totals = await ticketTotals(ticket.id);
  const paid = body.payments.reduce((s, p) => s + p.amountCents, 0);
  // Allow exact due or overpay (change). Tip in this request is already in totals.
  if (paid < totals.totalCents) {
    return res.status(400).json({ error: "Insufficient payment", totals, paid });
  }

  const openShift = await prisma.shift.findFirst({
    where: {
      storeId: req.user!.storeId,
      registerId: ticket.registerId,
      status: "open",
    },
  });

  const paymentTypes = await prisma.paymentType.findMany({
    where: { id: { in: body.payments.map((p) => p.paymentTypeId) }, storeId: ticket.storeId },
  });
  const ptMap = new Map(paymentTypes.map((p) => [p.id, p]));

  // Store credit + gift card deduction (validate first)
  const { redeemGiftCard } = await import("./giftcards.js");
  for (const p of body.payments) {
    const pt = ptMap.get(p.paymentTypeId);
    if (pt?.type === "store_credit") {
      if (!ticket.customerId) return res.status(400).json({ error: "Attach a customer to use store credit" });
      const cust = await prisma.customer.findUniqueOrThrow({ where: { id: ticket.customerId } });
      if (cust.storeCreditCents < p.amountCents) {
        return res.status(400).json({ error: "Insufficient store credit" });
      }
    }
    if (pt?.type === "gift_card") {
      if (!p.giftCardCode) return res.status(400).json({ error: "Gift card code required" });
      const card = await prisma.giftCard.findFirst({
        where: { storeId: ticket.storeId, code: p.giftCardCode.toUpperCase(), status: "active" },
      });
      if (!card) return res.status(400).json({ error: "Gift card not found" });
      if (card.balanceCents < p.amountCents) {
        return res.status(400).json({ error: "Insufficient gift card balance" });
      }
    }
  }

  for (const p of body.payments) {
    const pt = ptMap.get(p.paymentTypeId);
    if (pt?.type === "store_credit" && ticket.customerId) {
      const cust = await prisma.customer.findUniqueOrThrow({ where: { id: ticket.customerId } });
      await prisma.customer.update({
        where: { id: cust.id },
        data: { storeCreditCents: cust.storeCreditCents - p.amountCents },
      });
    }
  }

  const count = await prisma.sale.count({ where: { storeId: req.user!.storeId } });
  const receiptNumber = `CT-${10000 + count + 1}`;

  const sale = await prisma.sale.create({
    data: {
      receiptNumber,
      storeId: ticket.storeId,
      registerId: ticket.registerId,
      employeeId: req.user!.sub,
      customerId: ticket.customerId,
      shiftId: openShift?.id,
      status: "completed",
      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      taxCents: totals.taxCents,
      tipCents: totals.tipCents,
      totalCents: totals.totalCents,
      paidCents: paid,
      changeCents: paid - totals.totalCents,
      note: ticket.note,
      lines: {
        create: ticket.lines.map((l) => {
          const mods = parseModifiers(l.modifiersJson);
          const modSum = mods.reduce((s, m) => s + m.priceCents, 0);
          const lineTotal = lineSubtotal(l.unitPriceCents, l.quantity, modSum, l.discountCents);
          return {
            variantId: l.variantId,
            name: l.name,
            quantity: l.quantity,
            unitPriceCents: l.unitPriceCents,
            discountCents: l.discountCents,
            taxCents: 0,
            totalCents: lineTotal,
            modifiersJson: l.modifiersJson,
          };
        }),
      },
      payments: {
        create: body.payments.map((p) => ({
          paymentTypeId: p.paymentTypeId,
          paymentTypeName: ptMap.get(p.paymentTypeId)?.name ?? "Payment",
          amountCents: p.amountCents,
          tenderedCents: p.tenderedCents,
          giftCardCode: p.giftCardCode?.toUpperCase(),
        })),
      },
    },
    include: { lines: true, payments: true, employee: true, customer: true },
  });

  for (const p of body.payments) {
    const pt = ptMap.get(p.paymentTypeId);
    if (pt?.type === "gift_card" && p.giftCardCode) {
      await redeemGiftCard({
        storeId: ticket.storeId,
        code: p.giftCardCode,
        amountCents: p.amountCents,
        employeeId: req.user!.sub,
        saleId: sale.id,
      });
    }
  }

  // Inventory
  for (const line of ticket.lines) {
    const variant = await prisma.variant.findUnique({ where: { id: line.variantId }, include: { item: { include: { kitComponents: true } } } });
    if (!variant) continue;
    if (variant.item.isComposite) {
      for (const kc of variant.item.kitComponents) {
        await adjustStock(ticket.storeId, kc.componentVarId, -kc.quantity * line.quantity, "sale", sale.receiptNumber, req.user!.sub);
      }
    } else if (variant.trackStock) {
      await adjustStock(ticket.storeId, variant.id, -line.quantity, "sale", sale.receiptNumber, req.user!.sub);
    }
  }

  if (ticket.customerId) {
    const points = Math.floor(totals.totalCents / 100);
    await prisma.customer.update({
      where: { id: ticket.customerId },
      data: {
        loyaltyPoints: { increment: points },
        totalSpentCents: { increment: totals.totalCents },
        visitCount: { increment: 1 },
      },
    });
  }

  const kitchenLines = (
    ticket as {
      lines: {
        variantId: string;
        name: string;
        quantity: number;
        unitPriceCents: number;
        modifiersJson: string;
        note: string | null;
      }[];
    }
  ).lines;
  const kitchenTicket = await ensureKitchenTicketForSale({
    storeId: ticket.storeId,
    saleId: sale.id,
    receiptNumber: sale.receiptNumber,
    ticketId: ticket.id,
    customerName: sale.customer?.name ?? ticket.name,
    fulfillment: "dine_in",
    note: ticket.note,
    alreadySent: Boolean(ticket.kitchenStatus),
    lines: kitchenLines.map((line) => ({
      variantId: line.variantId,
      name: line.name,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      modifiersJson: line.modifiersJson,
      note: line.note,
    })),
  });

  await prisma.ticket.update({ where: { id: ticket.id }, data: { status: "paid" } });
  await prisma.ticketLine.deleteMany({ where: { ticketId: ticket.id } });

  // Auto open drawer for cash
  const opensDrawer = body.payments.some((p) => ptMap.get(p.paymentTypeId)?.opensDrawer);
  if (opensDrawer && openShift) {
    await prisma.cashEvent.create({
      data: { shiftId: openShift.id, type: "drawer_open", amountCents: 0, note: `Sale ${receiptNumber}` },
    });
  }

  res.status(201).json({
    sale: {
      ...sale,
      employeeName: sale.employee.name,
      customerName: sale.customer?.name ?? null,
      createdAt: sale.createdAt.toISOString(),
    },
    kitchenTicket,
    drawerOpened: opensDrawer,
    changeCents: sale.changeCents,
  });
});

async function adjustStock(
  storeId: string,
  variantId: string,
  qty: number,
  type: string,
  note: string,
  employeeId: string
) {
  const level = await prisma.inventoryLevel.findUnique({
    where: { storeId_variantId: { storeId, variantId } },
  });
  if (level) {
    await prisma.inventoryLevel.update({
      where: { id: level.id },
      data: { quantity: level.quantity + qty },
    });
  }
  await prisma.inventoryMovement.create({
    data: { storeId, variantId, type, quantity: qty, note, employeeId },
  });
}

posRouter.get("/payment-types", async (req: AuthedRequest, res) => {
  const pts = await prisma.paymentType.findMany({
    where: { storeId: req.user!.storeId, enabled: true },
  });
  res.json(pts);
});

posRouter.get("/taxes", async (req: AuthedRequest, res) => {
  const taxes = await prisma.tax.findMany({ where: { storeId: req.user!.storeId } });
  res.json(taxes);
});

posRouter.post("/drawer/open", async (req: AuthedRequest, res) => {
  const body = z.object({ registerId: z.string(), note: z.string().optional() }).parse(req.body);
  if (await rejectForeign(res, "register", [body.registerId], req.user!.storeId)) return;
  const shift = await prisma.shift.findFirst({
    where: { registerId: body.registerId, storeId: req.user!.storeId, status: "open" },
  });
  if (!shift) return res.status(400).json({ error: "No open shift" });
  const event = await prisma.cashEvent.create({
    data: { shiftId: shift.id, type: "drawer_open", amountCents: 0, note: body.note ?? "Manual open" },
  });
  res.json({ ok: true, event });
});

/** Idempotent sync for sales completed on the till while offline. */
posRouter.post("/offline-sales", async (req: AuthedRequest, res) => {
  const body = z
    .object({
      clientSaleId: z.string().min(4),
      registerId: z.string(),
      customerId: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
      discountCents: z.number().int().optional(),
      tipCents: z.number().int().optional(),
      lines: z
        .array(
          z.object({
            variantId: z.string(),
            name: z.string(),
            quantity: z.number().positive(),
            unitPriceCents: z.number().int(),
            discountCents: z.number().int().default(0),
            modifiers: z
              .array(
                z.object({
                  name: z.string(),
                  priceCents: z.number().int(),
                  modifierId: z.string().optional(),
                  groupName: z.string().max(80).optional(),
                })
              )
              .default([]),
          })
        )
        .min(1),
      payments: z
        .array(
          z.object({
            paymentTypeId: z.string(),
            amountCents: z.number().int().positive(),
            tenderedCents: z.number().int().optional(),
            giftCardCode: z.string().optional(),
          })
        )
        .min(1),
    })
    .parse(req.body);
  const storeId = req.user!.storeId;
  if (await rejectForeign(res, "register", [body.registerId], storeId)) return;
  if (await rejectForeign(res, "customer", [body.customerId], storeId)) return;
  if (await rejectForeign(res, "variant", body.lines.map((line) => line.variantId), storeId)) return;
  if (await rejectForeign(res, "paymentType", body.payments.map((p) => p.paymentTypeId), storeId)) return;
  if (
    await rejectForeign(
      res,
      "modifier",
      body.lines.flatMap((line) => line.modifiers.map((mod) => mod.modifierId)),
      storeId
    )
  ) {
    return;
  }

  const offlineNote = `offline:${body.clientSaleId}`;
  const existing = await prisma.sale.findFirst({
    where: { storeId: req.user!.storeId, note: offlineNote },
    include: { employee: true, customer: true, lines: true, payments: true },
  });
  if (existing) {
    return res.json({
      sale: {
        ...existing,
        employeeName: existing.employee.name,
        customerName: existing.customer?.name ?? null,
        createdAt: existing.createdAt.toISOString(),
      },
      duplicate: true,
      changeCents: existing.changeCents,
    });
  }

  const paymentTypes = await prisma.paymentType.findMany({
    where: { id: { in: body.payments.map((p) => p.paymentTypeId) }, storeId },
  });
  const ptMap = new Map(paymentTypes.map((p) => [p.id, p]));
  const tax = await getActiveTax(req.user!.storeId);

  let subtotal = 0;
  for (const line of body.lines) {
    const modSum = line.modifiers.reduce((s, m) => s + m.priceCents, 0);
    subtotal += lineSubtotal(line.unitPriceCents, line.quantity, modSum, line.discountCents);
  }
  const afterDisc = Math.max(0, subtotal - (body.discountCents ?? 0));
  const taxCents = tax ? calcTax(afterDisc, tax.rateBps, tax.inclusive) : 0;
  const tipCents = body.tipCents ?? 0;
  const totalCents = afterDisc + (tax?.inclusive ? 0 : taxCents) + tipCents;
  const paid = body.payments.reduce((s, p) => s + p.amountCents, 0);
  if (paid < totalCents) return res.status(400).json({ error: "Insufficient payment", totalCents, paid });

  const openShift = await prisma.shift.findFirst({
    where: { storeId: req.user!.storeId, registerId: body.registerId, status: "open" },
  });
  const count = await prisma.sale.count({ where: { storeId: req.user!.storeId } });
  const receiptNumber = `CT-${10000 + count + 1}`;

  const sale = await prisma.sale.create({
    data: {
      receiptNumber,
      storeId: req.user!.storeId,
      registerId: body.registerId,
      employeeId: req.user!.sub,
      customerId: body.customerId ?? null,
      shiftId: openShift?.id,
      status: "completed",
      subtotalCents: afterDisc,
      discountCents: body.discountCents ?? 0,
      taxCents,
      tipCents,
      totalCents,
      paidCents: paid,
      changeCents: paid - totalCents,
      note: offlineNote,
      lines: {
        create: await Promise.all(
          body.lines.map(async (line) => {
            const modifiers = await orderStoredModifiers(line.modifiers, {
              variantId: line.variantId ?? undefined,
            });
            const modSum = modifiers.reduce((s, m) => s + m.priceCents, 0);
            return {
              variantId: line.variantId,
              name: line.name,
              quantity: line.quantity,
              unitPriceCents: line.unitPriceCents,
              discountCents: line.discountCents,
              taxCents: 0,
              totalCents: lineSubtotal(line.unitPriceCents, line.quantity, modSum, line.discountCents),
              modifiersJson: JSON.stringify(modifiers),
            };
          })
        ),
      },
      payments: {
        create: body.payments.map((p) => ({
          paymentTypeId: p.paymentTypeId,
          paymentTypeName: ptMap.get(p.paymentTypeId)?.name ?? "Payment",
          amountCents: p.amountCents,
          tenderedCents: p.tenderedCents,
          giftCardCode: p.giftCardCode?.toUpperCase(),
        })),
      },
    },
    include: { lines: true, payments: true, employee: true, customer: true },
  });

  for (const line of body.lines) {
    const variant = await prisma.variant.findUnique({
      where: { id: line.variantId },
      include: { item: { include: { kitComponents: true } } },
    });
    if (!variant) continue;
    if (variant.item.isComposite) {
      for (const kc of variant.item.kitComponents) {
        await adjustStock(
          req.user!.storeId,
          kc.componentVarId,
          -kc.quantity * line.quantity,
          "sale",
          sale.receiptNumber,
          req.user!.sub
        );
      }
    } else if (variant.trackStock) {
      await adjustStock(req.user!.storeId, variant.id, -line.quantity, "sale", sale.receiptNumber, req.user!.sub);
    }
  }

  res.status(201).json({
    sale: {
      ...sale,
      employeeName: sale.employee.name,
      customerName: sale.customer?.name ?? null,
      createdAt: sale.createdAt.toISOString(),
    },
    duplicate: false,
    changeCents: sale.changeCents,
  });
});
