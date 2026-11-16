import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole, type AuthedRequest } from "../auth.js";

export const customersRouter = Router();
customersRouter.use(requireAuth);

customersRouter.get("/", async (req: AuthedRequest, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const customers = await prisma.customer.findMany({
    where: {
      storeId: req.user!.storeId,
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { email: { contains: q } },
              { phone: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
  });
  res.json(customers);
});

customersRouter.get("/:id", async (req, res) => {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: req.params.id } });
  const sales = await prisma.sale.findMany({
    where: { customerId: customer.id },
    include: { lines: true, payments: true, employee: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json({
    ...customer,
    sales: sales.map((s) => ({
      ...s,
      employeeName: s.employee.name,
      createdAt: s.createdAt.toISOString(),
    })),
  });
});

customersRouter.post("/", async (req: AuthedRequest, res) => {
  const body = z
    .object({
      name: z.string().min(1),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      note: z.string().optional(),
      storeCreditCents: z.number().int().optional(),
    })
    .parse(req.body);
  const customer = await prisma.customer.create({
    data: {
      storeId: req.user!.storeId,
      name: body.name,
      email: body.email,
      phone: body.phone,
      note: body.note,
      storeCreditCents: body.storeCreditCents ?? 0,
    },
  });
  res.status(201).json(customer);
});

customersRouter.patch("/:id", requireRole("owner", "manager"), async (req, res) => {
  const body = z
    .object({
      name: z.string().optional(),
      email: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
      loyaltyPoints: z.number().int().optional(),
      storeCreditCents: z.number().int().optional(),
    })
    .parse(req.body);
  const customer = await prisma.customer.update({ where: { id: req.params.id }, data: body });
  res.json(customer);
});
