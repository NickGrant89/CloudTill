import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole, type AuthedRequest } from "../auth.js";

export const extrasRouter = Router();
extrasRouter.use(requireAuth);

/** Open tickets board (POS + kitchen-adjacent) */
extrasRouter.get("/tickets-board", async (req: AuthedRequest, res) => {
  const tickets = await prisma.ticket.findMany({
    where: {
      storeId: req.user!.storeId,
      status: { in: ["open", "held"] },
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
      modifierGroups: { include: { modifiers: { where: { active: true } } } },
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

  const variants = await prisma.variant.findMany({
    where: { id: { in: body.variantIds } },
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
  const day = typeof req.query.date === "string" ? req.query.date : new Date().toISOString().slice(0, 10);
  const from = new Date(`${day}T00:00:00.000Z`);
  const to = new Date(`${day}T23:59:59.999Z`);

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
extrasRouter.post("/eod-email", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      to: z.string().email().default("owner@purepos.demo"),
      date: z.string().optional(),
    })
    .parse(req.body ?? {});
  const day = body.date ?? new Date().toISOString().slice(0, 10);
  const from = new Date(`${day}T00:00:00.000Z`);
  const to = new Date(`${day}T23:59:59.999Z`);
  const sales = await prisma.sale.findMany({
    where: { storeId: req.user!.storeId, status: "completed", createdAt: { gte: from, lte: to } },
  });
  const gross = sales.reduce((s, x) => s + x.totalCents, 0);
  const payload = {
    to: body.to,
    subject: `PurePOS EOD ${day}`,
    text: `End of day ${day}\nReceipts: ${sales.length}\nGross: $${(gross / 100).toFixed(2)}\nCSV available via GET /api/extras/eod.csv?date=${day}`,
    queued: true,
    provider: "stub",
  };
  await prisma.setting.upsert({
    where: { storeId_key: { storeId: req.user!.storeId, key: `eod.lastEmail.${day}` } },
    create: { storeId: req.user!.storeId, key: `eod.lastEmail.${day}`, value: JSON.stringify(payload) },
    update: { value: JSON.stringify(payload) },
  });
  res.json(payload);
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
