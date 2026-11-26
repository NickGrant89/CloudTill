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
 * IDs stay starter/pro/multi for API compatibility; display names are Solo / Shop / Group.
 */
export const PLANS: PlanDefinition[] = [
  {
    id: "starter",
    name: "Solo",
    tagline: "One till that keeps selling when the Wi‑Fi doesn’t.",
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
    name: "Shop",
    tagline: "The UK high-street package — till, kitchen, ordering, and delivery apps.",
    audience: "Cafés, delis, bars, and single-site retail",
    monthlyGbp: 35,
    trialDays: 14,
    badge: "Most UK shops",
    features: ["pos", "backoffice", "offline_sync", "online_ordering", "csv_import", "kitchen", "advanced_reports"],
    highlights: [
      "Everything in Solo",
      "Customer online ordering (pickup, dine-in, delivery)",
      "Kitchen board for web + Just Eat, Deliveroo, Uber Eats & more",
      "CSV import · end-of-day & richer reports",
      "Best value vs hardware-tied POS in the UK",
    ],
  },
  {
    id: "multi",
    name: "Group",
    tagline: "One cloud for every site — stock and items that move with you.",
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
      "Everything in Shop",
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
