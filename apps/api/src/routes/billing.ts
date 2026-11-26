import { createHash, randomBytes } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { PLANS, getPlan, planHasFeature, type PlanId } from "@cloudtill/shared";
import { prisma } from "../db.js";
import { hashPin, requireAuth, requireRole, type AuthedRequest } from "../auth.js";
import { companyStoreIds } from "../company.js";

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
/** Highest plan the business has paid for (set only by an issued licence or the platform admin). */
export const BILLING_LICENSED_PLAN_KEY = "billing.licensedPlan";
export const ENTITLEMENTS_MIGRATED_KEY = "billing.migrated.entitlements";

const PLAN_RANK: Record<PlanId, number> = { starter: 0, pro: 1, multi: 2 };

export function planAtMost(planId: PlanId, ceiling: PlanId) {
  return PLAN_RANK[planId] <= PLAN_RANK[ceiling];
}

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return base || "store";
}

export async function uniqueSlug(name: string) {
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

/** Plan, trial and licence are per business: write them to every branch. */
export async function writeCompanySetting(storeId: string, key: string, value: string) {
  for (const id of await companyStoreIds(storeId)) await writeSetting(id, key, value);
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
          BILLING_LICENSED_PLAN_KEY,
        ],
      },
    },
  });
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  const planId = (map[BILLING_PLAN_KEY] as PlanId | undefined) ?? "pro";
  const plan = getPlan(planId);
  const trialEndsAt = map[BILLING_TRIAL_KEY] || null;
  const storedStatus = map[BILLING_STATUS_KEY] ?? (trialEndsAt ? "trialing" : "active");
  const trialExpired =
    storedStatus === "trialing" && Boolean(trialEndsAt) && new Date(trialEndsAt!).getTime() < Date.now();
  const status = trialExpired ? "expired" : storedStatus;
  const licensedPlanId = (map[BILLING_LICENSED_PLAN_KEY] as PlanId | undefined) || null;
  // Paid features need a live trial or a paid plan; a lapsed business keeps the till and back office only.
  const entitled = status === "trialing" || status === "active" || status === "past_due";
  const features = entitled ? plan.features : getPlan("starter").features;
  const isDemo =
    (await prisma.store.findUnique({ where: { id: storeId }, select: { companyKey: true } }))?.companyKey === "demo";
  // The demo is shared with every visitor (its PINs are public), so nobody may change its plan.
  const canSwitchTo: PlanId[] = isDemo
    ? []
    : status === "trialing"
      ? PLANS.map((p) => p.id)
      : entitled && licensedPlanId
        ? PLANS.map((p) => p.id).filter((id) => planAtMost(id, licensedPlanId))
        : [];
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
    entitled,
    licensedPlanId,
    canSwitchTo,
    features,
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
      pinDisplay: "",
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
      pinDisplay: "",
      active: true,
    },
  });

  await writeSetting(store.id, BILLING_PLAN_KEY, plan.id);
  await writeSetting(store.id, BILLING_TRIAL_KEY, trialEndsAt);
  await writeSetting(store.id, BILLING_STATUS_KEY, "trialing");
  await writeSetting(store.id, ENTITLEMENTS_MIGRATED_KEY, "1");
  await writeSetting(
    store.id,
    BILLING_LAST_SIGNUP_KEY,
    JSON.stringify({ email: opts.email, businessName: opts.businessName, at: new Date().toISOString() })
  );
  await appendBillingAudit(store.id, {
    type: "signup",
    detail: { email: opts.email, planId: plan.id },
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
        `Your ${provisioned.plan.name} trial runs until ${new Date(provisioned.trialEndsAt).toLocaleDateString("en-GB")} — buy a plan from ${publicBase}/pricing to keep paid features`,
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

  const issuedTo = await prisma.setting.findFirst({
    where: { key: BILLING_LICENSE_KEY, value: fingerprintLicense(body.data.licenseKey) },
  });
  const store = issuedTo ? await prisma.store.findUnique({ where: { id: issuedTo.storeId } }) : null;
  // Slug / email are only a cross-check: a key can never be pointed at a business it wasn't issued to.
  const claimed =
    (body.data.storeSlug ? await prisma.store.findFirst({ where: { slug: body.data.storeSlug } }) : null) ??
    (body.data.email
      ? (await prisma.employee.findFirst({ where: { email: body.data.email.toLowerCase() } }))?.storeId ?? null
      : null);
  const claimedId = typeof claimed === "string" ? claimed : claimed?.id ?? null;
  if (!store || (claimedId && !(await companyStoreIds(store.id)).includes(claimedId))) {
    return res.status(404).json({ error: "That licence key isn't recognised for this business" });
  }
  const result = await activateIssuedLicense(body.data.licenseKey, store.id, "public");
  if ("error" in result) return res.status(result.status).json({ error: result.error });

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
  const current = await readBilling(req.user!.storeId);
  if (!current.canSwitchTo.includes(body.data.planId)) {
    return res.status(402).json({
      error: !current.canSwitchTo.length && current.entitled
        ? "The demo café's plan can't be changed"
        : current.status === "trialing"
          ? "That plan isn't available"
          : current.licensedPlanId
            ? `Your licence covers up to ${getPlan(current.licensedPlanId).name}. Buy ${getPlan(body.data.planId).name} on the pricing page or enter a new licence key.`
            : "Your trial has ended — buy a plan on the pricing page or enter a licence key to unlock it.",
      canSwitchTo: current.canSwitchTo,
    });
  }
  await writeCompanySetting(req.user!.storeId, BILLING_PLAN_KEY, body.data.planId);
  await appendBillingAudit(req.user!.storeId, {
    type: "change_plan",
    detail: { from: current.planId, to: body.data.planId, status: current.status },
  });
  res.json(await readBilling(req.user!.storeId));
});

