import { getPlan } from "@cloudtill/shared";

/** 10% of the monthly plan. No first-year bonus on top. */
export const COMMISSION_RATE = 0.1;

const LONDON = "Europe/London";

export type CommissionAuditEvent = {
  type?: string;
  at?: string;
  detail?: Record<string, unknown>;
};

export type CustomerCommissionInput = {
  createdAt: Date;
  /**
   * Status stored on the business. Pass "trialing" when the live status is only
   * "expired" because the trial date has passed — the trial end is applied here.
   */
  storedStatus: string;
  planId: string;
  trialEndsAt: string | null;
  audit: CommissionAuditEvent[];
  isDemo: boolean;
};

export type CustomerCommission = {
  owed: boolean;
  planId: string;
  planName: string;
  /** Monthly plan price in pence. The price the 10% is based on when something is owed. */
  planAmountPence: number;
  commissionPence: number;
  reason: string;
  paidMonth: string;
  paidMonthLabel: string;
  owedMonth: string;
  owedMonthLabel: string;
};

type Snapshot = { at: number; status: string; planId: string };

const STATUS_EVENTS = new Set([
  "signup",
  "admin_issue_license",
  "activate_license",
  "admin_change_plan",
  "admin_revoke_license",
  "admin_extend_trial",
]);

function londonWall(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) bag[part.type] = part.value;
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

/** London wall-clock time as a UTC instant. */
export function londonWallToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 4; i += 1) {
    const wall = londonWall(new Date(utc));
    const got = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
    const want = Date.UTC(year, month - 1, day, hour, minute, second);
    const delta = got - want;
    if (delta === 0) return new Date(utc);
    utc -= delta;
  }
  return new Date(utc);
}

export function londonMonthOf(date: Date): { year: number; month: number } {
  const wall = londonWall(date);
  return { year: wall.year, month: wall.month };
}

export function previousMonth(year: number, month: number): { year: number; month: number } {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

export function nextMonth(year: number, month: number): { year: number; month: number } {
  if (month === 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: LONDON,
  }).format(londonWallToUtc(year, month, 15, 12, 0, 0));
}

/** [start, end) of a London calendar month, in epoch ms. */
export function londonMonthWindow(year: number, month: number): { start: number; end: number } {
  const start = londonWallToUtc(year, month, 1, 0, 0, 0).getTime();
  const next = nextMonth(year, month);
  const end = londonWallToUtc(next.year, next.month, 1, 0, 0, 0).getTime();
  return { start, end };
}

