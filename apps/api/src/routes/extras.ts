import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole, type AuthedRequest } from "../auth.js";
import { rejectForeign } from "../tenant.js";

export const extrasRouter = Router();
extrasRouter.use(requireAuth);

/** UTC instants for the start and end of `day` (YYYY-MM-DD) in the store's own time zone. */
async function storeDayBounds(storeId: string, rawDay: unknown) {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { timezone: true } });
  const tz = store?.timezone || "Europe/London";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: tz });
  const day = typeof rawDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : today;
  const offsetAt = (utcMs: number) => {
    const local = new Date(new Date(utcMs).toLocaleString("en-US", { timeZone: tz }));
    const utc = new Date(new Date(utcMs).toLocaleString("en-US", { timeZone: "UTC" }));
    return local.getTime() - utc.getTime();
  };
  const startGuess = Date.parse(`${day}T00:00:00.000Z`);
  const from = new Date(startGuess - offsetAt(startGuess));
  const nextGuess = startGuess + 24 * 60 * 60 * 1000;
  const to = new Date(nextGuess - offsetAt(nextGuess) - 1);
  return { day, from, to };
}

/** Open tickets board (POS + kitchen-adjacent) */
extrasRouter.get("/tickets-board", async (req: AuthedRequest, res) => {
  const storeId = req.user!.storeId;
  // Stale empty placeholders only — do not void the till's current empty sale
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);
  const stale = await prisma.ticket.findMany({
    where: { storeId, status: "open", lines: { none: {} }, updatedAt: { lt: cutoff } },
    select: { id: true },
  });
  if (stale.length) {
    await prisma.ticket.updateMany({
      where: { id: { in: stale.map((row) => row.id) } },
      data: { status: "voided" },
    });
  }

  const tickets = await prisma.ticket.findMany({
    where: {
      storeId,
      OR: [
        { status: "held" },
        { status: "open", lines: { some: {} } },
      ],
    },
    include: { lines: true, customer: true, register: true },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  res.json(
    tickets.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      source: t.source,
      kitchenStatus: t.kitchenStatus,
      registerName: t.register.name,
      customerName: t.customer?.name ?? null,
      lineCount: t.lines.length,
      lines: t.lines.map((l) => ({ name: l.name, quantity: l.quantity })),
      note: t.note,
      updatedAt: t.updatedAt.toISOString(),
      createdAt: t.createdAt.toISOString(),
    }))
  );
});

