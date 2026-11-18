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
    monthlyGbp: 29,
    trialDays: 14,
    features: ["pos", "backoffice", "offline_sync"],
    highlights: [
      "Cloud back office + 1 offline-capable till",
      "Catalogue, VAT, and receipts in £",
      "Sales queue offline · sync when you’re back",
      "UK-hosted · no till hardware lock-in",
      "Email support",
    ],
  },
  {
    id: "pro",
    name: "Shop",
    tagline: "The UK high-street package — till, kitchen, and customer ordering.",
    audience: "Cafés, delis, bars, and single-site retail",
    monthlyGbp: 59,
    trialDays: 14,
    badge: "Most UK shops",
    features: ["pos", "backoffice", "offline_sync", "online_ordering", "csv_import", "kitchen", "advanced_reports"],
    highlights: [
      "Everything in Solo",
      "Customer online ordering (pickup, dine-in, delivery)",
      "Kitchen board for web & till tickets",
      "CSV import · end-of-day & reports",
      "Best value vs hardware-tied POS in the UK",
    ],
  },
  {
    id: "multi",
    name: "Group",
    tagline: "One cloud for every site — stock that moves with you.",
    audience: "Multi-site groups and growing brands",
    monthlyGbp: 99,
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
      "Shared catalogue ops across sites",
      "Priority pilot support",
      "Scale without swapping platforms",
    ],
  },
];

export function getPlan(id: string | null | undefined): PlanDefinition {
  return PLANS.find((p) => p.id === id) ?? PLANS[0];
}

export function planHasFeature(planId: string | null | undefined, feature: PlanFeature): boolean {
  return getPlan(planId).features.includes(feature);
}
