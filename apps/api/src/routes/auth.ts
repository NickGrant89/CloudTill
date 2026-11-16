import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { checkPin, requireAuth, signToken, type AuthedRequest } from "../auth.js";
import type { Role } from "@cloudtill/shared";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const body = z
    .object({
      email: z.string().email().optional(),
      pin: z.string().min(4).max(8),
      storeId: z.string().optional(),
    })
    .parse(req.body);

  const employees = await prisma.employee.findMany({
    where: {
      active: true,
      ...(body.email ? { email: body.email } : {}),
      ...(body.storeId ? { storeId: body.storeId } : {}),
    },
  });

  let matched = null as (typeof employees)[0] | null;
  for (const emp of employees) {
    if (await checkPin(body.pin, emp.pinHash)) {
      matched = emp;
      break;
    }
  }

  if (!matched) {
    return res.status(401).json({ error: "Invalid PIN or email" });
  }

  const token = signToken({
    sub: matched.id,
    storeId: matched.storeId,
    role: matched.role as Role,
    name: matched.name,
    email: matched.email,
  });

  const store = await prisma.store.findUniqueOrThrow({ where: { id: matched.storeId } });
  const registers = await prisma.register.findMany({ where: { storeId: matched.storeId } });

  res.json({
    token,
    user: {
      id: matched.id,
      name: matched.name,
      email: matched.email,
      role: matched.role,
      storeId: matched.storeId,
    },
    store,
    registers,
  });
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const emp = await prisma.employee.findUnique({ where: { id: req.user!.sub } });
  if (!emp) return res.status(404).json({ error: "Not found" });
  const store = await prisma.store.findUniqueOrThrow({ where: { id: emp.storeId } });
  const registers = await prisma.register.findMany({ where: { storeId: emp.storeId } });
  res.json({
    user: {
      id: emp.id,
      name: emp.name,
      email: emp.email,
      role: emp.role,
      storeId: emp.storeId,
    },
    store,
    registers,
  });
});

authRouter.get("/stores", async (_req, res) => {
  const stores = await prisma.store.findMany({
    include: { registers: true },
    orderBy: { name: "asc" },
  });
  res.json(stores);
});
