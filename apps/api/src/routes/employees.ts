import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { owned } from "../tenant.js";
import { checkPin, hashPin, requireAuth, requireRole, type AuthedRequest } from "../auth.js";

export const employeesRouter = Router();
employeesRouter.use(requireAuth);

/** Till PIN must be unique among active staff at this store. */
async function activePinTaken(storeId: string, pin: string, exceptId?: string) {
  const employees = await prisma.employee.findMany({
    where: {
      storeId,
      active: true,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true, name: true, pinHash: true },
  });
  for (const emp of employees) {
    if (await checkPin(pin, emp.pinHash)) return emp;
  }
  return null;
}

employeesRouter.get("/", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const employees = await prisma.employee.findMany({
    where: { storeId: req.user!.storeId },
    orderBy: { name: "asc" },
  });
  res.json(
    employees.map((e) => ({
      id: e.id,
      name: e.name,
      email: e.email,
      role: e.role,
      active: e.active,
      hasPin: Boolean(e.pinHash),
      createdAt: e.createdAt.toISOString(),
    }))
  );
});

employeesRouter.post("/", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      name: z.string().min(1),
      email: z.string().email(),
      pin: z.string().min(4).max(8),
      role: z.enum(["owner", "manager", "cashier"]),
    })
    .parse(req.body);

  if (req.user!.role === "manager" && body.role === "owner") {
    return res.status(403).json({ error: "Managers cannot create owners" });
  }

  const taken = await activePinTaken(req.user!.storeId, body.pin);
  if (taken) {
    return res.status(409).json({
      error: `PIN already used by ${taken.name}. Each person on the till needs their own PIN.`,
    });
  }

  const employee = await prisma.employee.create({
    data: {
      storeId: req.user!.storeId,
      name: body.name,
      email: body.email.toLowerCase(),
      pinHash: await hashPin(body.pin),
      pinDisplay: "",
      role: body.role,
    },
  });
  res.status(201).json({
    id: employee.id,
    name: employee.name,
    email: employee.email,
    role: employee.role,
    active: employee.active,
    hasPin: true,
  });
});

employeesRouter.patch("/:id", owned("employee"), requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const body = z
    .object({
      name: z.string().min(1).optional(),
      email: z.string().email().optional(),
      pin: z.string().min(4).max(8).optional(),
      role: z.enum(["owner", "manager", "cashier"]).optional(),
      active: z.boolean().optional(),
    })
    .parse(req.body);

  const existing = await prisma.employee.findFirst({ where: { id, storeId: req.user!.storeId } });
  if (!existing) return res.status(404).json({ error: "Employee not found" });

  if (req.user!.role === "manager" && (existing.role === "owner" || body.role === "owner")) {
    return res.status(403).json({ error: "Managers cannot edit owners" });
  }

  if (body.active === false && id === req.user!.sub) {
    return res.status(400).json({ error: "You cannot deactivate your own login" });
  }

  if (body.active === false && existing.role === "owner") {
    const otherOwners = await prisma.employee.count({
      where: { storeId: req.user!.storeId, role: "owner", active: true, id: { not: id } },
    });
    if (otherOwners === 0) {
      return res.status(400).json({ error: "Keep at least one active owner" });
    }
  }

  if (body.role && body.role !== "owner" && existing.role === "owner") {
    const otherOwners = await prisma.employee.count({
      where: { storeId: req.user!.storeId, role: "owner", active: true, id: { not: id } },
    });
    if (otherOwners === 0) {
      return res.status(400).json({ error: "Keep at least one active owner" });
    }
  }

  if (body.pin) {
    const taken = await activePinTaken(req.user!.storeId, body.pin, id);
    if (taken) {
      return res.status(409).json({
        error: `PIN already used by ${taken.name}. Each person on the till needs their own PIN.`,
      });
    }
  }

  const data: Record<string, unknown> = { ...body };
  if (body.email) data.email = body.email.toLowerCase();
  if (body.pin) {
    data.pinHash = await hashPin(body.pin);
    data.pinDisplay = "";
    delete data.pin;
  }

  const employee = await prisma.employee.update({ where: { id }, data });
  res.json({
    id: employee.id,
    name: employee.name,
    email: employee.email,
    role: employee.role,
    active: employee.active,
    hasPin: Boolean(employee.pinHash),
  });
});

