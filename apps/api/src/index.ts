import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authRouter } from "./routes/auth.js";
import { catalogRouter } from "./routes/catalog.js";
import { posRouter } from "./routes/pos.js";
import { shiftsRouter } from "./routes/shifts.js";
import { inventoryRouter } from "./routes/inventory.js";
import { customersRouter } from "./routes/customers.js";
import { employeesRouter } from "./routes/employees.js";
import { salesRouter } from "./routes/sales.js";
import { reportsRouter } from "./routes/reports.js";
import { settingsRouter } from "./routes/settings.js";
import { giftCardsRouter } from "./routes/giftcards.js";
import { timeClockRouter } from "./routes/timeclock.js";
import { kitchenRouter, publicOrderingRouter } from "./routes/ordering.js";
import { printersRouter } from "./routes/printers.js";
import { extrasRouter } from "./routes/extras.js";
import { importRouter } from "./routes/import.js";
import { billingRouter, publicBillingRouter } from "./routes/billing.js";
import { adminRouter } from "./routes/admin.js";
import { backupRouter } from "./routes/backup.js";
import { deliveryRouter, publicDeliveryRouter } from "./routes/delivery.js";
import { textPayRouter, publicTextPayRouter } from "./routes/textpay.js";
import { prisma } from "./db.js";
import { backfillCompanyKeys } from "./company.js";
import { migrateBillingEntitlements } from "./routes/billing.js";
import { syncModifierGroupSortOrders } from "./modifierFolders.js";
import { orderingHostMiddleware } from "./orderingHost.js";
import { installAsyncHandlers } from "./expressAsync.js";

const app = express();

/** Express 4 does not forward rejections from async handlers to the error middleware. */
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection", reason);
});

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || "0.0.0.0";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(cors());

/** admin.<domain> serves only the platform admin panel; ADMIN_HOST moves /admin there once its DNS is live. */
const ADMIN_HOST = process.env.ADMIN_HOST?.trim().toLowerCase() || "";
const MAIN_SITE = process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, "") || "https://purepos.co.uk";
app.use((req, res, next) => {
  const host = (req.hostname || "").toLowerCase();
  const onAdminHost = host.startsWith("admin.") || (ADMIN_HOST !== "" && host === ADMIN_HOST);
  if (onAdminHost) {
    if (req.path === "/" || req.path === "/admin" || req.path === "/admin/") {
      return res.sendFile(path.join(__dirname, "../public/admin.html"));
    }
    if (req.path.startsWith("/api/admin") || req.path === "/api/health") return next();
    return res.redirect(302, MAIN_SITE + req.originalUrl);
  }
  if (ADMIN_HOST && (req.path === "/admin" || req.path === "/admin/")) {
    return res.redirect(302, `https://${ADMIN_HOST}/`);
  }
  next();
});

app.use(orderingHostMiddleware());

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "../public")));

app.get("/api/health", async (_req, res) => {
  let database: "ok" | "error" = "ok";
  let storeCount = 0;
  try {
    storeCount = await prisma.store.count();
  } catch {
    database = "error";
  }
  res.json({
    ok: database === "ok",
    service: "purepos-api",
    product: process.env.PRODUCT_NAME || "PurePOS",
    legalName: process.env.PRODUCT_LEGAL || "PurePOS UK",
    domain: process.env.PRODUCT_DOMAIN || "purepos.co.uk",
    version: "0.10.114",
    database,
    storeCount,
    time: new Date().toISOString(),
    pricingUrl: "/pricing",
    urls: {
      publicBase:
        process.env.PUBLIC_BASE_URL ||
        process.env.RENDER_EXTERNAL_URL ||
        `http://localhost:${PORT}`,
      stagingBase: process.env.STAGING_BASE_URL || "https://staging.purepos.co.uk",
      production: "https://purepos.co.uk",
      productionNote:
        "Hosted on Railway (PUBLIC_BASE_URL). Live at purepos.co.uk; admin.purepos.co.uk needs the Railway Pro plan plus a DNS CNAME.",
    },
    env: {
      hasJwtSecret: Boolean(process.env.JWT_SECRET),
      hasPlatformAdminSecret: Boolean(process.env.PLATFORM_ADMIN_SECRET?.trim()),
      host: HOST,
      port: PORT,
    },
    adminUrl: ADMIN_HOST ? `https://${ADMIN_HOST}/` : "/admin",
  });
});

