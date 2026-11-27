import assert from "node:assert/strict";
import test from "node:test";
import {
  commissionForCustomer,
  commissionPenceForPlan,
  londonWallToUtc,
  type CustomerCommissionInput,
} from "./salesCommission.js";

const NOW = new Date("2026-11-27T12:00:00.000Z");

function customer(overrides: Partial<CustomerCommissionInput> = {}): CustomerCommissionInput {
  return {
    createdAt: new Date("2026-09-01T09:00:00.000Z"),
    storedStatus: "trialing",
    planId: "pro",
    trialEndsAt: "2026-09-15T09:00:00.000Z",
    audit: [{ type: "signup", at: "2026-09-01T09:00:00.000Z", detail: { planId: "pro" } }],
    isDemo: false,
    ...overrides,
  };
}

test("10% of the live plan prices, with no extra on top", () => {
  assert.equal(commissionPenceForPlan("starter"), 190);
  assert.equal(commissionPenceForPlan("pro"), 350);
  assert.equal(commissionPenceForPlan("multi"), 590);
});

test("paid all of last month: 10% is owed this month", () => {
  const line = commissionForCustomer(
    customer({
      audit: [
        { type: "signup", at: "2026-09-01T09:00:00.000Z", detail: { planId: "pro" } },
        { type: "admin_change_plan", at: "2026-10-02T10:00:00.000Z", detail: { planId: "pro", status: "active" } },
      ],
    }),
    NOW
  );
  assert.equal(line.owed, true);
  assert.equal(line.planId, "pro");
  assert.equal(line.planName, "Complete");
  assert.equal(line.planAmountPence, 3500);
  assert.equal(line.commissionPence, 350);
  assert.equal(line.owedMonth, "2026-11");
  assert.equal(line.paidMonth, "2026-10");
  assert.match(line.reason, /October 2026/);
  assert.match(line.reason, /November 2026/);
});

test("marked paid this month: nothing is owed until next month", () => {
  const line = commissionForCustomer(
    customer({
      audit: [
        { type: "signup", at: "2026-11-01T09:00:00.000Z", detail: { planId: "starter" } },
        { type: "activate_license", at: "2026-11-02T09:00:00.000Z", detail: { planId: "starter" } },
      ],
      createdAt: new Date("2026-11-01T09:00:00.000Z"),
      planId: "starter",
    }),
    NOW
  );
  assert.equal(line.owed, false);
  assert.equal(line.commissionPence, 0);
  assert.equal(line.planAmountPence, 1900);
  assert.match(line.reason, /owed next month/);
});

test("cancelled in the current month still owes last month's 10%, then stops", () => {
  const line = commissionForCustomer(
    customer({
      audit: [
        { type: "signup", at: "2026-09-01T09:00:00.000Z", detail: { planId: "multi" } },
        { type: "admin_issue_license", at: "2026-10-01T09:00:00.000Z", detail: { planId: "multi" } },
        { type: "admin_revoke_license", at: "2026-11-02T09:00:00.000Z", detail: {} },
      ],
      planId: "multi",
    }),
    NOW
  );
  assert.equal(line.owed, true);
  assert.equal(line.commissionPence, 590);
  assert.equal(line.planAmountPence, 5900);
  assert.match(line.reason, /owed next month/);
  assert.match(line.reason, /stops/);
});

test("cancelled during last month: that month was paid, so commission is owed now", () => {
  const line = commissionForCustomer(
    customer({
      audit: [
        { type: "signup", at: "2026-09-01T09:00:00.000Z", detail: { planId: "starter" } },
        { type: "admin_change_plan", at: "2026-10-01T09:00:00.000Z", detail: { planId: "starter", status: "active" } },
        { type: "admin_revoke_license", at: "2026-10-10T09:00:00.000Z", detail: {} },
      ],
      planId: "starter",
    }),
    NOW
  );
  assert.equal(line.owed, true);
  assert.equal(line.commissionPence, 190);
  assert.match(line.reason, /nothing is owed after this month/i);
});

test("cancelled before last month: nothing is owed this month", () => {
  const line = commissionForCustomer(
    customer({
      audit: [
        { type: "signup", at: "2026-08-01T09:00:00.000Z", detail: { planId: "pro" } },
        { type: "activate_license", at: "2026-08-02T09:00:00.000Z", detail: { planId: "pro" } },
        { type: "admin_revoke_license", at: "2026-09-15T09:00:00.000Z", detail: {} },
      ],
      createdAt: new Date("2026-08-01T09:00:00.000Z"),
    }),
    NOW
  );
  assert.equal(line.owed, false);
  assert.equal(line.commissionPence, 0);
  assert.match(line.reason, /Cancelled/);
});

