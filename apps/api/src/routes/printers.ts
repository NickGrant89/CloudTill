import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { owned } from "../tenant.js";
import { requireAuth, requireRole, type AuthedRequest } from "../auth.js";
import { createDriver, getMockDriver } from "../printers/drivers.js";
import { loadReceiptData, renderReceipt } from "../receipts.js";
import { drawerKickBytes } from "@cloudtill/shared";

export const printersRouter = Router();
printersRouter.use(requireAuth);

printersRouter.get("/", async (req: AuthedRequest, res) => {
  const printers = await prisma.printerDevice.findMany({
    where: { storeId: req.user!.storeId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  res.json(printers);
});

printersRouter.post("/", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      name: z.string().min(1),
      driver: z.enum(["mock", "network", "usb_bridge"]).default("mock"),
      host: z.string().optional(),
      port: z.number().int().optional(),
      isDefault: z.boolean().optional(),
    })
    .parse(req.body);

  if (body.isDefault) {
    await prisma.printerDevice.updateMany({
      where: { storeId: req.user!.storeId },
      data: { isDefault: false },
    });
  }

  const printer = await prisma.printerDevice.create({
    data: {
      storeId: req.user!.storeId,
      name: body.name,
      driver: body.driver,
      host: body.host,
      port: body.port ?? 9100,
      isDefault: body.isDefault ?? false,
    },
  });
  res.status(201).json(printer);
});

printersRouter.get("/jobs", async (req: AuthedRequest, res) => {
  const jobs = await prisma.printJob.findMany({
    where: { storeId: req.user!.storeId },
    include: { printer: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(jobs);
});

printersRouter.get("/mock/log", async (_req, res) => {
  res.json({ driver: "mock", jobs: getMockDriver().jobs });
});

async function resolvePrinter(storeId: string, printerId?: string) {
  if (printerId) {
    return prisma.printerDevice.findFirst({ where: { id: printerId, storeId } });
  }
  return prisma.printerDevice.findFirst({
    where: { storeId, enabled: true },
    orderBy: { isDefault: "desc" },
  });
}

printersRouter.post("/print-receipt", async (req: AuthedRequest, res) => {
  const body = z
    .object({
      saleId: z.string(),
      printerId: z.string().optional(),
      openDrawer: z.boolean().optional(),
    })
    .parse(req.body);

  const data = await loadReceiptData(body.saleId);
  const rendered = renderReceipt(data, "escpos");
  const bytes = rendered.body instanceof Buffer ? rendered.body : Buffer.from(String(rendered.body));
  const printer = await resolvePrinter(req.user!.storeId, body.printerId);

  const job = await prisma.printJob.create({
    data: {
      storeId: req.user!.storeId,
      printerId: printer?.id,
      type: "receipt",
      status: "printing",
      payloadB64: bytes.toString("base64"),
      preview: renderReceipt(data, "text").body.toString(),
      saleId: body.saleId,
    },
  });

  const driver = createDriver({
    driver: printer?.driver ?? "mock",
    host: printer?.host,
    port: printer?.port,
  });
  const result = await driver.print(new Uint8Array(bytes), { jobId: job.id, type: "receipt" });

  if (body.openDrawer) {
    await driver.openDrawer?.(drawerKickBytes());
  }

  const updated = await prisma.printJob.update({
    where: { id: job.id },
    data: {
      status: result.ok ? "printed" : "failed",
      error: result.ok ? null : result.detail,
      printedAt: result.ok ? new Date() : null,
    },
  });

  res.json({ job: updated, result, printer });
});

printersRouter.post("/jobs/:id/retry", owned("printJob"), async (req: AuthedRequest, res) => {
  const job = await prisma.printJob.findUniqueOrThrow({
    where: { id: req.params.id },
    include: { printer: true },
  });
  const bytes = Buffer.from(job.payloadB64, "base64");
  const driver = createDriver({
    driver: job.printer?.driver ?? "mock",
    host: job.printer?.host,
    port: job.printer?.port,
  });
  const result = await driver.print(new Uint8Array(bytes), { jobId: job.id, type: job.type });
  const updated = await prisma.printJob.update({
    where: { id: job.id },
    data: {
      status: result.ok ? "printed" : "failed",
      error: result.ok ? null : result.detail,
      printedAt: result.ok ? new Date() : null,
    },
  });
  res.json({ job: updated, result });
});

printersRouter.post("/process-queue", async (req: AuthedRequest, res) => {
  const queued = await prisma.printJob.findMany({
    where: { storeId: req.user!.storeId, status: "queued" },
    include: { printer: true },
    take: 20,
  });
  const results = [];
  for (const job of queued) {
    const bytes = Buffer.from(job.payloadB64, "base64");
    const driver = createDriver({
      driver: job.printer?.driver ?? "mock",
      host: job.printer?.host,
      port: job.printer?.port,
    });
    const result = await driver.print(new Uint8Array(bytes), { jobId: job.id, type: job.type });
    const updated = await prisma.printJob.update({
      where: { id: job.id },
      data: {
        status: result.ok ? "printed" : "failed",
        error: result.ok ? null : result.detail,
        printedAt: result.ok ? new Date() : null,
      },
    });
    results.push({ job: updated, result });
  }
  res.json({ processed: results.length, results });
});