function detailString(detail: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = detail?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function statusAt(points: Snapshot[], time: number): Snapshot | null {
  let current: Snapshot | null = null;
  for (const point of points) {
    if (point.at <= time) current = point;
    else break;
  }
  return current;
}

function buildTimeline(input: CustomerCommissionInput): Snapshot[] {
  const createdAt = input.createdAt.getTime();
  const events = input.audit
    .map((event) => ({
      type: event.type || "",
      at: event.at ? new Date(event.at).getTime() : NaN,
      detail: event.detail || {},
    }))
    .filter((event) => event.type && Number.isFinite(event.at))
    .sort((a, b) => a.at - b.at);

  let status = "trialing";
  let planId = input.planId || "starter";
  if (!events.some((event) => STATUS_EVENTS.has(event.type))) {
    status = input.storedStatus === "expired" ? "trialing" : input.storedStatus || "trialing";
  }

  const points: Snapshot[] = [{ at: createdAt, status, planId }];
  const apply = (at: number, nextStatus?: string, nextPlan?: string) => {
    if (nextPlan) planId = nextPlan;
    if (nextStatus) status = nextStatus;
    points.push({ at, status, planId });
  };

  for (const event of events) {
    const detail = event.detail;
    switch (event.type) {
      case "signup":
        apply(event.at, "trialing", detailString(detail, "planId"));
        break;
      case "admin_issue_license":
        apply(event.at, detail.activate === false ? undefined : "active", detailString(detail, "planId"));
        break;
      case "activate_license":
        apply(event.at, "active", detailString(detail, "planId"));
        break;
      case "admin_change_plan":
        apply(event.at, detailString(detail, "status"), detailString(detail, "planId"));
        break;
      case "change_plan":
        apply(event.at, undefined, detailString(detail, "to") || detailString(detail, "planId"));
        break;
      case "admin_revoke_license":
        apply(event.at, "canceled");
        break;
      case "admin_extend_trial":
        apply(event.at, detailString(detail, "status") === "active" ? "active" : "trialing");
        break;
      default:
        break;
    }
  }

  points.sort((a, b) => a.at - b.at);

  if (input.trialEndsAt) {
    const exp = new Date(input.trialEndsAt).getTime();
    if (Number.isFinite(exp)) {
      const before = statusAt(points, exp - 1);
      const atExp = statusAt(points, exp);
      const stillTrial = before?.status === "trialing" && (!atExp || atExp.at < exp || atExp.status === "trialing");
      if (stillTrial && before) {
        points.push({ at: exp, status: "expired", planId: before.planId });
        points.sort((a, b) => a.at - b.at);
      }
    }
  }

  return points;
}

/** Plan id if the subscription was paid at any point in [start, end), else null. */
function paidPlanDuring(points: Snapshot[], start: number, end: number): string | null {
  let plan: string | null = null;
  const opening = statusAt(points, start);
  if (opening && opening.status === "active") plan = opening.planId;
  for (const point of points) {
    if (point.at <= start) continue;
    if (point.at >= end) break;
    if (point.status === "active") plan = point.planId;
  }
  return plan;
}

export function planMonthlyPence(planId: string): number {
  return Math.round(getPlan(planId).monthlyGbp * 100);
}

export function commissionPenceForPlan(planId: string): number {
  return Math.round(getPlan(planId).monthlyGbp * 100 * COMMISSION_RATE);
}

function gbp(pence: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
}

/**
 * What is owed this London calendar month for one business.
 * A month is paid when the plan was active at any time in that month.
 * Commission for that month is owed the following month, then stops after they cancel.
 */
export function commissionForCustomer(input: CustomerCommissionInput, now = new Date()): CustomerCommission {
  const owed = londonMonthOf(now);
  const paid = previousMonth(owed.year, owed.month);
  const paidWindow = londonMonthWindow(paid.year, paid.month);
  const thisWindow = londonMonthWindow(owed.year, owed.month);
  const paidMonth = monthKey(paid.year, paid.month);
  const owedMonth = monthKey(owed.year, owed.month);
  const paidMonthLabel = monthLabel(paid.year, paid.month);
  const owedMonthLabel = monthLabel(owed.year, owed.month);
  const points = buildTimeline(input);
  const nowSnap = statusAt(points, now.getTime());
  const statusNow = nowSnap?.status || input.storedStatus || "trialing";
  const currentPlanId = nowSnap?.planId || input.planId || "starter";

  const base = {
    paidMonth,
    paidMonthLabel,
    owedMonth,
    owedMonthLabel,
  };

  if (input.isDemo) {
    const plan = getPlan(input.planId);
    return {
      ...base,
      owed: false,
      planId: plan.id,
      planName: plan.name,
      planAmountPence: planMonthlyPence(plan.id),
      commissionPence: 0,
      reason: "The shared demo isn't a paying customer.",
    };
  }

  const paidLastPlan = paidPlanDuring(points, paidWindow.start, paidWindow.end);
  const paidThisPlan = paidPlanDuring(points, thisWindow.start, thisWindow.end);
  const existedLastMonth = input.createdAt.getTime() < paidWindow.end;

  if (paidLastPlan) {
    const plan = getPlan(paidLastPlan);
    const amount = planMonthlyPence(plan.id);
    const commission = commissionPenceForPlan(plan.id);
    let reason = `Paid ${plan.name} (${gbp(amount)}) in ${paidMonthLabel}. 10% is owed in ${owedMonthLabel}.`;
    if (paidThisPlan && statusNow === "canceled") {
      reason += ` They also paid in ${owedMonthLabel} before cancelling, so 10% of that is owed next month and then it stops.`;
    } else if (!paidThisPlan && statusNow !== "active") {
      reason += " They've cancelled, so nothing is owed after this month.";
    }
    return {
      ...base,
      owed: true,
      planId: plan.id,
      planName: plan.name,
      planAmountPence: amount,
      commissionPence: commission,
      reason,
    };
  }

  if (paidThisPlan) {
    const plan = getPlan(paidThisPlan);
    const amount = planMonthlyPence(plan.id);
    const reason =
      statusNow === "canceled"
        ? `They paid ${plan.name} (${gbp(amount)}) in ${owedMonthLabel}, then cancelled. 10% is owed next month. Nothing is owed in ${owedMonthLabel} itself.`
        : `Paid ${plan.name} (${gbp(amount)}) in ${owedMonthLabel}. 10% is owed next month, not in ${owedMonthLabel}.`;
    return {
      ...base,
      owed: false,
      planId: plan.id,
      planName: plan.name,
      planAmountPence: amount,
      commissionPence: 0,
      reason,
    };
  }

  const plan = getPlan(currentPlanId);
  const amount = planMonthlyPence(plan.id);
  let reason: string;
  if (!existedLastMonth) {
    reason = `Signed up after ${paidMonthLabel}. Nothing is owed in ${owedMonthLabel}.`;
  } else if (statusNow === "trialing") {
    reason = `On a free trial of ${plan.name}. Nothing is owed until the month after they pay.`;
  } else if (statusNow === "expired") {
    reason = "Trial ended. Nothing is owed until they pay.";
  } else if (statusNow === "canceled") {
    reason = `Cancelled. Nothing is owed in ${owedMonthLabel}.`;
  } else if (statusNow === "past_due") {
    reason = `Payment overdue. Nothing is owed in ${owedMonthLabel}.`;
  } else {
    reason = `Not paid in ${paidMonthLabel}. Nothing is owed in ${owedMonthLabel}.`;
  }

  return {
    ...base,
    owed: false,
    planId: plan.id,
    planName: plan.name,
    planAmountPence: amount,
    commissionPence: 0,
    reason,
  };
}
