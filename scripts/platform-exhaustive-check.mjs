#!/usr/bin/env node
/**
 * CT-116 exhaustive API matrix (live or local). Demo store only for writes.
 * Usage: BASE_URL=https://purepos.co.uk node scripts/platform-exhaustive-check.mjs
 */
const BASE = (process.env.BASE_URL || "https://purepos.co.uk").replace(/\/$/, "");
const API = `${BASE}/api`;

const results = [];

function record(area, action, status, note = "") {
  results.push({ area, action, status, note });
  const icon = status === "pass" ? "OK" : status === "fail" ? "FAIL" : status;
  console.log(`${icon}\t${area}\t${action}${note ? `\t${note}` : ""}`);
}

async function http(method, path, { token, body, expect } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 120) };
  }
  if (expect !== undefined && res.status !== expect) {
    throw new Error(`${method} ${path} expected ${expect} got ${res.status}: ${text.slice(0, 120)}`);
  }
  return { status: res.status, json };
}

async function main() {
  record("Platform", "health", "pending");
  try {
    const h = await fetch(`${API}/health`).then((r) => r.json());
    record("Platform", "health", h.ok ? "pass" : "fail", `v${h.version} db=${h.database} stores=${h.storeCount}`);
  } catch (e) {
    record("Platform", "health", "fail", e.message);
    return;
  }

  for (const [path, name] of [
    ["/", "marketing"],
    ["/bo/", "backoffice SPA"],
    ["/pos/", "till SPA"],
    ["/pos/kitchen", "kitchen SPA"],
    ["/order/", "ordering SPA"],
    ["/admin", "platform admin"],
    ["/pricing", "pricing redirect"],
  ]) {
    try {
      const r = await fetch(`${BASE}${path}`, { redirect: "manual" });
      const ok = r.status >= 200 && r.status < 400;
      record("Static", name, ok ? "pass" : "fail", String(r.status));
    } catch (e) {
      record("Static", name, "fail", e.message);
    }
  }
  record("Static", "/signup URL", "missing", "404 — signup is marketing modal + POST /api/public/signup");

  record("Security", "login invalid body", "pending");
  try {
    const r = await http("POST", "/auth/login", { body: { email: "x@y.com", password: "nope" }, expect: 400 });
    record("Security", "login invalid body (no crash)", "pass", String(r.status));
  } catch (e) {
    record("Security", "login invalid body", "fail", e.message);
  }

  record("Security", "settings without auth", "pending");
  try {
    await http("GET", "/settings", { expect: 401 });
    record("Security", "settings without auth", "pass");
  } catch (e) {
    record("Security", "settings without auth", "fail", e.message);
  }

  let token;
  try {
    const login = await http("POST", "/auth/login", {
      body: { email: "owner@purepos.demo", pin: "1234", client: "backoffice" },
      expect: 200,
    });
    token = login.json.token;
    record("Auth", "demo BO login", "pass");
  } catch (e) {
    record("Auth", "demo BO login", "fail", e.message);
    console.error("\nCannot continue matrix without token.");
    return;
  }

  const reads = [
    ["Back office", "GET /settings", "/settings"],
    ["Back office", "GET items", "/catalog/items"],
    ["Back office", "GET groups", "/catalog/categories"],
    ["Back office", "GET employees", "/employees"],
    ["Back office", "GET customers", "/customers"],
    ["Back office", "GET sales", "/sales"],
    ["Back office", "GET reports summary", "/reports/summary"],
    ["Back office", "GET billing", "/billing"],
    ["Back office", "GET shifts", "/shifts"],
    ["Back office", "GET gift-cards", "/gift-cards"],
    ["Back office", "GET inventory", "/inventory/levels"],
    ["Till API", "GET catalog items", "/catalog/items"],
    ["Till API", "GET payment types", "/pos/payment-types"],
    ["Till API", "GET tickets", "/pos/tickets"],
    ["Kitchen", "GET orders", "/kitchen/orders"],
    ["Ordering", "GET public menu", "/public/stores/demo-cafe/menu"],
    ["Stores", "GET auth/stores", "/auth/stores"],
    ["Devices", "GET devices", "/employees/devices"],
    ["Devices", "GET registers", "/employees/registers"],
    ["Import", "POST loyverse preview invalid", "/import/loyverse/preview"],
    ["Extras", "GET tickets-board", "/extras/tickets-board"],
  ];

  for (const [area, label, path] of reads) {
    try {
      const { status } = await http("GET", path, { token, expect: 200 });
      record(area, label, "pass", String(status));
    } catch (e) {
      record(area, label, "fail", e.message);
    }
  }

  try {
    await http("POST", "/pos/tickets", { token, body: {}, expect: 400 });
    record("Till API", "POST ticket invalid (no crash)", "pass");
  } catch (e) {
    record("Till API", "POST ticket invalid", "fail", e.message);
  }

  try {
    await http("POST", "/import/loyverse/preview", { token, body: {}, expect: 400 });
    record("Import", "Loyverse preview validation", "pass");
  } catch (e) {
    record("Import", "Loyverse preview validation", "fail", e.message);
  }

  try {
    await http("POST", "/public/signup", {
      body: { businessName: "x", email: "not-an-email", planId: "pro" },
      expect: 400,
    });
    record("Signup", "validation", "pass");
  } catch (e) {
    record("Signup", "validation", "fail", e.message);
  }

  record("UI matrix", "BO 19 pages", "manual", "See platform-smoke-report.md — CRUD/modals need browser");
  record("UI matrix", "Till pizza flow", "manual", "G&A + demo — browser");
  record("Stripe", "checkout", "missing", "No STRIPE_SECRET_KEY on trial path");
  record("Infra", "admin.purepos.co.uk", "missing", "Railway Pro second custom domain");

  const fails = results.filter((r) => r.status === "fail").length;
  console.log(`\n${results.length} checks, ${fails} failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});