employeesRouter.delete("/:id", owned("employee"), requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const existing = await prisma.employee.findFirst({ where: { id, storeId: req.user!.storeId } });
  if (!existing) return res.status(404).json({ error: "Employee not found" });

  if (id === req.user!.sub) {
    return res.status(400).json({ error: "You cannot delete your own login" });
  }
  if (req.user!.role === "manager" && existing.role === "owner") {
    return res.status(403).json({ error: "Managers cannot delete owners" });
  }
  if (existing.role === "owner") {
    const otherOwners = await prisma.employee.count({
      where: { storeId: req.user!.storeId, role: "owner", active: true, id: { not: id } },
    });
    if (otherOwners === 0) {
      return res.status(400).json({ error: "Keep at least one active owner" });
    }
  }

  const sales = await prisma.sale.count({ where: { employeeId: id } });
  if (sales > 0) {
    await prisma.employee.update({ where: { id }, data: { active: false } });
    return res.json({
      ok: true,
      deactivated: true,
      message: "Employee has sales history — deactivated instead of deleted",
    });
  }

  await prisma.timeClockEntry.deleteMany({ where: { employeeId: id } });
  await prisma.shift.deleteMany({ where: { employeeId: id } });
  await prisma.employee.delete({ where: { id } });
  res.json({ ok: true, deleted: true });
});

const ONLINE_MS = 3 * 60 * 1000;

function devicePayload(
  d: {
    id: string;
    storeId: string;
    deviceKey: string;
    label: string;
    registerId: string | null;
    lastEmployeeId: string | null;
    lastEmployeeName: string | null;
    lastUserAgent: string | null;
    lastSeenAt: Date;
    supportNote: string | null;
    createdAt: Date;
    updatedAt: Date;
    register?: { id: string; name: string } | null;
  },
  now = Date.now()
) {
  return {
    id: d.id,
    storeId: d.storeId,
    deviceKey: d.deviceKey,
    label: d.label,
    registerId: d.registerId,
    registerName: d.register?.name ?? null,
    lastEmployeeId: d.lastEmployeeId,
    lastEmployeeName: d.lastEmployeeName,
    lastUserAgent: d.lastUserAgent,
    lastSeenAt: d.lastSeenAt.toISOString(),
    supportNote: d.supportNote,
    online: now - d.lastSeenAt.getTime() < ONLINE_MS,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

employeesRouter.get("/registers", async (req: AuthedRequest, res) => {
  const registers = await prisma.register.findMany({
    where: { storeId: req.user!.storeId },
    orderBy: { name: "asc" },
  });
  const now = Date.now();
  res.json(
    registers.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
      online: r.lastSeenAt ? now - r.lastSeenAt.getTime() < ONLINE_MS : false,
    }))
  );
});

employeesRouter.post("/registers", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z.object({ name: z.string().min(1) }).parse(req.body);
  const register = await prisma.register.create({
    data: { storeId: req.user!.storeId, name: body.name },
  });
  res.status(201).json(register);
});

employeesRouter.patch("/registers/:id", owned("register"), requireRole("owner", "manager"), async (req, res) => {
  const body = z.object({ name: z.string().min(1).max(80) }).parse(req.body);
  const register = await prisma.register.update({
    where: { id: String(req.params.id) },
    data: { name: body.name.trim() },
  });
  res.json(register);
});

employeesRouter.delete("/registers/:id", owned("register"), requireRole("owner", "manager"), async (req, res) => {
  const id = String(req.params.id);
  const storeId = req.user!.storeId;
  const count = await prisma.register.count({ where: { storeId } });
  if (count <= 1) {
    return res.status(400).json({ error: "Keep at least one till" });
  }
  const openTickets = await prisma.ticket.count({ where: { registerId: id, status: { in: ["open", "held"] } } });
  if (openTickets > 0) {
    return res.status(400).json({ error: "Close or move open tickets on this till first" });
  }
  await prisma.tillDevice.updateMany({ where: { registerId: id }, data: { registerId: null } });
  // Keep sales/shifts history — Prisma requires the register row; refuse if history exists
  const sales = await prisma.sale.count({ where: { registerId: id } });
  const shifts = await prisma.shift.count({ where: { registerId: id } });
  if (sales > 0 || shifts > 0) {
    return res.status(400).json({
      error: "Till has sales history — rename it instead of deleting",
    });
  }
  await prisma.ticket.deleteMany({ where: { registerId: id, status: "voided" } });
  const leftover = await prisma.ticket.count({ where: { registerId: id } });
  if (leftover > 0) {
    return res.status(400).json({ error: "Till still has tickets — clear them first" });
  }
  await prisma.register.delete({ where: { id } });
  res.json({ ok: true });
});

