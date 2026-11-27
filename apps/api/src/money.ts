/** Tax helpers: rateBps is basis points (825 = 8.25%) */

export function lineSubtotal(
  unitPriceCents: number,
  quantity: number,
  modifiersCents: number,
  discountCents: number
): number {
  const base = Math.round((unitPriceCents + modifiersCents) * quantity);
  return Math.max(0, base - discountCents);
}

export function calcTax(subtotalAfterDiscount: number, rateBps: number, inclusive: boolean): number {
  if (rateBps <= 0) return 0;
  if (inclusive) {
    return Math.round(subtotalAfterDiscount - subtotalAfterDiscount / (1 + rateBps / 10000));
  }
  return Math.round((subtotalAfterDiscount * rateBps) / 10000);
}

export function currencySymbol(currency: string | null | undefined): string {
  const code = (currency || "GBP").toUpperCase();
  if (code === "GBP") return "£";
  if (code === "USD") return "$";
  if (code === "EUR") return "€";
  return `${code} `;
}

export function formatMoney(cents: number, symbol = "£"): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}${symbol}${(Math.abs(cents) / 100).toFixed(2)}`;
}
