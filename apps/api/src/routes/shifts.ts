import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { owned } from "../tenant.js";
import { requireAuth, type AuthedRequest } from "../auth.js";

export const shiftsRouter = Router();
shiftsRouter.use(requireAuth);

shiftsRouter.get("/", async (req: AuthedRequest, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const shifts = await prisma.shift.findMany({
    where: {
      storeId: req.user!.storeId,
      ...(status ? { status } : {}),
    },
    include: { employee: true, register: true, cashEvents: true },
    orderBy: { openedAt: "desc" },
    take: 100,
  });
  res.json(
    shifts.map((s) => ({
      id: s.id,
      storeId: s.storeId,
      registerId: s.registerId,
      registerName: s.register.name,
      employeeId: s.employeeId,
      employeeName: s.employee.name,
      openedAt: s.openedAt.toISOString(),
      closedAt: s.closedAt?.toISOString() ?? null,
      openingFloatCents: s.openingFloatCents,
      closingCashCents: s.closingCashCents,
      expectedCashCents: s.expectedCashCents,
      differenceCents: s.differenceCents,
      note: s.note,
      status: s.status,
      cashEvents: s.cashEvents,
    }))
  );
});

shiftsRouter.get("/current", async (req: AuthedRequest, res) => {
  const registerId = typeof req.query.registerId === "string" ? req.query.registerId : undefined;
  const shift = await prisma.shift.findFirst({
    where: {
      storeId: req.user!.storeId,
      status: "open",
      ...(registerId ? { registerId } : {}),
    },
    include: { employee: true, register: true, cashEvents: true },
    orderBy: { openedAt: "desc" },
  });
  if (!shift) return res.json(null);
  res.json({
    id: shift.id,
    storeId: shift.storeId,
    registerId: shift.registerId,
    registerName: shift.register.name,
    employeeId: shift.employeeId,
    employeeName: shift.employee.name,
    openedAt: shift.openedAt.toISOString(),
    openingFloatCents: shift.openingFloatCents,
    status: shift.status,
    cashEvents: shift.cashEvents,
  });
});

shiftsRouter.post("/open", async (req: AuthedRequest, res) => {
  const body = z
    .object({
      registerId: z.string(),
      openingFloatCents: z.number().int().nonnegative(),
      note: z.string().optional(),
    })
    .parse(req.body);

  const existing = await prisma.shift.findFirst({
    where: { registerId: body.registerId, status: "open" },
  });
  if (existing) return res.status(400).json({ error: "Shift already open on this register" });

  const shift = await prisma.shift.create({
    data: {
      storeId: req.user!.storeId,
      registerId: body.registerId,
      employeeId: req.user!.sub,
      openingFloatCents: body.openingFloatCents,
      note: body.note,
      status: "open",
    },
    include: { employee: true, register: true },
  });
  res.status(201).json({
    id: shift.id,
    registerId: shift.registerId,
    registerName: shift.register.name,
    employeeName: shift.employee.name,
    openingFloatCents: shift.openingFloatCents,
    openedAt: shift.openedAt.toISOString(),
    status: shift.status,
  });
});

shiftsRouter.post("/:id/cash", owned("shift"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      type: z.enum(["pay_in", "pay_out"]),
      amountCents: z.number().int().positive(),
      note: z.string().optional(),
    })
    .parse(req.body);
  const event = await prisma.cashEvent.create({
    data: {
      shiftId: req.params.id,
      type: body.type,
      amountCents: body.type === "pay_out" ? -body.amountCents : body.amountCents,
      note: body.note,
    },
  });
  res.status(201).json(event);
});

shiftsRouter.post("/:id/close", owned("shift"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      closingCashCents: z.number().int().nonnegative(),
      note: z.string().optional(),
    })
    .parse(req.body);

  const shift = await prisma.shift.findUniqueOrThrow({
    where: { id: req.params.id },
    include: { cashEvents: true },
  });
  if (shift.status !== "open") return res.status(400).json({ error: "Shift not open" });

  const sales = await prisma.sale.findMany({
    where: { shiftId: shift.id, status: "completed" },
    include: { payments: true },
  });

  let cashSales = 0;
  for (const sale of sales) {
    for (const p of sale.payments) {
      if (p.paymentTypeName.toLowerCase() === "cash") {
        cashSales += p.amountCents - (sale.changeCents || 0);
      }
    }
  }
  const cashEventsSum = shift.cashEvents
    .filter((e) => e.type === "pay_in" || e.type === "pay_out")
    .reduce((s, e) => s + e.amountCents, 0);

  const expected = shift.openingFloatCents + cashSales + cashEventsSum;
  const difference = body.closingCashCents - expected;

  const updated = await prisma.shift.update({
    where: { id: shift.id },
    data: {
      status: "closed",
      closedAt: new Date(),
      closingCashCents: body.closingCashCents,
      expectedCashCents: expected,
      differenceCents: difference,
      note: body.note ?? shift.note,
    },
    include: { employee: true, register: true },
  });

  res.json({
    id: updated.id,
    status: updated.status,
    closedAt: updated.closedAt?.toISOString(),
    openingFloatCents: updated.openingFloatCents,
    closingCashCents: updated.closingCashCents,
    expectedCashCents: updated.expectedCashCents,
    differenceCents: updated.differenceCents,
    cashSalesCents: cashSales,
    employeeName: updated.employee.name,
    registerName: updated.register.name,
  });
});
