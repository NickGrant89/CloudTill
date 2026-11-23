import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { owned } from "../tenant.js";
import { hashPin, requireAuth, requireRole, type AuthedRequest } from "../auth.js";

export const employeesRouter = Router();
employeesRouter.use(requireAuth);

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
      pinDisplay: e.pinDisplay,
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

  const employee = await prisma.employee.create({
    data: {
      storeId: req.user!.storeId,
      name: body.name,
      email: body.email,
      pinHash: await hashPin(body.pin),
      pinDisplay: body.pin,
      role: body.role,
    },
  });
  res.status(201).json({
    id: employee.id,
    name: employee.name,
    email: employee.email,
    role: employee.role,
    active: employee.active,
  });
});

employeesRouter.patch("/:id", owned("employee"), requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      name: z.string().optional(),
      email: z.string().email().optional(),
      pin: z.string().min(4).max(8).optional(),
      role: z.enum(["owner", "manager", "cashier"]).optional(),
      active: z.boolean().optional(),
    })
    .parse(req.body);

  const data: Record<string, unknown> = { ...body };
  if (body.pin) {
    data.pinHash = await hashPin(body.pin);
    data.pinDisplay = body.pin;
    delete data.pin;
  }

  const employee = await prisma.employee.update({ where: { id: req.params.id }, data });
  res.json({
    id: employee.id,
    name: employee.name,
    email: employee.email,
    role: employee.role,
    active: employee.active,
  });
});

employeesRouter.get("/registers", async (req: AuthedRequest, res) => {
  const registers = await prisma.register.findMany({
    where: { storeId: req.user!.storeId },
    orderBy: { name: "asc" },
  });
  res.json(registers);
});

employeesRouter.post("/registers", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z.object({ name: z.string().min(1) }).parse(req.body);
  const register = await prisma.register.create({
    data: { storeId: req.user!.storeId, name: body.name },
  });
  res.status(201).json(register);
});