/** Till app calls this after login and while open so the device shows up in back office. */
employeesRouter.post("/devices/heartbeat", async (req: AuthedRequest, res) => {
  const body = z
    .object({
      deviceKey: z.string().min(8).max(80),
      label: z.string().trim().min(1).max(80).optional(),
      registerId: z.string().optional().nullable(),
      userAgent: z.string().max(400).optional().nullable(),
    })
    .parse(req.body);

  const storeId = req.user!.storeId;
  let registers = await prisma.register.findMany({ where: { storeId }, orderBy: { name: "asc" } });
  if (registers.length === 0) {
    const created = await prisma.register.create({ data: { storeId, name: "Front Counter" } });
    registers = [created];
  }

  let registerId = body.registerId || null;
  if (registerId && !registers.some((r) => r.id === registerId)) {
    return res.status(404).json({ error: "Till not found on this store" });
  }

  const existing = await prisma.tillDevice.findUnique({
    where: { storeId_deviceKey: { storeId, deviceKey: body.deviceKey } },
  });

  if (!registerId && existing?.registerId && registers.some((r) => r.id === existing.registerId)) {
    registerId = existing.registerId;
  }
  if (!registerId && registers.length === 1) {
    registerId = registers[0]!.id;
  }

  const incomingLabel = body.label?.trim();
  const registerNames = new Set(registers.map((r) => r.name.trim().toLowerCase()));
  const existingLooksLikeTill =
    !!existing?.label && registerNames.has(existing.label.trim().toLowerCase());
  const label =
    incomingLabel ||
    (!existingLooksLikeTill ? existing?.label : null) ||
    "Till device";

  const now = new Date();
  const device = await prisma.tillDevice.upsert({
    where: { storeId_deviceKey: { storeId, deviceKey: body.deviceKey } },
    create: {
      storeId,
      deviceKey: body.deviceKey,
      label,
      registerId,
      lastEmployeeId: req.user!.sub,
      lastEmployeeName: req.user!.name,
      lastUserAgent: body.userAgent?.slice(0, 400) || null,
      lastSeenAt: now,
    },
    update: {
      // Refresh label when client sends one (fixes till-name pollution); otherwise keep BO edit
      ...(incomingLabel || existingLooksLikeTill ? { label } : {}),
      registerId,
      lastEmployeeId: req.user!.sub,
      lastEmployeeName: req.user!.name,
      lastUserAgent: body.userAgent?.slice(0, 400) || null,
      lastSeenAt: now,
    },
    include: { register: { select: { id: true, name: true } } },
  });

  if (registerId) {
    await prisma.register.update({
      where: { id: registerId },
      data: {
        lastSeenAt: now,
        lastEmployeeName: req.user!.name,
        lastDeviceLabel: device.label,
      },
    });
    registers = await prisma.register.findMany({ where: { storeId }, orderBy: { name: "asc" } });
  }

  res.json({
    device: devicePayload(device),
    registerId,
    registers: registers.map((r) => ({
      id: r.id,
      name: r.name,
      storeId: r.storeId,
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
      lastEmployeeName: r.lastEmployeeName,
      lastDeviceLabel: r.lastDeviceLabel,
    })),
  });
});

employeesRouter.get("/devices", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const devices = await prisma.tillDevice.findMany({
    where: { storeId: req.user!.storeId },
    include: { register: { select: { id: true, name: true } } },
    orderBy: { lastSeenAt: "desc" },
  });
  const now = Date.now();
  res.json(devices.map((d) => devicePayload(d, now)));
});

employeesRouter.patch("/devices/:id", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      label: z.string().trim().min(1).max(80).optional(),
      supportNote: z.string().trim().max(240).nullable().optional(),
      registerId: z.string().nullable().optional(),
    })
    .parse(req.body);

  const id = String(req.params.id);
  const existing = await prisma.tillDevice.findFirst({ where: { id, storeId: req.user!.storeId } });
  if (!existing) return res.status(404).json({ error: "Device not found" });

  if (body.registerId) {
    const ok = await prisma.register.findFirst({
      where: { id: body.registerId, storeId: req.user!.storeId },
      select: { id: true },
    });
    if (!ok) return res.status(404).json({ error: "Till not found on this store" });
  }

  const device = await prisma.tillDevice.update({
    where: { id },
    data: {
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.supportNote !== undefined ? { supportNote: body.supportNote || null } : {}),
      ...(body.registerId !== undefined ? { registerId: body.registerId } : {}),
    },
    include: { register: { select: { id: true, name: true } } },
  });
  res.json(devicePayload(device));
});

employeesRouter.delete("/devices/:id", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const existing = await prisma.tillDevice.findFirst({ where: { id, storeId: req.user!.storeId } });
  if (!existing) return res.status(404).json({ error: "Device not found" });
  await prisma.tillDevice.delete({ where: { id } });
  res.json({ ok: true });
});