test("a free trial does not earn commission", () => {
  const line = commissionForCustomer(
    customer({
      createdAt: new Date("2026-10-01T09:00:00.000Z"),
      trialEndsAt: "2026-12-01T09:00:00.000Z",
      audit: [{ type: "signup", at: "2026-10-01T09:00:00.000Z", detail: { planId: "pro" } }],
    }),
    NOW
  );
  assert.equal(line.owed, false);
  assert.equal(line.commissionPence, 0);
  assert.match(line.reason, /free trial/);
});

test("trial that ended last month is not a paid month", () => {
  const line = commissionForCustomer(
    customer({
      trialEndsAt: "2026-10-20T09:00:00.000Z",
      audit: [{ type: "signup", at: "2026-10-01T09:00:00.000Z", detail: { planId: "pro" } }],
      createdAt: new Date("2026-10-01T09:00:00.000Z"),
    }),
    NOW
  );
  assert.equal(line.owed, false);
  assert.equal(line.commissionPence, 0);
  assert.match(line.reason, /Trial ended/);
});

test("upgrade during the paid month uses the plan they finished that month on", () => {
  const line = commissionForCustomer(
    customer({
      audit: [
        { type: "signup", at: "2026-09-01T09:00:00.000Z", detail: { planId: "starter" } },
        { type: "admin_change_plan", at: "2026-10-01T09:00:00.000Z", detail: { planId: "starter", status: "active" } },
        { type: "change_plan", at: "2026-10-20T09:00:00.000Z", detail: { from: "starter", to: "pro" } },
      ],
      planId: "pro",
    }),
    NOW
  );
  assert.equal(line.owed, true);
  assert.equal(line.planId, "pro");
  assert.equal(line.commissionPence, 350);
});

test("overdue the whole of last month is not paid", () => {
  const line = commissionForCustomer(
    customer({
      audit: [
        { type: "signup", at: "2026-09-01T09:00:00.000Z", detail: { planId: "pro" } },
        { type: "admin_change_plan", at: "2026-09-20T09:00:00.000Z", detail: { planId: "pro", status: "past_due" } },
      ],
      storedStatus: "past_due",
    }),
    NOW
  );
  assert.equal(line.owed, false);
  assert.match(line.reason, /overdue/);
});

test("a year of paying is still only 10% of last month — no first-year bonus and no backlog", () => {
  const line = commissionForCustomer(
    customer({
      createdAt: new Date("2025-01-02T09:00:00.000Z"),
      planId: "pro",
      audit: [
        { type: "signup", at: "2025-01-02T09:00:00.000Z", detail: { planId: "pro" } },
        { type: "activate_license", at: "2025-01-16T09:00:00.000Z", detail: { planId: "pro" } },
      ],
    }),
    NOW
  );
  assert.equal(line.commissionPence, 350);
  assert.equal(line.planAmountPence, 3500);
});

test("the demo café is never commissioned", () => {
  const line = commissionForCustomer(
    customer({
      isDemo: true,
      storedStatus: "active",
      audit: [],
    }),
    NOW
  );
  assert.equal(line.owed, false);
  assert.equal(line.commissionPence, 0);
  assert.match(line.reason, /demo/);
});

test("issuing a key without activating does not count as paid", () => {
  const line = commissionForCustomer(
    customer({
      audit: [
        { type: "signup", at: "2026-09-01T09:00:00.000Z", detail: { planId: "pro" } },
        { type: "admin_issue_license", at: "2026-10-05T09:00:00.000Z", detail: { planId: "pro", activate: false } },
      ],
    }),
    NOW
  );
  assert.equal(line.owed, false);
  assert.equal(line.commissionPence, 0);
});

test("London summer time: active only after the June month-end is not a June payment", () => {
  const july = new Date("2026-07-15T12:00:00.000Z");
  const endOfJuneLondon = londonWallToUtc(2026, 7, 1, 0, 0, 0);
  assert.equal(endOfJuneLondon.toISOString(), "2026-06-30T23:00:00.000Z");

  const paidInJulyOnly = commissionForCustomer(
    customer({
      createdAt: new Date("2026-06-01T09:00:00.000Z"),
      audit: [
        { type: "signup", at: "2026-06-01T09:00:00.000Z", detail: { planId: "pro" } },
        { type: "activate_license", at: "2026-06-30T23:30:00.000Z", detail: { planId: "pro" } },
      ],
    }),
    july
  );
  assert.equal(paidInJulyOnly.owed, false);
  assert.match(paidInJulyOnly.reason, /owed next month/);

  const paidInJune = commissionForCustomer(
    customer({
      createdAt: new Date("2026-06-01T09:00:00.000Z"),
      audit: [
        { type: "signup", at: "2026-06-01T09:00:00.000Z", detail: { planId: "starter" } },
        { type: "activate_license", at: "2026-06-15T12:00:00.000Z", detail: { planId: "starter" } },
      ],
      planId: "starter",
    }),
    july
  );
  assert.equal(paidInJune.owed, true);
  assert.equal(paidInJune.commissionPence, 190);
  assert.equal(paidInJune.paidMonth, "2026-06");
});
