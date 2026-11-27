import { Router, type NextFunction, type Response } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireRole, type AuthedRequest } from "../auth.js";
import { storeAllowsFeature } from "./billing.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);
reportsRouter.use(requireRole("owner", "manager", "cashier"));

async function requireAdvancedReports(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!(await storeAllowsFeature(req.user!.storeId, "advanced_reports"))) {
    return res.status(402).json({
      error: "Richer reports need an active Complete or Multi plan. Upgrade in Settings → Billing.",
      feature: "advanced_reports",
    });
  }
  next();
}

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

reportsRouter.get("/by-item", requireAdvancedReports, async (req: AuthedRequest, res) => {
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

reportsRouter.get("/by-category", requireAdvancedReports, async (req: AuthedRequest, res) => {
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

reportsRouter.get("/by-employee", requireAdvancedReports, async (req: AuthedRequest, res) => {
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

reportsRouter.get("/payments", requireAdvancedReports, async (req: AuthedRequest, res) => {
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

reportsRouter.get("/taxes", requireAdvancedReports, async (req: AuthedRequest, res) => {
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

reportsRouter.get("/dashboard", async (req: AuthedRequest, res) => {
  const storeId = req.user!.storeId;
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(Date.now() - 7 * 86400000);
  const kitchenEntitled = await storeAllowsFeature(storeId, "kitchen");

  const [store, todaySales, weekSales, openTickets, lowLevels, openShifts, kitchenOrders] = await Promise.all([
    prisma.store.findUniqueOrThrow({
      where: { id: storeId },
      select: { id: true, name: true, slug: true, currency: true },
    }),
    prisma.sale.findMany({
      where: { storeId, status: "completed", createdAt: { gte: startOfToday } },
      select: { totalCents: true, taxCents: true, tipCents: true },
    }),
    prisma.sale.findMany({
      where: { storeId, status: "completed", createdAt: { gte: startOfWeek } },
      select: { totalCents: true },
    }),
    prisma.ticket.count({ where: { storeId, status: { in: ["open", "held"] } } }),
    prisma.inventoryLevel.findMany({
      where: { storeId },
      include: { variant: { include: { item: true } } },
    }),
    prisma.shift.count({ where: { storeId, status: "open" } }),
    kitchenEntitled
      ? prisma.onlineOrder.findMany({
          where: {
            storeId,
            status: { in: ["pending", "accepted", "preparing", "ready"] },
          },
          include: { lines: { select: { name: true, quantity: true } } },
          orderBy: { createdAt: "asc" },
          take: 8,
        })
      : Promise.resolve([]),
  ]);

  const sum = (rows: { totalCents: number }[]) => rows.reduce((s, r) => s + r.totalCents, 0);
  const todayGross = sum(todaySales);
  const weekGross = sum(weekSales);
  const lowStock = lowLevels.filter((l) => l.quantity <= l.lowStock);

  const kitchenCounts = { pending: 0, preparing: 0, ready: 0, total: kitchenOrders.length };
  for (const o of kitchenOrders) {
    if (o.status === "pending" || o.status === "accepted") kitchenCounts.pending += 1;
    else if (o.status === "preparing") kitchenCounts.preparing += 1;
    else if (o.status === "ready") kitchenCounts.ready += 1;
  }

  res.json({
    store,
    asOf: now.toISOString(),
    today: {
      receiptCount: todaySales.length,
      grossSalesCents: todayGross,
      taxCents: todaySales.reduce((s, x) => s + x.taxCents, 0),
      tipCents: todaySales.reduce((s, x) => s + x.tipCents, 0),
      avgTicketCents: todaySales.length ? Math.round(todayGross / todaySales.length) : 0,
    },
    week: {
      receiptCount: weekSales.length,
      grossSalesCents: weekGross,
      avgTicketCents: weekSales.length ? Math.round(weekGross / weekSales.length) : 0,
    },
    kitchen: {
      entitled: kitchenEntitled,
      counts: kitchenCounts,
      orders: kitchenOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        customerName: o.customerName,
        channel: o.channel,
        status: o.status,
        fulfillment: o.fulfillment,
        totalCents: o.totalCents,
        createdAt: o.createdAt.toISOString(),
        linesPreview: o.lines
          .slice(0, 3)
          .map((l) => `${l.quantity}× ${l.name}`)
          .join(", "),
      })),
    },
    openTickets,
    openShifts,
    lowStock: {
      count: lowStock.length,
      items: lowStock.slice(0, 5).map((l) => ({
        name: l.variant.item.name,
        sku: l.variant.sku,
        quantity: l.quantity,
        lowStock: l.lowStock,
      })),
    },
  });
});

reportsRouter.get("/shifts", requireAdvancedReports, async (req: AuthedRequest, res) => {
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
