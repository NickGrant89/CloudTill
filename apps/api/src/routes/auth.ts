import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { checkPin, requireAuth, requireRole, signToken, type AuthedRequest } from "../auth.js";
import type { Role } from "@cloudtill/shared";
import { companyStoreIds, DEMO_COMPANY, sameCompany } from "../company.js";
import { parseBody } from "../parse.js";
import {
  BILLING_LICENSE_KEY,
  BILLING_LICENSE_LAST_KEY,
  BILLING_LICENSED_PLAN_KEY,
  BILLING_PLAN_KEY,
  BILLING_STATUS_KEY,
  BILLING_TRIAL_KEY,
  ENTITLEMENTS_MIGRATED_KEY,
  storeAllowsFeature,
  uniqueSlug,
} from "./billing.js";

export const authRouter = Router();

type EmployeeRow = Awaited<ReturnType<typeof prisma.employee.findFirstOrThrow>>;

/** Owners and managers work across every branch of their business; other staff stay in their own store. */
function worksAcrossBranches(role: string) {
  return role === "owner" || role === "manager";
}

async function session(emp: EmployeeRow, storeId = emp.storeId) {
  const token = signToken({
    sub: emp.id,
    storeId,
    role: emp.role as Role,
    name: emp.name,
    email: emp.email,
  });
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  let registers = await prisma.register.findMany({ where: { storeId }, orderBy: { name: "asc" } });
  // New stores (and tills that never had a register added) get one automatically so login always lands on a till.
  if (registers.length === 0) {
    await prisma.register.create({ data: { storeId, name: "Front Counter" } });
    registers = await prisma.register.findMany({ where: { storeId }, orderBy: { name: "asc" } });
  }
  const stores = worksAcrossBranches(emp.role)
    ? await prisma.store.findMany({
        where: { id: { in: await companyStoreIds(emp.storeId) } },
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      })
    : [{ id: store.id, name: store.name }];
  return {
    token,
    user: { id: emp.id, name: emp.name, email: emp.email, role: emp.role, storeId },
    store,
    registers,
    stores,
  };
}

const loginBodySchema = z.object({
  email: z.string().email().optional(),
  pin: z.string().min(4).max(8),
  storeId: z.string().optional(),
  /** backoffice = email+PIN owners/managers only; pos = till PIN login */
  client: z.enum(["backoffice", "pos"]).optional(),
});

authRouter.post("/login", async (req, res) => {
  const body = parseBody(loginBodySchema, req.body, res);
  if (!body) return;

  const paired = body.storeId
    ? await prisma.store.findUnique({ where: { id: body.storeId }, select: { id: true, companyKey: true } })
    : null;
  if (body.storeId && !paired) return res.status(401).json({ error: "This till's store no longer exists" });

  // A bare PIN is only unique inside one business: without email or a paired store, only the demo company matches.
  const scope = paired
    ? {
        OR: [
          { storeId: paired.id },
          ...(paired.companyKey
            ? [{ role: { in: ["owner", "manager"] }, store: { companyKey: paired.companyKey } }]
            : []),
        ],
      }
    : body.email
      ? {}
      : { store: { companyKey: DEMO_COMPANY } };

  const employees = await prisma.employee.findMany({
    where: {
      active: true,
      ...(body.email ? { email: body.email.toLowerCase() } : {}),
      ...scope,
    },
    orderBy: { createdAt: "asc" },
  });

  let matched = null as EmployeeRow | null;
  for (const emp of employees) {
    if (await checkPin(body.pin, emp.pinHash)) {
      matched = emp;
      break;
    }
  }
  if (!matched) {
    return res.status(401).json({ error: "Invalid PIN or email" });
  }

  if (body.client === "backoffice" && matched.role === "cashier") {
    return res.status(403).json({
      error: "Back office is for owners and managers. Cashiers sign in on the till with their own PIN.",
    });
  }

  res.json(await session(matched, paired?.id ?? matched.storeId));
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const emp = await prisma.employee.findUnique({ where: { id: req.user!.sub } });
  if (!emp) return res.status(404).json({ error: "Not found" });
  const { token: _token, ...rest } = await session(emp, req.user!.storeId);
  res.json(rest);
});

