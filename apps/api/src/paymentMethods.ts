/** Till tenders. Cash and Card are built in so existing sales and drawers keep a row to use. */

const RANK: Record<string, number> = {
  cash: 0,
  card: 1,
  other: 2,
  store_credit: 3,
  gift_card: 4,
};

export function isBuiltinTender(type: string) {
  return type === "cash" || type === "card";
}

export function sortPaymentMethods<T extends { type: string; name: string }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => (RANK[a.type] ?? 9) - (RANK[b.type] ?? 9) || a.name.localeCompare(b.name, "en")
  );
}

export function turnedOffTenderName<T extends { name: string; enabled: boolean }>(
  payments: { paymentTypeId: string }[],
  ptMap: Map<string, T>
): string | null {
  for (const payment of payments) {
    const tender = ptMap.get(payment.paymentTypeId);
    if (tender && !tender.enabled) return tender.name;
  }
  return null;
}
