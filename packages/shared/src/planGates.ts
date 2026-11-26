import type { PlanFeature, PlanId } from "./plans.js";
import { getPlan, planHasFeature } from "./plans.js";

/** Minimum plan id (for labels) — mirrors marketing table in docs/pricing.md */
export const FEATURE_MIN_PLAN: Record<PlanFeature, PlanId> = {
  pos: "starter",
  backoffice: "starter",
  offline_sync: "starter",
  csv_import: "pro",
  online_ordering: "pro",
  kitchen: "pro",
  advanced_reports: "pro",
  multi_store: "multi",
};

export function featureMinimumName(feature: PlanFeature): string {
  return getPlan(FEATURE_MIN_PLAN[feature]).name;
}

/** Back-office nav entries that require a paid feature entitlement (not pos/backoffice basics). */
export const BACKOFFICE_NAV_FEATURE: Partial<Record<string, PlanFeature>> = {
  import: "csv_import",
  kitchen: "kitchen",
  eod: "advanced_reports",
};

export function backOfficeNavAllowed(pageId: string, entitledFeatures: readonly string[]): boolean {
  const need = BACKOFFICE_NAV_FEATURE[pageId];
  if (!need) return true;
  return entitledFeatures.includes(need);
}

export function upgradeBillingHint(message: string): string {
  if (/Upgrade in Settings|Upgrade in Billing|Upgrade under Settings|402/i.test(message)) {
    return /Settings → Billing/i.test(message) ? message : `${message} Open Settings → Billing to upgrade.`;
  }
  if (/Complete or Multi|Multi plan|csv_import|advanced_reports|multi_store|online ordering/i.test(message)) {
    return `${message} Open Settings → Billing to upgrade.`;
  }
  return message;
}

/** Re-export for API and UI — single import surface for gate checks. */
export { planHasFeature };