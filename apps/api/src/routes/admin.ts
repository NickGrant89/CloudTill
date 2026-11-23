import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { getPlan, type PlanId } from "@cloudtill/shared";
import {
  BILLING_LICENSE_KEY,
  BILLING_LICENSE_LAST_KEY,
  BILLING_LICENSED_PLAN_KEY,
  BILLING_PLAN_KEY,
  BILLING_STATUS_KEY,
  BILLING_TRIAL_KEY,
  appendBillingAudit,
  fingerprintLicense,
  mintLicenseKey,
  readBilling,
  writeCompanySetting,
} from "./billing.js";

import { companyStoreIds, DEMO_COMPANY } from "../company.js";

export const adminRouter = Router();

function adminSecretConfigured() {
  return Boolean(process.env.PLATFORM_ADMIN_SECRET?.trim());
}

function requirePlatformAdmin(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  const configured = process.env.PLATFORM_ADMIN_SECRET?.trim();
  if (!configured) {
    return res.status(503).json({
      error: "Platform admin is not configured. Set PLATFORM_ADMIN_SECRET on the host.",
    });
  }
  const header = req.header("x-platform-admin-secret") || "";
  const bearer = (req.header("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const provided = header.trim() || bearer;
  if (!provided || provided !== configured) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

adminRouter.get("/status", (_req, res) => {
  res.json({
    ok: true,
    configured: adminSecretConfigured(),
    auth: "Send header X-Platform-Admin-Secret or Authorization: Bearer <secret>",
  });
});

adminRouter.use(requirePlatformAdmin);

adminRouter.get("/overview", async (_req, res) => {
  const stores = await prisma.store.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      employees: {
        where: { role: "owner" },
        select: { id: true, email: true, name: true, role: true },
        take: 5,
      },
      _count: { select: { items: true, sales: true, employees: true } },
    },
  });

  const rows = await Promise.all(
    stores.map(async (store) => {
      const billing = await readBilling(store.id);
      return {
        id: store.id,
        name: store.name,
        slug: store.slug,
        companyKey: store.companyKey || store.id,
        address: store.address,
        currency: store.currency,
        timezone: store.timezone,
        createdAt: store.createdAt,
        owners: store.employees,
        counts: store._count,
        billing: {
          planId: billing.planId,
          planName: billing.plan.name,
          status: billing.status,
          licensedPlanId: billing.licensedPlanId,
          trialEndsAt: billing.trialEndsAt,
          licenseFingerprint: billing.licenseFingerprint,
          licenseKeyLast: billing.licenseKeyLast,
          lastSignup: billing.lastSignup,
        },
      };
    })
  );

  const events: Array<{
    storeId: string;
    storeName: string;
    storeSlug: string;
    type: string;
    at: string;
    detail: Record<string, unknown>;
  }> = [];

  for (const store of stores) {
    const billing = await readBilling(store.id);
    for (const raw of billing.audit.slice(0, 20)) {
      const e = raw as { type?: string; at?: string; detail?: Record<string, unknown> };
      events.push({
        storeId: store.id,
        storeName: store.name,
        storeSlug: store.slug,
        type: e.type || "event",
        at: e.at || store.createdAt.toISOString(),
        detail: e.detail || {},
      });
    }
    if (billing.lastSignup && typeof billing.lastSignup === "object") {
      const s = billing.lastSignup as { at?: string; email?: string; businessName?: string };
      if (s.at && !billing.audit.some((a) => (a as { type?: string }).type === "signup")) {
        events.push({
          storeId: store.id,
          storeName: store.name,
          storeSlug: store.slug,
          type: "signup",
          at: s.at,
          detail: { email: s.email, businessName: s.businessName },
        });
      }
    }
  }

  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  res.json({
    generatedAt: new Date().toISOString(),
    storeCount: rows.length,
    stores: rows,
    recentEvents: events.slice(0, 40),
    plans: (["starter", "pro", "multi"] as PlanId[]).map((id) => getPlan(id)),
  });
});

adminRouter.get("/stores/:storeId", async (req, res) => {
  const store = await prisma.store.findUnique({
    where: { id: req.params.storeId },
    include: {
      employees: { select: { id: true, email: true, name: true, role: true, createdAt: true } },
    },
  });
  if (!store) return res.status(404).json({ error: "Store not found" });
  const billing = await readBilling(store.id);
  res.json({ store, billing });
});

