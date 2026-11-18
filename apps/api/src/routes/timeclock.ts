import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole, type AuthedRequest } from "../auth.js";

export const timeClockRouter = Router();
timeClockRouter.use(requireAuth);

timeClockRouter.get("/entries", requireRole("owner", "manager", "cashier"), async (req: AuthedRequest, res) => {
  const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
  const mine = req.query.mine === "1" || req.query.mine === "true";
  const entries = await prisma.timeClockEntry.findMany({
    where: {
      storeId: req.user!.storeId,
      ...(mine ? { employeeId: req.user!.sub } : employeeId ? { employeeId } : {}),
    },
    include: { employee: true },
    orderBy: { clockIn: "desc" },
    take: 200,
  });
  res.json(
    entries.map((e) => ({
      id: e.id,
      storeId: e.storeId,
      employeeId: e.employeeId,
      employeeName: e.employee.name,
      clockIn: e.clockIn.toISOString(),
      clockOut: e.clockOut?.toISOString() ?? null,
      note: e.note,
      hours:
        e.clockOut != null
          ? Math.round(((e.clockOut.getTime() - e.clockIn.getTime()) / 3600000) * 100) / 100
          : null,
    }))
  );
});

timeClockRouter.get("/status", async (req: AuthedRequest, res) => {
  const open = await prisma.timeClockEntry.findFirst({
    where: { employeeId: req.user!.sub, clockOut: null },
    orderBy: { clockIn: "desc" },
  });
  res.json(
    open
      ? { clockedIn: true, entryId: open.id, clockIn: open.clockIn.toISOString() }
      : { clockedIn: false, entryId: null, clockIn: null }
  );
});

timeClockRouter.post("/clock-in", async (req: AuthedRequest, res) => {
  const body = z.object({ note: z.string().optional() }).parse(req.body ?? {});
  const open = await prisma.timeClockEntry.findFirst({
    where: { employeeId: req.user!.sub, clockOut: null },
  });
  if (open) return res.status(400).json({ error: "Already clocked in", entryId: open.id });
  const entry = await prisma.timeClockEntry.create({
    data: {
      storeId: req.user!.storeId,
      employeeId: req.user!.sub,
      note: body.note,
    },
    include: { employee: true },
  });
  res.status(201).json({
    id: entry.id,
    employeeName: entry.employee.name,
    clockIn: entry.clockIn.toISOString(),
    clockOut: null,
  });
});

timeClockRouter.post("/clock-out", async (req: AuthedRequest, res) => {
  const body = z.object({ note: z.string().optional() }).parse(req.body ?? {});
  const open = await prisma.timeClockEntry.findFirst({
    where: { employeeId: req.user!.sub, clockOut: null },
    orderBy: { clockIn: "desc" },
  });
  if (!open) return res.status(400).json({ error: "Not clocked in" });
  const entry = await prisma.timeClockEntry.update({
    where: { id: open.id },
    data: {
      clockOut: new Date(),
      note: body.note ?? open.note,
    },
    include: { employee: true },
  });
  res.json({
    id: entry.id,
    employeeName: entry.employee.name,
    clockIn: entry.clockIn.toISOString(),
    clockOut: entry.clockOut!.toISOString(),
    hours: Math.round(((entry.clockOut!.getTime() - entry.clockIn.getTime()) / 3600000) * 100) / 100,
  });
});
