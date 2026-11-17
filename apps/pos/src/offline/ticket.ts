import { nanoid } from "./id";
import {
  clearLocalTicket,
  enqueueSale,
  readLocalTicket,
  saveLocalTicket,
  type LocalTicket,
  type QueuedSale,
} from "./db";
import { refreshOfflineBadge } from "./sync";

export function emptyLocalTicket(registerId: string): LocalTicket {
  return {
    id: `local-${nanoid()}`,
    registerId,
    name: "Sale",
    status: "open",
    customerId: null,
    customer: null,
    lines: [],
    discountCents: 0,
    discountPercent: 0,
    tipCents: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function totalsFromLocal(
  ticket: LocalTicket,
  taxRateBps = 825,
  taxInclusive = false
): { subtotalCents: number; taxCents: number; totalCents: number } {
  let subtotal = 0;
  for (const line of ticket.lines) {
    const modSum = line.modifiers.reduce((s, m) => s + m.priceCents, 0);
    subtotal += Math.round((line.unitPriceCents + modSum) * line.quantity) - line.discountCents;
  }
  const afterPct = Math.max(0, subtotal - Math.round((subtotal * (ticket.discountPercent || 0)) / 100));
  const afterDisc = Math.max(0, afterPct - ticket.discountCents);
  const taxCents = taxInclusive ? 0 : Math.round((afterDisc * taxRateBps) / 10000);
  const totalCents = afterDisc + taxCents + ticket.tipCents;
  return { subtotalCents: afterDisc, taxCents, totalCents };
}

export function withTotals(
  ticket: LocalTicket,
  taxRateBps = 825
): LocalTicket & { subtotalCents: number; taxCents: number; totalCents: number } {
  const totals = totalsFromLocal(ticket, taxRateBps);
  return { ...ticket, ...totals };
}

export async function ensureLocalTicket(registerId: string): Promise<LocalTicket> {
  const existing = await readLocalTicket(registerId);
  if (existing) return existing;
  const created = emptyLocalTicket(registerId);
  await saveLocalTicket(created);
  return created;
}

export async function persistLocalTicket(ticket: LocalTicket): Promise<LocalTicket> {
  const next = { ...ticket, updatedAt: new Date().toISOString() };
  await saveLocalTicket(next);
  return next;
}

export async function queueCompletedLocalSale(opts: {
  ticket: LocalTicket;
  payments: QueuedSale["payload"]["payments"];
  taxRateBps?: number;
}): Promise<{ clientSaleId: string; changeCents: number; totalCents: number; text: string }> {
  const totals = totalsFromLocal(opts.ticket, opts.taxRateBps ?? 825);
  const paid = opts.payments.reduce((s, p) => s + p.amountCents, 0);
  if (paid < totals.totalCents) throw new Error("Insufficient payment");
  const clientSaleId = `offline-${nanoid()}`;
  const sale: QueuedSale = {
    id: clientSaleId,
    registerId: opts.ticket.registerId,
    createdAt: new Date().toISOString(),
    status: "pending",
    payload: {
      clientSaleId,
      registerId: opts.ticket.registerId,
      customerId: opts.ticket.customerId,
      note: opts.ticket.name,
      discountCents: opts.ticket.discountCents,
      tipCents: opts.ticket.tipCents,
      lines: opts.ticket.lines.map((line) => ({
        variantId: line.variantId,
        name: line.name,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        discountCents: line.discountCents,
        modifiers: line.modifiers,
      })),
      payments: opts.payments,
    },
  };
  await enqueueSale(sale);
  await clearLocalTicket(opts.ticket.id);
  await refreshOfflineBadge();
  const changeCents = paid - totals.totalCents;
  const text = [
    "OFFLINE SALE (queued)",
    clientSaleId,
    ...opts.ticket.lines.map((l) => `${l.quantity} x ${l.name}`),
    `TOTAL £${(totals.totalCents / 100).toFixed(2)}`,
    changeCents > 0 ? `CHANGE £${(changeCents / 100).toFixed(2)}` : "",
    "Will sync when back online",
  ]
    .filter(Boolean)
    .join("\n");
  return { clientSaleId, changeCents, totalCents: totals.totalCents, text };
}