adminRouter.post("/stores/:storeId/plan", async (req, res) => {
  const body = z
    .object({
      planId: z.enum(["starter", "pro", "multi"]),
      status: z.enum(["trialing", "active", "past_due", "canceled"]).optional(),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
  if (!store) return res.status(404).json({ error: "Store not found" });

  await writeCompanySetting(store.id, BILLING_PLAN_KEY, body.data.planId);
  await writeCompanySetting(store.id, BILLING_LICENSED_PLAN_KEY, body.data.planId);
  if (body.data.status) {
    await writeCompanySetting(store.id, BILLING_STATUS_KEY, body.data.status);
  }
  await appendBillingAudit(store.id, {
    type: "admin_change_plan",
    detail: { planId: body.data.planId, status: body.data.status || null },
  });

  res.json({ ok: true, storeId: store.id, billing: await readBilling(store.id) });
});

adminRouter.post("/stores/:storeId/trial", async (req, res) => {
  const body = z
    .object({
      days: z.number().int().min(1).max(365).optional(),
      trialEndsAt: z.string().datetime().optional(),
      status: z.enum(["trialing", "active"]).optional(),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  if (!body.data.days && !body.data.trialEndsAt) {
    return res.status(400).json({ error: "Provide days or trialEndsAt" });
  }

  const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
  if (!store) return res.status(404).json({ error: "Store not found" });

  const ends =
    body.data.trialEndsAt ||
    new Date(Date.now() + (body.data.days || 14) * 24 * 60 * 60 * 1000).toISOString();
  await writeCompanySetting(store.id, BILLING_TRIAL_KEY, ends);
  await writeCompanySetting(store.id, BILLING_STATUS_KEY, body.data.status || "trialing");
  await appendBillingAudit(store.id, {
    type: "admin_extend_trial",
    detail: { trialEndsAt: ends, days: body.data.days || null },
  });

  res.json({ ok: true, storeId: store.id, billing: await readBilling(store.id) });
});

adminRouter.post("/stores/:storeId/license/issue", async (req, res) => {
  const body = z
    .object({
      planId: z.enum(["starter", "pro", "multi"]).optional(),
      activate: z.boolean().optional(),
    })
    .safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
  if (!store) return res.status(404).json({ error: "Store not found" });

  const billing = await readBilling(store.id);
  const planId = (body.data.planId || billing.planId) as PlanId;
  const licenseKey = mintLicenseKey(planId);
  await writeCompanySetting(store.id, BILLING_PLAN_KEY, planId);
  await writeCompanySetting(store.id, BILLING_LICENSE_KEY, fingerprintLicense(licenseKey));
  await writeCompanySetting(store.id, BILLING_LICENSE_LAST_KEY, licenseKey);
  if (body.data.activate !== false) {
    await writeCompanySetting(store.id, BILLING_LICENSED_PLAN_KEY, planId);
    await writeCompanySetting(store.id, BILLING_STATUS_KEY, "active");
    await writeCompanySetting(store.id, BILLING_TRIAL_KEY, "");
  }
  await appendBillingAudit(store.id, {
    type: "admin_issue_license",
    detail: { planId, licenseKey },
  });

  res.json({
    ok: true,
    storeId: store.id,
    licenseKey,
    billing: await readBilling(store.id),
  });
});

adminRouter.post("/stores/:storeId/license/rotate", async (req, res) => {
  const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
  if (!store) return res.status(404).json({ error: "Store not found" });
  const billing = await readBilling(store.id);
  const licenseKey = mintLicenseKey(billing.planId as PlanId);
  await writeCompanySetting(store.id, BILLING_LICENSE_KEY, fingerprintLicense(licenseKey));
  await writeCompanySetting(store.id, BILLING_LICENSE_LAST_KEY, licenseKey);
  await appendBillingAudit(store.id, {
    type: "admin_rotate_license",
    detail: { planId: billing.planId, licenseKey },
  });
  res.json({
    ok: true,
    storeId: store.id,
    licenseKey,
    billing: await readBilling(store.id),
  });
});

adminRouter.post("/stores/:storeId/license/revoke", async (req, res) => {
  const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
  if (!store) return res.status(404).json({ error: "Store not found" });
  await writeCompanySetting(store.id, BILLING_LICENSE_KEY, "");
  await writeCompanySetting(store.id, BILLING_LICENSE_LAST_KEY, "");
  await writeCompanySetting(store.id, BILLING_LICENSED_PLAN_KEY, "");
  await writeCompanySetting(store.id, BILLING_STATUS_KEY, "canceled");
  await appendBillingAudit(store.id, { type: "admin_revoke_license", detail: {} });
  res.json({ ok: true, storeId: store.id, billing: await readBilling(store.id) });
});

adminRouter.delete("/companies/:storeId", async (req, res) => {
  const body = z.object({ confirmName: z.string() }).safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: "Type the business name to confirm" });
  const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
  if (!store) return res.status(404).json({ error: "Business not found" });
  if (store.companyKey === DEMO_COMPANY) return res.status(400).json({ error: "The demo café can't be deleted" });
  const ids = await companyStoreIds(store.id);
  const first = await prisma.store.findFirst({ where: { id: { in: ids } }, orderBy: { createdAt: "asc" } });
  if (body.data.confirmName.trim() !== first?.name) {
    return res.status(400).json({ error: `Type the business name exactly: ${first?.name}` });
  }
  // Sales, ticket lines and online orders point at staff and products without cascades, so clear them first.
  const inBusiness = { storeId: { in: ids } };
  await prisma.$transaction([
    prisma.onlineOrder.deleteMany({ where: inBusiness }),
    prisma.ticket.deleteMany({ where: inBusiness }),
    prisma.sale.deleteMany({ where: inBusiness }),
    prisma.store.deleteMany({ where: { id: { in: ids } } }),
  ]);
  res.json({ ok: true, deletedStores: ids.length, name: first?.name });
});
