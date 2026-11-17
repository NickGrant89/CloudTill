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
  monthlyGbp: number;
  trialDays: number;
  features: PlanFeature[];
  highlights: string[];
}

export const PLANS: PlanDefinition[] = [
  {
    id: "starter",
    name: "Starter",
    tagline: "Hosted cloud BO + one offline-capable till",
    monthlyGbp: 29,
    trialDays: 14,
    features: ["pos", "backoffice", "offline_sync"],
    highlights: [
      "Central cloud catalog & BO",
      "1 store · 1 register",
      "Till caches catalog · queues sales offline",
      "Email support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Full cloud shop: kitchen, ordering, import",
    monthlyGbp: 59,
    trialDays: 14,
    features: ["pos", "backoffice", "offline_sync", "online_ordering", "csv_import", "kitchen", "advanced_reports"],
    highlights: ["Everything in Starter", "Online ordering", "CSV import", "Kitchen + reports / EOD"],
  },
  {
    id: "multi",
    name: "Multi-store",
    tagline: "Multi-tenant cloud for groups of shops",
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
    highlights: ["Everything in Pro", "Multi-store transfers", "Shared cloud catalog ops", "Priority pilot support"],
  },
];

export function getPlan(id: string | null | undefined): PlanDefinition {
  return PLANS.find((p) => p.id === id) ?? PLANS[0];
}

export function planHasFeature(planId: string | null | undefined, feature: PlanFeature): boolean {
  return getPlan(planId).features.includes(feature);
}
