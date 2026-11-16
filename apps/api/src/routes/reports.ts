import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireRole, type AuthedRequest } from "../auth.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);
reportsRouter.use(requireRole("owner", "manager", "cashier"));

function dateRange(req: { query: Record<string, unknown> }) {
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : new Date(Date.now() - 7 * 86400000);
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : new Date();
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

reportsRouter.get("/summary", async (req: AuthedRequest, res) => {
  const { from, to } = dateRange(req);
  const sales = await prisma.sale.findMany({
    where: {
      storeId: req.user!.storeId,
      status: "completed",
      createdAt: { gte: from, lte: to },
    },
    include: { payments: true, lines: true },
  });

  const gross = sales.reduce((s, x) => s + x.totalCents, 0);
  const tax = sales.reduce((s, x) => s + x.taxCents, 0);
  const tips = sales.reduce((s, x) => s + x.tipCents, 0);
  const discounts = sales.reduce((s, x) => s + x.discountCents, 0);
  const net = gross - tips;

  res.json({
    from: from.toISOString(),
    to: to.toISOString(),
    receiptCount: sales.length,
    grossSalesCents: gross,
    netSalesCents: net,
    taxCents: tax,
    tipCents: tips,
    discountCents: discounts,
    avgTicketCents: sales.length ? Math.round(gross / sales.length) : 0,
  });
});

reportsRouter.get("/by-item", async (req: AuthedRequest, res) => {
  const { from, to } = dateRange(req);
  const sales = await prisma.sale.findMany({
    where: {
      storeId: req.user!.storeId,
      status: "completed",
      createdAt: { gte: from, lte: to },
    },
    include: { lines: true },
  });
  const map = new Map<string, { name: string; qty: number; salesCents: number }>();
  for (const sale of sales) {
    for (const line of sale.lines) {
      const cur = map.get(line.name) ?? { name: line.name, qty: 0, salesCents: 0 };
      cur.qty += line.quantity;
      cur.salesCents += line.totalCents;
      map.set(line.name, cur);
    }
  }
  res.json([...map.values()].sort((a, b) => b.salesCents - a.salesCents));
});

reportsRouter.get("/by-category", async (req: AuthedRequest, res) => {
  const { from, to } = dateRange(req);
  const sales = await prisma.sale.findMany({
    where: {
      storeId: req.user!.storeId,
      status: "completed",
      createdAt: { gte: from, lte: to },
    },
    include: { lines: { include: { variant: { include: { item: { include: { category: true } } } } } } },
  });
  const map = new Map<string, { name: string; qty: number; salesCents: number }>();
  for (const sale of sales) {
    for (const line of sale.lines) {
      const cat = line.variant?.item.category?.name ?? "Uncategorized";
      const cur = map.get(cat) ?? { name: cat, qty: 0, salesCents: 0 };
      cur.qty += line.quantity;
      cur.salesCents += line.totalCents;
      map.set(cat, cur);
    }
  }
  res.json([...map.values()].sort((a, b) => b.salesCents - a.salesCents));
});

reportsRouter.get("/by-employee", async (req: AuthedRequest, res) => {
  const { from, to } = dateRange(req);
  const sales = await prisma.sale.findMany({
    where: {
      storeId: req.user!.storeId,
      status: "completed",
      createdAt: { gte: from, lte: to },
    },
    include: { employee: true },
  });
  const map = new Map<string, { name: string; receipts: number; salesCents: number }>();
  for (const sale of sales) {
    const cur = map.get(sale.employeeId) ?? { name: sale.employee.name, receipts: 0, salesCents: 0 };
    cur.receipts += 1;
    cur.salesCents += sale.totalCents;
    map.set(sale.employeeId, cur);
  }
  res.json([...map.values()].sort((a, b) => b.salesCents - a.salesCents));
});

reportsRouter.get("/payments", async (req: AuthedRequest, res) => {
  const { from, to } = dateRange(req);
  const sales = await prisma.sale.findMany({
    where: {
      storeId: req.user!.storeId,
      status: "completed",
      createdAt: { gte: from, lte: to },
    },
    include: { payments: true },
  });
  const map = new Map<string, { name: string; count: number; amountCents: number }>();
  for (const sale of sales) {
    for (const p of sale.payments) {
      const cur = map.get(p.paymentTypeName) ?? { name: p.paymentTypeName, count: 0, amountCents: 0 };
      cur.count += 1;
      cur.amountCents += p.amountCents;
      map.set(p.paymentTypeName, cur);
    }
  }
  res.json([...map.values()]);
});

reportsRouter.get("/taxes", async (req: AuthedRequest, res) => {
  const { from, to } = dateRange(req);
  const sales = await prisma.sale.findMany({
    where: {
      storeId: req.user!.storeId,
      status: "completed",
      createdAt: { gte: from, lte: to },
    },
  });
  const taxes = await prisma.tax.findMany({ where: { storeId: req.user!.storeId } });
  res.json({
    totalTaxCents: sales.reduce((s, x) => s + x.taxCents, 0),
    taxableSalesCents: sales.reduce((s, x) => s + x.subtotalCents - x.discountCents, 0),
    taxes,
    receiptCount: sales.length,
  });
});

reportsRouter.get("/shifts", async (req: AuthedRequest, res) => {
  const { from, to } = dateRange(req);
  const shifts = await prisma.shift.findMany({
    where: {
      storeId: req.user!.storeId,
      openedAt: { gte: from, lte: to },
    },
    include: { employee: true, register: true },
    orderBy: { openedAt: "desc" },
  });
  res.json(
    shifts.map((s) => ({
      id: s.id,
      employeeName: s.employee.name,
      registerName: s.register.name,
      openedAt: s.openedAt.toISOString(),
      closedAt: s.closedAt?.toISOString() ?? null,
      openingFloatCents: s.openingFloatCents,
      closingCashCents: s.closingCashCents,
      expectedCashCents: s.expectedCashCents,
      differenceCents: s.differenceCents,
      status: s.status,
    }))
  );
});