authRouter.get("/stores", requireAuth, async (req: AuthedRequest, res) => {
  const ids = await companyStoreIds(req.user!.storeId);
  const stores = await prisma.store.findMany({
    where: { id: { in: ids } },
    include: { registers: true },
    orderBy: { createdAt: "asc" },
  });
  res.json(stores);
});

const COPIED_BILLING_KEYS = [
  BILLING_PLAN_KEY,
  BILLING_TRIAL_KEY,
  BILLING_STATUS_KEY,
  BILLING_LICENSE_KEY,
  BILLING_LICENSE_LAST_KEY,
  BILLING_LICENSED_PLAN_KEY,
  ENTITLEMENTS_MIGRATED_KEY,
];

authRouter.post("/stores", requireAuth, requireRole("owner"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      name: z.string().trim().min(2).max(80),
      address: z.string().trim().max(200).optional(),
      phone: z.string().trim().max(40).optional(),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Branch name is required" });

  const parentId = req.user!.storeId;
  if (!(await storeAllowsFeature(parentId, "multi_store"))) {
    return res.status(402).json({
      error: "Branches need the Group plan — upgrade in Settings → Billing",
      feature: "multi_store",
    });
  }

  const parent = await prisma.store.findUniqueOrThrow({ where: { id: parentId } });
  const [taxes, paymentTypes, billing] = await Promise.all([
    prisma.tax.findMany({ where: { storeId: parentId } }),
    prisma.paymentType.findMany({ where: { storeId: parentId } }),
    prisma.setting.findMany({ where: { storeId: parentId, key: { in: COPIED_BILLING_KEYS } } }),
  ]);

  if (!parent.companyKey) {
    await prisma.store.update({ where: { id: parent.id }, data: { companyKey: parent.id } });
  }
  const branch = await prisma.store.create({
    data: {
      slug: await uniqueSlug(`${parent.name} ${body.data.name}`),
      name: body.data.name,
      address: body.data.address || null,
      phone: body.data.phone || null,
      currency: parent.currency,
      timezone: parent.timezone,
      companyKey: parent.companyKey || parent.id,
    },
  });

  await prisma.register.create({ data: { storeId: branch.id, name: "Front Counter" } });
  if (taxes.length) {
    await prisma.tax.createMany({
      data: taxes.map((t) => ({
        storeId: branch.id,
        name: t.name,
        rateBps: t.rateBps,
        inclusive: t.inclusive,
        enabled: t.enabled,
      })),
    });
  }
  if (paymentTypes.length) {
    await prisma.paymentType.createMany({
      data: paymentTypes.map((p) => ({
        storeId: branch.id,
        name: p.name,
        type: p.type,
        enabled: p.enabled,
        opensDrawer: p.opensDrawer,
      })),
    });
  }
  await prisma.setting.createMany({
    data: [
      ...billing.map((s) => ({ storeId: branch.id, key: s.key, value: s.value })),
      { storeId: branch.id, key: "receipt.header", value: `${parent.name} · ${branch.name}` },
    ],
  });

  res.status(201).json(branch);
});

authRouter.post("/switch-store", requireAuth, async (req: AuthedRequest, res) => {
  const body = z.object({ storeId: z.string() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "storeId required" });
  const emp = await prisma.employee.findUnique({ where: { id: req.user!.sub } });
  if (!emp || !emp.active) return res.status(401).json({ error: "Unauthorized" });

  const targetId = body.data.storeId;
  if (targetId !== emp.storeId) {
    if (!worksAcrossBranches(emp.role)) {
      return res.status(403).json({ error: "Only owners and managers can switch branches" });
    }
    if (!(await sameCompany(emp.storeId, [targetId]))) {
      return res.status(403).json({ error: "That store isn't part of your business" });
    }
  }
  res.json(await session(emp, targetId));
});