/** Favorites / quick keys (stored per store in settings) */
extrasRouter.get("/favorites", async (req: AuthedRequest, res) => {
  const row = await prisma.setting.findUnique({
    where: { storeId_key: { storeId: req.user!.storeId, key: "pos.favorites" } },
  });
  const itemIds: string[] = row ? JSON.parse(row.value) : [];
  if (!itemIds.length) return res.json([]);
  const items = await prisma.item.findMany({
    where: { id: { in: itemIds }, storeId: req.user!.storeId, active: true },
    include: {
      variants: { where: { active: true } },
      modifierGroups: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: {
          modifiers: { where: { active: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
        },
      },
    },
  });
  const order = new Map(itemIds.map((id, i) => [id, i]));
  items.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  res.json(items);
});

extrasRouter.put("/favorites", requireRole("owner", "manager", "cashier"), async (req: AuthedRequest, res) => {
  const body = z.object({ itemIds: z.array(z.string()).max(24) }).parse(req.body);
  await prisma.setting.upsert({
    where: { storeId_key: { storeId: req.user!.storeId, key: "pos.favorites" } },
    create: { storeId: req.user!.storeId, key: "pos.favorites", value: JSON.stringify(body.itemIds) },
    update: { value: JSON.stringify(body.itemIds) },
  });
  res.json({ ok: true, itemIds: body.itemIds });
});

/** Tip suggestions based on subtotal + store presets */
extrasRouter.get("/tip-suggestions", async (req: AuthedRequest, res) => {
  const subtotal = Number(req.query.subtotalCents ?? 0);
  const row = await prisma.setting.findUnique({
    where: { storeId_key: { storeId: req.user!.storeId, key: "tips.presets" } },
  });
  const presets: number[] = row ? JSON.parse(row.value) : [10, 15, 20];
  const suggestions = [
    ...presets.map((p) => ({
      label: `${p}%`,
      percent: p,
      tipCents: Math.round((subtotal * p) / 100),
    })),
    { label: "No tip", percent: 0, tipCents: 0 },
    {
      label: "Round up",
      percent: null as number | null,
      tipCents: Math.max(0, Math.ceil(subtotal / 100) * 100 - subtotal),
    },
  ];
  res.json({ subtotalCents: subtotal, suggestions });
});

/** Barcode label helper — ESC/POS-ish text + HTML for shelf labels */
extrasRouter.post("/labels", async (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      variantIds: z.array(z.string()).min(1).max(50),
      copies: z.number().int().positive().max(20).default(1),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
  const body = parsed.data;
  if (await rejectForeign(res, "variant", body.variantIds, req.user!.storeId)) return;

  const variants = await prisma.variant.findMany({
    where: { id: { in: body.variantIds }, item: { storeId: req.user!.storeId } },
    include: { item: true },
  });

  const labels = variants.flatMap((v) =>
    Array.from({ length: body.copies }, () => ({
      name: v.item.name,
      variant: v.name,
      sku: v.sku,
      barcode: v.barcode ?? v.sku,
      priceCents: v.priceCents,
      text: [
        v.item.name,
        v.name !== "Regular" ? v.name : null,
        `£${(v.priceCents / 100).toFixed(2)}`,
        `*${v.barcode ?? v.sku}*`,
      ]
        .filter(Boolean)
        .join("\n"),
    }))
  );

  const html = `<!DOCTYPE html><html><head><title>Labels</title>
<style>
@page { size: 50mm 30mm; margin: 2mm; }
body { font-family: system-ui, sans-serif; }
.label { width: 46mm; height: 26mm; border: 1px dashed #ccc; padding: 3mm; page-break-after: always; }
.name { font-weight: 700; font-size: 12px; }
.price { font-size: 16px; margin: 4px 0; }
.bc { font-family: ui-monospace, monospace; font-size: 11px; letter-spacing: 0.08em; }
@media print { .no-print { display: none; } }
</style></head><body>
<p class="no-print"><button onclick="window.print()">Print labels</button></p>
${labels
  .map(
    (l) =>
      `<div class="label"><div class="name">${escapeHtml(l.name)}</div><div class="price">£${(
        l.priceCents / 100
      ).toFixed(2)}</div><div class="bc">${escapeHtml(l.barcode)}</div></div>`
  )
  .join("")}
</body></html>`;

  res.json({ labels, html, count: labels.length });
});

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** End-of-day CSV export (sales + payments summary) */
extrasRouter.get("/eod.csv", async (req: AuthedRequest, res) => {
  const { day, from, to } = await storeDayBounds(req.user!.storeId, req.query.date);

  const sales = await prisma.sale.findMany({
    where: {
      storeId: req.user!.storeId,
      createdAt: { gte: from, lte: to },
    },
    include: { payments: true, employee: true, lines: true },
    orderBy: { createdAt: "asc" },
  });

  const header = [
    "receiptNumber",
    "createdAt",
    "status",
    "employee",
    "subtotalCents",
    "discountCents",
    "taxCents",
    "tipCents",
    "totalCents",
    "payments",
    "lineItems",
  ];
  const rows = sales.map((s) =>
    [
      s.receiptNumber,
      s.createdAt.toISOString(),
      s.status,
      csvEscape(s.employee.name),
      s.subtotalCents,
      s.discountCents,
      s.taxCents,
      s.tipCents,
      s.totalCents,
      csvEscape(s.payments.map((p) => `${p.paymentTypeName}:${p.amountCents}`).join("|")),
      csvEscape(s.lines.map((l) => `${l.quantity}x ${l.name}`).join("|")),
    ].join(",")
  );

  const csv = [header.join(","), ...rows].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="eod-${day}.csv"`);
  res.send(csv);
});

/** Stub “email EOD” — returns payload that a mailer would send */
extrasRouter.get("/eod-summary", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const { day, from, to } = await storeDayBounds(req.user!.storeId, req.query.date);
  const sales = await prisma.sale.findMany({
    where: { storeId: req.user!.storeId, createdAt: { gte: from, lte: to } },
    include: { payments: true },
  });
  const completed = sales.filter((s) => s.status !== "voided");
  const byPayment = new Map<string, number>();
  for (const sale of completed) {
    for (const p of sale.payments) byPayment.set(p.paymentTypeName, (byPayment.get(p.paymentTypeName) ?? 0) + p.amountCents);
  }
  res.json({
    date: day,
    receipts: completed.length,
    voided: sales.length - completed.length,
    refunded: sales.filter((s) => s.status === "refunded" || s.status === "partial_refund").length,
    grossCents: completed.reduce((n, s) => n + s.totalCents, 0),
    taxCents: completed.reduce((n, s) => n + s.taxCents, 0),
    tipCents: completed.reduce((n, s) => n + s.tipCents, 0),
    discountCents: completed.reduce((n, s) => n + s.discountCents, 0),
    payments: [...byPayment.entries()].map(([name, amountCents]) => ({ name, amountCents })),
  });
});

function csvEscape(s: string) {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Stocktake / inventory count */
extrasRouter.get("/stocktake", async (req: AuthedRequest, res) => {
  const levels = await prisma.inventoryLevel.findMany({
    where: { storeId: req.user!.storeId },
    include: { variant: { include: { item: true } } },
  });
  res.json(
    levels
      .filter((l) => l.variant.trackStock)
      .map((l) => ({
        levelId: l.id,
        variantId: l.variantId,
        itemName: l.variant.item.name,
        sku: l.variant.sku,
        systemQty: l.quantity,
        countedQty: null as number | null,
        variance: null as number | null,
      }))
  );
});

extrasRouter.post("/stocktake", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      counts: z.array(z.object({ variantId: z.string(), countedQty: z.number() })).min(1),
      note: z.string().optional(),
    })
    .parse(req.body);
  if (await rejectForeign(res, "variant", body.counts.map((c) => c.variantId), req.user!.storeId)) return;

  const results = [];
  for (const c of body.counts) {
    const level = await prisma.inventoryLevel.findUnique({
      where: { storeId_variantId: { storeId: req.user!.storeId, variantId: c.variantId } },
    });
    if (!level) continue;
    const variance = c.countedQty - level.quantity;
    await prisma.inventoryLevel.update({
      where: { id: level.id },
      data: { quantity: c.countedQty },
    });
    await prisma.inventoryMovement.create({
      data: {
        storeId: req.user!.storeId,
        variantId: c.variantId,
        type: "adjust",
        quantity: variance,
        note: body.note ?? `Stocktake count → ${c.countedQty}`,
        employeeId: req.user!.sub,
      },
    });
    results.push({ variantId: c.variantId, previous: level.quantity, counted: c.countedQty, variance });
  }
  res.json({ ok: true, results });
});

/** Pilot helper: wipe + reseed demo data (owner only). */
extrasRouter.post("/demo-reset", requireRole("owner"), async (_req: AuthedRequest, res) => {
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const cwd = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("npx", ["tsx", "prisma/seed.ts"], { cwd, stdio: "inherit", shell: process.platform === "win32" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Demo reset failed (exit ${code})`))));
    child.on("error", reject);
  });
  res.json({
    ok: true,
    message: "Demo data reset. Log in again with owner@purepos.demo / 1234.",
    health: "/api/health",
  });
});

/** Low-stock alerts for BO toast / push stub */
extrasRouter.get("/low-stock-alerts", async (req: AuthedRequest, res) => {
  const levels = await prisma.inventoryLevel.findMany({
    where: { storeId: req.user!.storeId },
    include: { variant: { include: { item: true } } },
  });
  const alerts = levels
    .filter((l) => l.variant.trackStock && l.quantity <= l.lowStock)
    .map((l) => ({
      variantId: l.variantId,
      itemName: l.variant.item.name,
      sku: l.variant.sku,
      quantity: l.quantity,
      lowStock: l.lowStock,
      message: `${l.variant.item.name} is low (${l.quantity} ≤ ${l.lowStock})`,
    }));
  res.json({
    count: alerts.length,
    alerts,
    pushStub: {
      channel: "in_app_toast",
      title: alerts.length ? `${alerts.length} low-stock item(s)` : "Stock OK",
      body: alerts
        .slice(0, 3)
        .map((a) => a.message)
        .join("; "),
    },
  });
});
