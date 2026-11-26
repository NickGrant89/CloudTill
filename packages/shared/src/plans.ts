export type PlanId = "starter" | "pro" | "multi";

export type PlanFeature =
  | "pos"
  | "backoffice"
  | "online_ordering"
  | "csv_import"
  | "multi_store"
  | "kitchen"
  | "advanced_reports"
  | "offline_sync";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  tagline: string;
  audience: string;
  monthlyGbp: number;
  trialDays: number;
  badge?: string;
  features: PlanFeature[];
  highlights: string[];
}

/**
 * UK SaaS packages — priced in GBP, built for British high-street retail & hospitality.
 * IDs stay starter/pro/multi for API compatibility; display names are Essential / Complete / Multi.
 */
export const PLANS: PlanDefinition[] = [
  {
    id: "starter",
    name: "Essential",
    tagline: "One till + cloud back office when Wi‑Fi drops.",
    audience: "Independent counters, pop-ups, market traders",
    monthlyGbp: 19,
    trialDays: 14,
    features: ["pos", "backoffice", "offline_sync"],
    highlights: [
      "Cloud back office + 1 offline-capable till",
      "Items & groups, VAT, and receipts in £",
      "Live open-ticket sync across tills in the store",
      "Offline sales queue · sync when you’re back",
      "Store backup & restore from Settings",
      "Email support",
    ],
  },
  {
    id: "pro",
    name: "Complete",
    tagline: "Till, kitchen, online ordering & UK delivery apps.",
    audience: "Cafés, delis, bars, and single-site retail",
    monthlyGbp: 35,
    trialDays: 14,
    badge: "Popular",
    features: ["pos", "backoffice", "offline_sync", "online_ordering", "csv_import", "kitchen", "advanced_reports"],
    highlights: [
      "Everything in Essential",
      "Customer online ordering (pickup, dine-in, delivery)",
      "Kitchen board for web + Just Eat, Deliveroo, Uber Eats & more",
      "CSV import · end-of-day & richer reports",
      "Best value vs hardware-tied POS in the UK",
    ],
  },
  {
    id: "multi",
    name: "Multi",
    tagline: "One cloud across branches — stock & catalogue.",
    audience: "Multi-site groups and growing brands",
    monthlyGbp: 59,
    trialDays: 14,
    features: [
      "pos",
      "backoffice",
      "offline_sync",
      "online_ordering",
      "csv_import",
      "kitchen",
      "advanced_reports",
      "multi_store",
    ],
    highlights: [
      "Everything in Complete",
      "Multi-store stock transfers",
      "Assign items to branches from Items",
      "Shared catalogue ops across sites",
      "Priority pilot support",
    ],
  },
];

export function getPlan(id: string | null | undefined): PlanDefinition {
  return PLANS.find((p) => p.id === id) ?? PLANS[0];
}

export function planHasFeature(planId: string | null | undefined, feature: PlanFeature): boolean {
  return getPlan(planId).features.includes(feature);
}