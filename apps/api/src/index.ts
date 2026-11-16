import express from "express";
import cors from "cors";
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

const app = express();
const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || "0.0.0.0";

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "cloudtill-api", version: "0.1.0" });
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

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "ZodError") {
    return res.status(400).json({ error: "Validation error", details: err });
  }
  const message = err instanceof Error ? err.message : "Server error";
  res.status(500).json({ error: message });
});

app.listen(PORT, HOST, () => {
  console.log(`CloudTill API listening on http://${HOST}:${PORT}`);
});
