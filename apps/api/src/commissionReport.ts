import { DEMO_COMPANY } from "./company.js";
import { prisma } from "./db.js";
import { readBilling } from "./routes/billing.js";
import {
  commissionForCustomer,
  COMMISSION_RATE,
  londonMonthOf,
  monthKey,
  monthLabel,
  previousMonth,
  type CommissionAuditEvent,
  type CustomerCommissionInput,
} from "./salesCommission.js";

export async function loadCommissionReport(now = new Date()) {
  const owed = londonMonthOf(now);
  const paid = previousMonth(owed.year, owed.month);
  const owedMonth = monthKey(owed.year, owed.month);
  const paidMonth = monthKey(paid.year, paid.month);
  const owedMonthLabel = monthLabel(owed.year, owed.month);
  const paidMonthLabel = monthLabel(paid.year, paid.month);

  const [people, stores, owners] = await Promise.all([
    prisma.salesPerson.findMany({
      orderBy: { name: "asc" },
      include: { attributions: true },
    }),
    prisma.store.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, companyKey: true, createdAt: true },
    }),
    prisma.employee.findMany({
      where: { role: "owner" },
      select: { storeId: true, email: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const groups = new Map<string, typeof stores>();
  for (const store of stores) {
    const key = store.companyKey || store.id;
    const list = groups.get(key) ?? [];
    list.push(store);
    groups.set(key, list);
  }

  const ownerByStore = new Map<string, string>();
  for (const owner of owners) {
    if (owner.email && !ownerByStore.has(owner.storeId)) ownerByStore.set(owner.storeId, owner.email);
  }

  const billingCache = new Map<string, Awaited<ReturnType<typeof readBilling>>>();

  async function customerInput(companyKey: string): Promise<{
    input: CustomerCommissionInput;
    name: string;
    storeId: string;
    ownerEmail: string | null;
  } | null> {
    const group = groups.get(companyKey);
    if (!group?.length) return null;
    const hq = group[0];
    let billing = billingCache.get(hq.id);
    if (!billing) {
      billing = await readBilling(hq.id);
      billingCache.set(hq.id, billing);
    }
    const ownerEmail = group.map((store) => ownerByStore.get(store.id)).find(Boolean) ?? null;
    return {
      name: hq.name,
      storeId: hq.id,
      ownerEmail,
      input: {
        createdAt: hq.createdAt,
        storedStatus: billing.status === "expired" ? "trialing" : billing.status,
        planId: billing.planId,
        trialEndsAt: billing.trialEndsAt,
        audit: (Array.isArray(billing.audit) ? billing.audit : []) as CommissionAuditEvent[],
        isDemo: hq.companyKey === DEMO_COMPANY,
      },
    };
  }

  const salesPeople = [];
  let totalCommissionPence = 0;

  for (const person of people) {
    const lines = [];
    let personTotal = 0;
    const attributions = [...person.attributions].sort((a, b) => a.companyKey.localeCompare(b.companyKey));
    for (const attribution of attributions) {
      const customer = await customerInput(attribution.companyKey);
      if (!customer) {
        lines.push({
          companyKey: attribution.companyKey,
          storeId: attribution.storeId,
          customerName: "Removed business",
          ownerEmail: null,
          planId: null,
          planName: "—",
          planAmountPence: 0,
          commissionPence: 0,
          owed: false,
          reason: "This business was deleted. Nothing is owed.",
        });
        continue;
      }
      const commission = commissionForCustomer(customer.input, now);
      personTotal += commission.commissionPence;
      lines.push({
        companyKey: attribution.companyKey,
        storeId: customer.storeId,
        customerName: customer.name,
        ownerEmail: customer.ownerEmail,
        planId: commission.planId,
        planName: commission.planName,
        planAmountPence: commission.planAmountPence,
        commissionPence: commission.commissionPence,
        owed: commission.owed,
        reason: commission.reason,
      });
    }
    lines.sort(
      (a, b) => Number(b.owed) - Number(a.owed) || a.customerName.localeCompare(b.customerName, "en-GB")
    );
    totalCommissionPence += personTotal;
    salesPeople.push({
      id: person.id,
      name: person.name,
      email: person.email,
      phone: person.phone,
      totalCommissionPence: personTotal,
      lines,
    });
  }

  return {
    rate: COMMISSION_RATE,
    owedMonth,
    owedMonthLabel,
    paidMonth,
    paidMonthLabel,
    rule: `Owed in ${owedMonthLabel} is 10% of each business that was paid in ${paidMonthLabel}. A sales person earns that 10% every month the customer keeps paying. It is owed the following month, it stops when the customer cancels, and there is no first-year bonus.`,
    totalCommissionPence,
    salesPeople,
  };
}
