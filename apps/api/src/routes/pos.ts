import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { prisma } from "../db.js";
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
  return { subtotalCents: subtotal, taxCents, totalCents: total, discountCents: ticket.discountCents, tipCents: ticket.tipCents };
}

async function serializeTicket(ticketId: string) {
  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: { lines: true, customer: true },
  });
  const totals = await ticketTotals(ticketId);
  return {
    id: ticket.id,
    name: ticket.name,
    status: ticket.status,
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

posRouter.get("/tickets", async (req: AuthedRequest, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const tickets = await prisma.ticket.findMany({
    where: {
      storeId: req.user!.storeId,
      status: status ? status : { in: ["open", "held"] },
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

  const ticket = await prisma.ticket.create({
    data: {
      storeId: req.user!.storeId,
      registerId: body.registerId,
      employeeId: req.user!.sub,
      name: body.name ?? `Ticket ${nanoid(4)}`,
      status: "open",
    },
  });
  res.status(201).json(await serializeTicket(ticket.id));
});

posRouter.get("/tickets/:id", async (req, res) => {
  res.json(await serializeTicket(req.params.id));
});

posRouter.post("/tickets/:id/lines", async (req: AuthedRequest, res) => {
  const body = z
    .object({
      variantId: z.string(),
      quantity: z.number().positive().default(1),
      modifiers: z
        .array(z.object({ modifierId: z.string().optional(), name: z.string(), priceCents: z.number().int() }))
        .optional(),
      note: z.string().optional(),
    })
    .parse(req.body);

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
      modifiersJson: JSON.stringify(body.modifiers ?? []),
      note: body.note,
    },
  });
  await prisma.ticket.update({ where: { id: req.params.id }, data: { updatedAt: new Date() } });
  res.status(201).json(await serializeTicket(req.params.id));
});

posRouter.patch("/tickets/:id/lines/:lineId", async (req, res) => {
  const body = z
    .object({
      quantity: z.number().positive().optional(),
      discountCents: z.number().int().optional(),
      note: z.string().nullable().optional(),
    })
    .parse(req.body);
  await prisma.ticketLine.update({ where: { id: req.params.lineId }, data: body });
  res.json(await serializeTicket(req.params.id));
});

posRouter.delete("/tickets/:id/lines/:lineId", async (req, res) => {
  await prisma.ticketLine.delete({ where: { id: req.params.lineId } });
  res.json(await serializeTicket(req.params.id));
});

posRouter.patch("/tickets/:id", async (req, res) => {
  const body = z
    .object({
      name: z.string().optional(),
      status: z.enum(["open", "held"]).optional(),
      customerId: z.string().nullable().optional(),
      discountCents: z.number().int().optional(),
      discountPercent: z.number().optional(),
      tipCents: z.number().int().optional(),
      note: z.string().nullable().optional(),
    })
    .parse(req.body);
  await prisma.ticket.update({ where: { id: req.params.id }, data: body });
  res.json(await serializeTicket(req.params.id));
});

posRouter.post("/tickets/:id/hold", async (req, res) => {
  await prisma.ticket.update({ where: { id: req.params.id }, data: { status: "held" } });
  res.json(await serializeTicket(req.params.id));
});

posRouter.post("/tickets/:id/recall", async (req, res) => {
  await prisma.ticket.update({ where: { id: req.params.id }, data: { status: "open" } });
  res.json(await serializeTicket(req.params.id));
});

posRouter.post("/tickets/:id/pay", async (req: AuthedRequest, res) => {
  const body = z
    .object({
      payments: z
        .array(
          z.object({
            paymentTypeId: z.string(),
            amountCents: z.number().int().positive(),
            tenderedCents: z.number().int().optional(),
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
    where: { id: { in: body.payments.map((p) => p.paymentTypeId) } },
  });
  const ptMap = new Map(paymentTypes.map((p) => [p.id, p]));

  // Store credit deduction
  for (const p of body.payments) {
    const pt = ptMap.get(p.paymentTypeId);
    if (pt?.type === "store_credit" && ticket.customerId) {
      const cust = await prisma.customer.findUniqueOrThrow({ where: { id: ticket.customerId } });
      if (cust.storeCreditCents < p.amountCents) {
        return res.status(400).json({ error: "Insufficient store credit" });
      }
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
      discountCents: totals.discountCents + Math.round((totals.subtotalCents * (ticket.discountPercent || 0)) / 100),
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
        })),
      },
    },
    include: { lines: true, payments: true, employee: true, customer: true },
  });

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
  const shift = await prisma.shift.findFirst({
    where: { registerId: body.registerId, status: "open" },
  });
  if (!shift) return res.status(400).json({ error: "No open shift" });
  const event = await prisma.cashEvent.create({
    data: { shiftId: shift.id, type: "drawer_open", amountCents: 0, note: body.note ?? "Manual open" },
  });
  res.json({ ok: true, event });
});
