import { Router } from "express";
import { z } from "zod";
import { PLANS, getPlan, planHasFeature, type PlanId } from "@cloudtill/shared";
import { prisma } from "../db.js";
import { requireAuth, requireRole, type AuthedRequest } from "../auth.js";

export const billingRouter = Router();
export const publicBillingRouter = Router();

const BILLING_PLAN_KEY = "billing.plan";
const BILLING_TRIAL_KEY = "billing.trialEndsAt";
const BILLING_STATUS_KEY = "billing.status";

async function readBilling(storeId: string) {
  const settings = await prisma.setting.findMany({
    where: { storeId, key: { in: [BILLING_PLAN_KEY, BILLING_TRIAL_KEY, BILLING_STATUS_KEY] } },
  });
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  const planId = (map[BILLING_PLAN_KEY] as PlanId | undefined) ?? "pro";
  const plan = getPlan(planId);
  const trialEndsAt = map[BILLING_TRIAL_KEY] ?? null;
  const status = map[BILLING_STATUS_KEY] ?? (trialEndsAt ? "trialing" : "active");
  return {
    planId: plan.id,
    plan,
    status,
    trialEndsAt,
    features: plan.features,
  };
}

async function writeSetting(storeId: string, key: string, value: string) {
  await prisma.setting.upsert({
    where: { storeId_key: { storeId, key } },
    create: { storeId, key, value },
    update: { value },
  });
}

publicBillingRouter.get("/plans", (_req, res) => {
  res.json({
    currency: "GBP",
    plans: PLANS.map((p) => ({
      ...p,
      priceLabel: `£${p.monthlyGbp}/mo`,
    })),
  });
});

publicBillingRouter.post("/signup", async (req, res) => {
  const body = z
    .object({
      businessName: z.string().min(2),
      email: z.string().email(),
      planId: z.enum(["starter", "pro", "multi"]).default("pro"),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "businessName, email, and planId are required" });

  const plan = getPlan(body.data.planId);
  const trialEndsAt = new Date(Date.now() + plan.trialDays * 24 * 60 * 60 * 1000).toISOString();
  const payload = {
    ok: true,
    stub: true,
    message: "Trial started (stub). Connect Stripe later — pilot uses PIN login on the demo store.",
    account: {
      businessName: body.data.businessName,
      email: body.data.email,
      planId: plan.id,
      planName: plan.name,
      trialEndsAt,
      monthlyGbp: plan.monthlyGbp,
    },
    nextSteps: [
      "Open back office and sign in with owner@cloudtill.demo / 1234",
      "Review Billing under Settings",
      "Run the POS till on this Mac at :5173",
    ],
  };

  // Persist stub lead + apply plan to the demo store for pilots.
  const store = await prisma.store.findFirst({ orderBy: { createdAt: "asc" } });
  if (store) {
    await writeSetting(store.id, BILLING_PLAN_KEY, plan.id);
    await writeSetting(store.id, BILLING_TRIAL_KEY, trialEndsAt);
    await writeSetting(store.id, BILLING_STATUS_KEY, "trialing");
    await writeSetting(
      store.id,
      "billing.lastSignup",
      JSON.stringify({ email: body.data.email, businessName: body.data.businessName, at: new Date().toISOString() })
    );
  }

  res.status(201).json(payload);
});

billingRouter.use(requireAuth);

billingRouter.get("/", async (req: AuthedRequest, res) => {
  const billing = await readBilling(req.user!.storeId);
  res.json(billing);
});

billingRouter.patch("/plan", requireRole("owner"), async (req: AuthedRequest, res) => {
  const body = z.object({ planId: z.enum(["starter", "pro", "multi"]) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "planId required" });
  await writeSetting(req.user!.storeId, BILLING_PLAN_KEY, body.data.planId);
  await writeSetting(req.user!.storeId, BILLING_STATUS_KEY, "active");
  const billing = await readBilling(req.user!.storeId);
  res.json(billing);
});

billingRouter.get("/features/:feature", async (req: AuthedRequest, res) => {
  const billing = await readBilling(req.user!.storeId);
  const feature = String(req.params.feature);
  res.json({
    feature,
    allowed: planHasFeature(billing.planId, feature as never),
    planId: billing.planId,
  });
});

export async function storeAllowsFeature(storeId: string, feature: Parameters<typeof planHasFeature>[1]) {
  const billing = await readBilling(storeId);
  return planHasFeature(billing.planId, feature);
}
