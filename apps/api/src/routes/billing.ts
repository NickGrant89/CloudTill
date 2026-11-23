import { createHash, randomBytes } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { PLANS, getPlan, planHasFeature, type PlanId } from "@cloudtill/shared";
import { prisma } from "../db.js";
import { hashPin, requireAuth, requireRole, type AuthedRequest } from "../auth.js";

export const billingRouter = Router();
export const publicBillingRouter = Router();

export const BILLING_PLAN_KEY = "billing.plan";
export const BILLING_TRIAL_KEY = "billing.trialEndsAt";
export const BILLING_STATUS_KEY = "billing.status";
export const BILLING_LICENSE_KEY = "billing.licenseKey";
export const BILLING_LICENSE_LAST_KEY = "billing.licenseKeyLast";
export const BILLING_STRIPE_CUSTOMER = "billing.stripeCustomerId";
export const BILLING_AUDIT_KEY = "billing.auditLog";
export const BILLING_LAST_SIGNUP_KEY = "billing.lastSignup";

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return base || "store";
}

async function uniqueSlug(name: string) {
  const base = slugify(name);
  for (let i = 0; i < 8; i += 1) {
    const candidate = i === 0 ? base : `${base}-${randomBytes(2).toString("hex")}`;
    const exists = await prisma.store.findFirst({ where: { slug: candidate } });
    if (!exists) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export function mintLicenseKey(planId: PlanId) {
  const body = randomBytes(12).toString("hex").toUpperCase();
  return `PP-${planId.toUpperCase()}-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

export function fingerprintLicense(key: string) {
  return createHash("sha256").update(key.trim().toUpperCase()).digest("hex").slice(0, 24);
}

export async function writeSetting(storeId: string, key: string, value: string) {
  await prisma.setting.upsert({
    where: { storeId_key: { storeId, key } },
    create: { storeId, key, value },
    update: { value },
  });
}

export async function appendBillingAudit(
  storeId: string,
  event: { type: string; at?: string; detail?: Record<string, unknown> }
) {
  const existing = await prisma.setting.findUnique({
    where: { storeId_key: { storeId, key: BILLING_AUDIT_KEY } },
  });
  let log: unknown[] = [];
  try {
    log = existing?.value ? (JSON.parse(existing.value) as unknown[]) : [];
  } catch {
    log = [];
  }
  if (!Array.isArray(log)) log = [];
  log.unshift({
    type: event.type,
    at: event.at || new Date().toISOString(),
    detail: event.detail || {},
  });
  await writeSetting(storeId, BILLING_AUDIT_KEY, JSON.stringify(log.slice(0, 50)));
}

export async function readBilling(storeId: string) {
  const settings = await prisma.setting.findMany({
    where: {
      storeId,
      key: {
        in: [
          BILLING_PLAN_KEY,
          BILLING_TRIAL_KEY,
          BILLING_STATUS_KEY,
          BILLING_LICENSE_KEY,
          BILLING_LICENSE_LAST_KEY,
          BILLING_STRIPE_CUSTOMER,
          BILLING_AUDIT_KEY,
          BILLING_LAST_SIGNUP_KEY,
        ],
      },
    },
  });
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  const planId = (map[BILLING_PLAN_KEY] as PlanId | undefined) ?? "pro";
  const plan = getPlan(planId);
  const trialEndsAt = map[BILLING_TRIAL_KEY] || null;
  const status = map[BILLING_STATUS_KEY] ?? (trialEndsAt ? "trialing" : "active");
  const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);
  let audit: unknown[] = [];
  try {
    audit = map[BILLING_AUDIT_KEY] ? (JSON.parse(map[BILLING_AUDIT_KEY]) as unknown[]) : [];
  } catch {
    audit = [];
  }
  let lastSignup: unknown = null;
  try {
    lastSignup = map[BILLING_LAST_SIGNUP_KEY] ? JSON.parse(map[BILLING_LAST_SIGNUP_KEY]) : null;
  } catch {
    lastSignup = null;
  }
  return {
    planId: plan.id,
    plan,
    status,
    trialEndsAt,
    features: plan.features,
    licenseFingerprint: map[BILLING_LICENSE_KEY] ?? null,
    licenseKeyLast: map[BILLING_LICENSE_LAST_KEY] ?? null,
    lastSignup,
    audit: Array.isArray(audit) ? audit : [],
    stripe: {
      configured: stripeConfigured,
      customerId: map[BILLING_STRIPE_CUSTOMER] ?? null,
      checkoutAvailable: stripeConfigured && Boolean(process.env.STRIPE_PRICE_STARTER || process.env.STRIPE_PRICE_PRO),
      portalAvailable: stripeConfigured,
      note: stripeConfigured
        ? "Stripe keys detected — Checkout/Portal endpoints available when price IDs are set."
        : "No STRIPE_SECRET_KEY — use trial signup or license-key activation.",
    },
  };
}

async function provisionStore(opts: {
  businessName: string;
  email: string;
  planId: PlanId;
  ownerName?: string;
}) {
  const plan = getPlan(opts.planId);
  const trialEndsAt = new Date(Date.now() + plan.trialDays * 24 * 60 * 60 * 1000).toISOString();
  const slug = await uniqueSlug(opts.businessName);
  const ownerPin = String(1000 + Math.floor(Math.random() * 9000));
  let cashierPin = String(1000 + Math.floor(Math.random() * 9000));
  while (cashierPin === ownerPin) cashierPin = String(1000 + Math.floor(Math.random() * 9000));
  const licenseKey = mintLicenseKey(plan.id);

  const created = await prisma.store.create({
    data: {
      slug,
      name: opts.businessName,
      currency: "GBP",
      timezone: "Europe/London",
      address: "UK",
    },
  });
  const store = await prisma.store.update({ where: { id: created.id }, data: { companyKey: created.id } });

  await prisma.register.create({ data: { storeId: store.id, name: "Front Counter" } });
  await prisma.tax.create({
    data: { storeId: store.id, name: "VAT", rateBps: 2000, inclusive: true, enabled: true },
  });
  await prisma.paymentType.createMany({
    data: [
      { storeId: store.id, name: "Cash", type: "cash", opensDrawer: true },
      { storeId: store.id, name: "Card", type: "card", opensDrawer: false },
    ],
  });

  const category = await prisma.category.create({
    data: { storeId: store.id, name: "Popular", color: "#0d9488", sortOrder: 0 },
  });
  await prisma.item.create({
    data: {
      storeId: store.id,
      categoryId: category.id,
      name: "Starter item",
      color: "#0f766e",
      active: true,
      variants: {
        create: [{ name: "Regular", sku: `SKU-${slug}-1`, priceCents: 350, active: true }],
      },
    },
  });

  const owner = await prisma.employee.create({
    data: {
      storeId: store.id,
      name: opts.ownerName || "Owner",
      email: opts.email.toLowerCase(),
      role: "owner",
      pinHash: await hashPin(ownerPin),
      pinDisplay: ownerPin,
      active: true,
    },
  });
  await prisma.employee.create({
    data: {
      storeId: store.id,
      name: "Cashier",
      email: `cashier+${slug}@purepos.demo`,
      role: "cashier",
      pinHash: await hashPin(cashierPin),
      pinDisplay: cashierPin,
      active: true,
    },
  });

  await writeSetting(store.id, BILLING_PLAN_KEY, plan.id);
  await writeSetting(store.id, BILLING_TRIAL_KEY, trialEndsAt);
  await writeSetting(store.id, BILLING_STATUS_KEY, "trialing");
  await writeSetting(store.id, BILLING_LICENSE_KEY, fingerprintLicense(licenseKey));
  await writeSetting(store.id, BILLING_LICENSE_LAST_KEY, licenseKey);
  await writeSetting(
    store.id,
    BILLING_LAST_SIGNUP_KEY,
    JSON.stringify({ email: opts.email, businessName: opts.businessName, at: new Date().toISOString() })
  );
  await appendBillingAudit(store.id, {
    type: "signup",
    detail: { email: opts.email, planId: plan.id, licenseKey },
  });
  await writeSetting(store.id, "receipt.header", opts.businessName);
  await writeSetting(store.id, "receipt.footer", "Thank you · PurePOS");

  return {
    store,
    owner,
    plan,
    trialEndsAt,
    ownerPin,
    cashierPin,
    licenseKey,
  };
}

publicBillingRouter.get("/plans", (_req, res) => {
  res.json({
    currency: "GBP",
    plans: PLANS.map((p) => ({
      ...p,
      priceLabel: `£${p.monthlyGbp}/mo`,
    })),
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
  });
});

publicBillingRouter.post("/signup", async (req, res) => {
  const body = z
    .object({
      businessName: z.string().min(2),
      email: z.string().email(),
      planId: z.enum(["starter", "pro", "multi"]).default("pro"),
      ownerName: z.string().min(1).optional(),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "businessName, email, and planId are required" });

  const existing = await prisma.employee.findFirst({
    where: { email: body.data.email.toLowerCase() },
  });
  if (existing) {
    return res.status(409).json({ error: "That email already has a PurePOS login. Sign in or use another email." });
  }

  try {
    const provisioned = await provisionStore(body.data);
    const publicBase =
      process.env.PUBLIC_BASE_URL ||
      process.env.RENDER_EXTERNAL_URL ||
      `${req.protocol}://${req.get("host")}`;

    res.status(201).json({
      ok: true,
      stub: false,
      message: "Trial company created. Use the PIN below on the till and back office.",
      account: {
        businessName: body.data.businessName,
        email: body.data.email.toLowerCase(),
        planId: provisioned.plan.id,
        planName: provisioned.plan.name,
        trialEndsAt: provisioned.trialEndsAt,
        monthlyGbp: provisioned.plan.monthlyGbp,
        storeId: provisioned.store.id,
        storeSlug: provisioned.store.slug,
        storeName: provisioned.store.name,
      },
      credentials: {
        email: body.data.email.toLowerCase(),
        ownerPin: provisioned.ownerPin,
        cashierPin: provisioned.cashierPin,
        licenseKey: provisioned.licenseKey,
      },
      links: {
        pricing: `${publicBase}/pricing`,
        pos: `${publicBase}/pos/`,
        backoffice: `${publicBase}/bo/`,
        ordering: `${publicBase}/order/`,
      },
      stripe: {
        configured: Boolean(process.env.STRIPE_SECRET_KEY),
        requiredEnv: ["STRIPE_SECRET_KEY", "STRIPE_PRICE_STARTER", "STRIPE_PRICE_PRO", "STRIPE_PRICE_MULTI", "STRIPE_WEBHOOK_SECRET"],
      },
      nextSteps: [
        `Open back office → ${publicBase}/bo/ and sign in with your email + owner PIN`,
        `Open the till → ${publicBase}/pos/ with the owner or cashier PIN`,
        "Save your license key — Settings → Billing can re-activate with it",
      ],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create trial company" });
  }
});

publicBillingRouter.post("/activate-license", async (req, res) => {
  const body = z
    .object({
      licenseKey: z.string().min(10),
      email: z.string().email().optional(),
      storeSlug: z.string().optional(),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "licenseKey required" });

  const key = body.data.licenseKey.trim().toUpperCase();
  const match = /^PP-(STARTER|PRO|MULTI)-/.exec(key);
  if (!match) return res.status(400).json({ error: "Invalid PurePOS license key format" });

  const planId = match[1].toLowerCase() as PlanId;
  const fp = fingerprintLicense(key);

  let store =
    (body.data.storeSlug
      ? await prisma.store.findFirst({ where: { slug: body.data.storeSlug } })
      : null) ||
    (body.data.email
      ? (
          await prisma.employee.findFirst({
            where: { email: body.data.email.toLowerCase() },
            include: { store: true },
          })
        )?.store ?? null
      : null);

  if (!store) {
    const byLicense = await prisma.setting.findFirst({
      where: { key: BILLING_LICENSE_KEY, value: fp },
    });
    if (byLicense) {
      store = await prisma.store.findUnique({ where: { id: byLicense.storeId } });
    }
  }
  if (!store) return res.status(404).json({ error: "No store found for that license / email" });

  await writeSetting(store.id, BILLING_PLAN_KEY, planId);
  await writeSetting(store.id, BILLING_STATUS_KEY, "active");
  await writeSetting(store.id, BILLING_LICENSE_KEY, fp);
  await writeSetting(store.id, BILLING_LICENSE_LAST_KEY, key);
  await writeSetting(store.id, BILLING_TRIAL_KEY, "");
  await appendBillingAudit(store.id, {
    type: "activate_license",
    detail: { planId, email: body.data.email || null },
  });

  const billing = await readBilling(store.id);
  res.json({
    ok: true,
    message: `License activated — ${billing.plan.name} is now active on ${store.name}.`,
    store: { id: store.id, slug: store.slug, name: store.name },
    billing,
  });
});

publicBillingRouter.post("/stripe/checkout", async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(501).json({
      error: "Stripe is not configured",
      requiredEnv: ["STRIPE_SECRET_KEY", "STRIPE_PRICE_STARTER", "STRIPE_PRICE_PRO", "STRIPE_PRICE_MULTI"],
    });
  }
  const body = z.object({ planId: z.enum(["starter", "pro", "multi"]), email: z.string().email().optional() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "planId required" });
  const priceMap: Record<PlanId, string | undefined> = {
    starter: process.env.STRIPE_PRICE_STARTER,
    pro: process.env.STRIPE_PRICE_PRO,
    multi: process.env.STRIPE_PRICE_MULTI,
  };
  const priceId = priceMap[body.data.planId];
  if (!priceId) {
    return res.status(501).json({
      error: `Missing Stripe price id for ${body.data.planId}`,
      requiredEnv: [`STRIPE_PRICE_${body.data.planId.toUpperCase()}`],
    });
  }
  // Intentionally no invented secrets — wire Stripe SDK when keys + price IDs are present in a follow-up.
  res.status(501).json({
    error: "Stripe Checkout wiring pending SDK install",
    hint: "Add stripe package + checkout session create using STRIPE_SECRET_KEY and price IDs",
    priceIdPresent: true,
    email: body.data.email ?? null,
  });
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

billingRouter.post("/activate-license", requireRole("owner"), async (req: AuthedRequest, res) => {
  const body = z.object({ licenseKey: z.string().min(10) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "licenseKey required" });
  const key = body.data.licenseKey.trim().toUpperCase();
  const match = /^PP-(STARTER|PRO|MULTI)-/.exec(key);
  if (!match) return res.status(400).json({ error: "Invalid PurePOS license key format" });
  const planId = match[1].toLowerCase() as PlanId;
  await writeSetting(req.user!.storeId, BILLING_PLAN_KEY, planId);
  await writeSetting(req.user!.storeId, BILLING_STATUS_KEY, "active");
  await writeSetting(req.user!.storeId, BILLING_LICENSE_KEY, fingerprintLicense(key));
  await writeSetting(req.user!.storeId, BILLING_LICENSE_LAST_KEY, key);
  await writeSetting(req.user!.storeId, BILLING_TRIAL_KEY, "");
  await appendBillingAudit(req.user!.storeId, { type: "activate_license", detail: { planId, via: "bo" } });
  res.json(await readBilling(req.user!.storeId));
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
