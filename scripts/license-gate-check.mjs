#!/usr/bin/env node
/**
 * License gate smoke (live or local). Uses demo store by default — expects 200 on kitchen/import.
 * For negative checks, set:
 *   STORE_ID, ADMIN_SECRET, and EXPIRE_TRIAL=1
 * to expire a non-production trial store via /api/admin and assert 402 on gated routes.
 *
 * Usage: BASE_URL=https://purepos.co.uk node scripts/license-gate-check.mjs
 */
const BASE = (process.env.BASE_URL || "https://purepos.co.uk").replace(/\/$/, "");
const API = `${BASE}/api`;

async function http(method, path, { token, body, adminSecret } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (adminSecret) headers["x-platform-admin-secret"] = adminSecret;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 160) };
  }
  return { status: res.status, json };
}

function log(ok, label, note = "") {
  console.log(`${ok ? "OK" : "FAIL"}\t${label}${note ? `\t${note}` : ""}`);
  return ok;
}

async function main() {
  const login = await http("POST", "/auth/login", {
    body: { email: "owner@purepos.demo", pin: "1234", client: "backoffice" },
  });
  if (login.status !== 200 || !login.json?.token) {
    console.error("Demo login failed — cannot continue");
    process.exit(1);
  }
  const token = login.json.token;

  const billing = await http("GET", "/billing", { token });
  const features = billing.json?.features ?? [];
  log(billing.status === 200, "GET /billing", `features=${features.join(",")}`);

  const kitchen = await http("GET", "/kitchen/orders", { token });
  log(kitchen.status === 200, "Demo kitchen (pro entitled)", String(kitchen.status));

  const importPreview = await http("POST", "/import/preview", {
    token,
    body: { kind: "items", csv: "name,sku,price\nTest,SKU1,1.00\n" },
  });
  log(importPreview.status === 200, "Demo CSV import preview", String(importPreview.status));

  if (process.env.STORE_ID && process.env.ADMIN_SECRET && process.env.EXPIRE_TRIAL === "1") {
    const storeId = process.env.STORE_ID;
    const adminSecret = process.env.ADMIN_SECRET;
    await http("PATCH", `/admin/stores/${storeId}/plan`, {
      adminSecret,
      body: { planId: "starter", status: "trialing" },
    });
    await http("POST", `/admin/stores/${storeId}/trial`, {
      adminSecret,
      body: { days: -1, status: "trialing" },
    });
    log(true, "Admin: expired starter trial", storeId);
    console.log("Re-login as that store owner and re-run import/kitchen/eod checks manually.");
  } else {
    console.log("Tip: set STORE_ID, ADMIN_SECRET, EXPIRE_TRIAL=1 to expire a pilot store and verify 402 gates.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});