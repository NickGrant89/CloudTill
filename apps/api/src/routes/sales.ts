import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole, type AuthedRequest } from "../auth.js";
import { loadReceiptData, renderReceipt } from "../receipts.js";

export const salesRouter = Router();
salesRouter.use(requireAuth);

function mapSale(s: {
  id: string;
  receiptNumber: string;
  storeId: string;
  registerId: string;
  employeeId: string;
  customerId: string | null;
  status: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  paidCents: number;
  changeCents: number;
  createdAt: Date;
  employee: { name: string };
  customer: { name: string } | null;
  lines: unknown[];
  payments: unknown[];
}) {
  return {
    id: s.id,
    receiptNumber: s.receiptNumber,
    storeId: s.storeId,
    registerId: s.registerId,
    employeeId: s.employeeId,
    employeeName: s.employee.name,
    customerId: s.customerId,
    customerName: s.customer?.name ?? null,
    status: s.status,
    subtotalCents: s.subtotalCents,
    discountCents: s.discountCents,
    taxCents: s.taxCents,
    tipCents: s.tipCents,
    totalCents: s.totalCents,
    paidCents: s.paidCents,
    changeCents: s.changeCents,
    lines: s.lines,
    payments: s.payments,
    createdAt: s.createdAt.toISOString(),
  };
}

salesRouter.get("/", async (req: AuthedRequest, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const sales = await prisma.sale.findMany({
    where: {
      storeId: req.user!.storeId,
      ...(q
        ? {
            OR: [
              { receiptNumber: { contains: q } },
              { customer: { name: { contains: q } } },
            ],
          }
        : {}),
    },
    include: { lines: true, payments: true, employee: true, customer: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json(sales.map(mapSale));
});

salesRouter.get("/:id", async (req, res) => {
  const sale = await prisma.sale.findUniqueOrThrow({
    where: { id: req.params.id },
    include: { lines: true, payments: true, employee: true, customer: true, register: true },
  });
  res.json({ ...mapSale(sale), registerName: sale.register.name });
});

salesRouter.post("/:id/void", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const sale = await prisma.sale.findUniqueOrThrow({
    where: { id: req.params.id },
    include: { lines: true },
  });
  if (sale.status === "voided") return res.status(400).json({ error: "Already voided" });

  for (const line of sale.lines) {
    if (!line.variantId) continue;
    const variant = await prisma.variant.findUnique({ where: { id: line.variantId } });
    if (variant?.trackStock) {
      const level = await prisma.inventoryLevel.findUnique({
        where: { storeId_variantId: { storeId: sale.storeId, variantId: line.variantId } },
      });
      if (level) {
        await prisma.inventoryLevel.update({
          where: { id: level.id },
          data: { quantity: level.quantity + line.quantity },
        });
      }
      await prisma.inventoryMovement.create({
        data: {
          storeId: sale.storeId,
          variantId: line.variantId,
          type: "refund",
          quantity: line.quantity,
          note: `Void ${sale.receiptNumber}`,
          employeeId: req.user!.sub,
        },
      });
    }
  }

  const updated = await prisma.sale.update({
    where: { id: sale.id },
    data: { status: "voided" },
    include: { lines: true, payments: true, employee: true, customer: true },
  });
  res.json(mapSale(updated));
});

salesRouter.post("/:id/refund", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      lineIds: z.array(z.string()).optional(),
      full: z.boolean().optional(),
    })
    .parse(req.body);

  const sale = await prisma.sale.findUniqueOrThrow({
    where: { id: req.params.id },
    include: { lines: true },
  });

  const linesToRefund = body.full || !body.lineIds?.length
    ? sale.lines
    : sale.lines.filter((l) => body.lineIds!.includes(l.id));

  for (const line of linesToRefund) {
    if (!line.variantId) continue;
    const variant = await prisma.variant.findUnique({ where: { id: line.variantId } });
    if (variant?.trackStock) {
      const level = await prisma.inventoryLevel.findUnique({
        where: { storeId_variantId: { storeId: sale.storeId, variantId: line.variantId } },
      });
      if (level) {
        await prisma.inventoryLevel.update({
          where: { id: level.id },
          data: { quantity: level.quantity + line.quantity },
        });
      }
      await prisma.inventoryMovement.create({
        data: {
          storeId: sale.storeId,
          variantId: line.variantId,
          type: "refund",
          quantity: line.quantity,
          note: `Refund ${sale.receiptNumber}`,
          employeeId: req.user!.sub,
        },
      });
    }
  }

  const full = linesToRefund.length === sale.lines.length;
  const updated = await prisma.sale.update({
    where: { id: sale.id },
    data: { status: full ? "refunded" : "partial_refund" },
    include: { lines: true, payments: true, employee: true, customer: true },
  });
  res.json(mapSale(updated));
});

salesRouter.get("/:id/receipt", async (req, res) => {
  const format = (typeof req.query.format === "string" ? req.query.format : "text") as
    | "text"
    | "html"
    | "escpos"
    | "escpos-base64";
  const data = await loadReceiptData(req.params.id);
  const rendered = renderReceipt(data, format);
  if (format === "escpos") {
    res.setHeader("Content-Type", rendered.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${data.receiptNumber}.bin"`);
    return res.send(rendered.body);
  }
  if (format === "escpos-base64") {
    res.type("json").send(rendered.body);
    return;
  }
  if (format === "html") {
    res.type("html").send(rendered.body);
    return;
  }
  res.type("text").send(rendered.body);
});

salesRouter.post("/:id/print", async (req: AuthedRequest, res) => {
  const body = z
    .object({
      format: z.enum(["text", "html", "escpos-base64"]).default("escpos-base64"),
      openDrawer: z.boolean().optional(),
    })
    .parse(req.body ?? {});
  const data = await loadReceiptData(req.params.id);
  const rendered = renderReceipt(data, body.format);
  res.json({
    saleId: req.params.id,
    receiptNumber: data.receiptNumber,
    format: body.format,
    openDrawer: body.openDrawer ?? false,
    payload: body.format === "escpos-base64" ? JSON.parse(String(rendered.body)) : rendered.body,
  });
});