app.get(["/pricing", "/pricing/"], (_req, res) => {
  res.redirect(302, "/#pricing");
});

app.get(["/signup", "/signup/"], (_req, res) => {
  res.redirect(302, "/#pricing");
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/admin.html"));
});
app.get("/admin/", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/admin.html"));
});
app.get("/pay/:token", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/pay.html"));
});

/** Hosted all-in-one: static till / BO / ordering / marketing (see Dockerfile.webapp). */
const webRoot = path.join(__dirname, "../web");
function mountSpa(routeBase: string, folder: string) {
  const dir = path.join(webRoot, folder);
  const index = path.join(dir, "index.html");
  app.use(
    routeBase,
    express.static(dir, { index: false }),
    (req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      res.sendFile(index, (err) => (err ? next() : undefined));
    }
  );
}
mountSpa("/pos", "pos");
mountSpa("/bo", "bo");
mountSpa("/order", "order");
app.use(express.static(path.join(webRoot, "marketing")));

const apiRouters = [
  authRouter,
  catalogRouter,
  posRouter,
  shiftsRouter,
  inventoryRouter,
  customersRouter,
  employeesRouter,
  salesRouter,
  reportsRouter,
  settingsRouter,
  giftCardsRouter,
  timeClockRouter,
  publicOrderingRouter,
  publicBillingRouter,
  publicDeliveryRouter,
  publicTextPayRouter,
  billingRouter,
  adminRouter,
  backupRouter,
  kitchenRouter,
  deliveryRouter,
  textPayRouter,
  printersRouter,
  extrasRouter,
  importRouter,
];
for (const r of apiRouters) installAsyncHandlers(r);

app.use("/api/auth", authRouter);
app.use("/api/catalog", catalogRouter);
app.use("/api/pos", posRouter);
app.use("/api/shifts", shiftsRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/customers", customersRouter);
app.use("/api/employees", employeesRouter);
app.use("/api/sales", salesRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/gift-cards", giftCardsRouter);
app.use("/api/time-clock", timeClockRouter);
app.use("/api/public", publicOrderingRouter);
app.use("/api/public", publicBillingRouter);
app.use("/api/public/delivery", publicDeliveryRouter);
app.use("/api/public/pay", publicTextPayRouter);
app.use("/api/billing", billingRouter);
app.use("/api/admin", adminRouter);
app.use("/api/extras", backupRouter);
app.use("/api/kitchen", kitchenRouter);
app.use("/api/delivery", deliveryRouter);
app.use("/api/text-pay", textPayRouter);
app.use("/api/printers", printersRouter);
app.use("/api/extras", extrasRouter);
app.use("/api/import", importRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "ZodError") {
    return res.status(400).json({ error: "Validation error", details: err });
  }
  const message = err instanceof Error ? err.message : "Server error";
  res.status(500).json({ error: message });
});

backfillCompanyKeys()
  .then(() => migrateBillingEntitlements())
  .then(async () => {
    const stores = await prisma.store.findMany({ select: { id: true } });
    for (const store of stores) {
      await syncModifierGroupSortOrders(store.id);
    }
  })
  .catch((err) => console.error("startup backfill failed", err));

app.listen(PORT, HOST, () => {
  console.log(`PurePOS API listening on http://${HOST}:${PORT}`);
  console.log(`Home http://${HOST}:${PORT}/  (plans at /#pricing)`);
});