billingRouter.post("/activate-license", requireRole("owner"), async (req: AuthedRequest, res) => {
  const body = z.object({ licenseKey: z.string().min(10) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "licenseKey required" });
  const result = await activateIssuedLicense(body.data.licenseKey, req.user!.storeId, "bo");
  if ("error" in result) return res.status(result.status).json({ error: result.error });
  res.json(await readBilling(req.user!.storeId));
});

billingRouter.get("/features/:feature", async (req: AuthedRequest, res) => {
  const billing = await readBilling(req.user!.storeId);
  const feature = String(req.params.feature);
  res.json({
    feature,
    allowed: (billing.features as string[]).includes(feature),
    planId: billing.planId,
  });
});

/**
 * One-off per store: before entitlements, signup minted a self-activating key and any owner could pick any plan.
 * Paid (active) stores keep their current plan as the licensed ceiling; trial-signup keys are dropped; the demo is
 * an active Venue (`pro`) plan so it never expires.
 */
function paidByAdmin(audit: unknown[]) {
  return audit.some((raw) => {
    const e = raw as { type?: string; detail?: { status?: string } };
    return (
      e.type === "admin_issue_license" || (e.type === "admin_change_plan" && e.detail?.status === "active")
    );
  });
}

export async function migrateBillingEntitlements() {
  const done = new Set(
    (await prisma.setting.findMany({ where: { key: ENTITLEMENTS_MIGRATED_KEY }, select: { storeId: true } })).map(
      (r) => r.storeId
    )
  );
  const stores = await prisma.store.findMany({
    select: { id: true, companyKey: true },
    orderBy: { createdAt: "asc" },
  });
  const companies = new Map<string, string[]>();
  for (const store of stores) {
    const key = store.companyKey || store.id;
    companies.set(key, [...(companies.get(key) ?? []), store.id]);
  }

  for (const [companyKey, ids] of companies) {
    if (ids.every((id) => done.has(id))) continue;
    // The first store holds the signup and admin history for the business.
    const billing = await readBilling(ids[0]);
    const write = async (key: string, value: string) => {
      for (const id of ids) await writeSetting(id, key, value);
    };
    if (companyKey === "demo") {
      await write(BILLING_STATUS_KEY, "active");
      await write(BILLING_TRIAL_KEY, "");
      await write(BILLING_LICENSED_PLAN_KEY, billing.planId);
    } else if (paidByAdmin(billing.audit)) {
      await write(BILLING_LICENSED_PLAN_KEY, billing.planId);
    } else {
      // "active" here only came from the old free plan switch or a self-activated signup key.
      await write(BILLING_LICENSE_KEY, "");
      await write(BILLING_LICENSE_LAST_KEY, "");
      if (billing.status === "active") {
        const signedUpAt = (billing.lastSignup as { at?: string } | null)?.at;
        const trialDays = getPlan(billing.planId).trialDays;
        const ends = signedUpAt
          ? new Date(new Date(signedUpAt).getTime() + trialDays * 24 * 60 * 60 * 1000).toISOString()
          : new Date().toISOString();
        await write(BILLING_STATUS_KEY, "trialing");
        await write(BILLING_TRIAL_KEY, ends);
      }
    }
    await write(ENTITLEMENTS_MIGRATED_KEY, "1");
  }
}

/** Accept only a key PurePOS issued to this business (fingerprint recorded by the admin), then mark it paid. */
async function activateIssuedLicense(
  rawKey: string,
  storeId: string,
  via: "bo" | "public"
): Promise<{ planId: PlanId } | { status: number; error: string }> {
  const key = rawKey.trim().toUpperCase();
  const match = /^PP-(STARTER|PRO|MULTI)-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.exec(key);
  if (!match) return { status: 400, error: "That doesn't look like a PurePOS licence key (PP-PLAN-XXXX-XXXX-XXXX)" };
  const issued = await prisma.setting.findUnique({
    where: { storeId_key: { storeId, key: BILLING_LICENSE_KEY } },
  });
  if (!issued?.value || issued.value !== fingerprintLicense(key)) {
    return { status: 403, error: "That licence key isn't recognised for this business" };
  }
  const planId = match[1].toLowerCase() as PlanId;
  await writeCompanySetting(storeId, BILLING_PLAN_KEY, planId);
  await writeCompanySetting(storeId, BILLING_LICENSED_PLAN_KEY, planId);
  await writeCompanySetting(storeId, BILLING_STATUS_KEY, "active");
  await writeCompanySetting(storeId, BILLING_LICENSE_LAST_KEY, key);
  await writeCompanySetting(storeId, BILLING_TRIAL_KEY, "");
  await appendBillingAudit(storeId, { type: "activate_license", detail: { planId, via } });
  return { planId };
}

export async function storeAllowsFeature(storeId: string, feature: Parameters<typeof planHasFeature>[1]) {
  const billing = await readBilling(storeId);
  return (billing.features as string[]).includes(feature);
}
