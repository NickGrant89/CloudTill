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
import { prisma } from "./db.js";

const app = express();
const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || "0.0.0.0";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(cors());
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
    version: "0.5.1",
    database,
    storeCount,
    time: new Date().toISOString(),
    pricingUrl: "/pricing",
    urls: {
      publicBase: process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`,
      stagingBase: process.env.STAGING_BASE_URL || "https://staging.purepos.co.uk",
      production: "https://purepos.co.uk",
      productionNote: "Hosting currently suspended — use staging or localhost",
    },
    env: {
      hasJwtSecret: Boolean(process.env.JWT_SECRET),
      host: HOST,
      port: PORT,
    },
  });
});

app.get("/pricing", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/pricing.html"));
});

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
app.use("/api/billing", billingRouter);
app.use("/api/kitchen", kitchenRouter);
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

app.listen(PORT, HOST, () => {
  console.log(`PurePOS API listening on http://${HOST}:${PORT}`);
  console.log(`Pricing page http://${HOST}:${PORT}/pricing`);
});
