import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole, type AuthedRequest } from "../auth.js";
import { csvEscape, parseBool, parseCsv, parseNumber, parsePoundsToCents } from "../csv.js";
import { storeAllowsFeature } from "./billing.js";

export const importRouter = Router();
importRouter.use(requireAuth);
importRouter.use(requireRole("owner", "manager"));
importRouter.use(async (req: AuthedRequest, res, next) => {
  const allowed = await storeAllowsFeature(req.user!.storeId, "csv_import");
  if (!allowed) {
    return res.status(402).json({
      error: "CSV import requires Pro or Multi-store. Upgrade under Settings → Billing.",
      feature: "csv_import",
    });
  }
  next();
});

export type ImportKind = "items" | "customers" | "stock";

const KINDS: ImportKind[] = ["items", "customers", "stock"];

const TEMPLATES: Record<
  ImportKind,
  { filename: string; headers: string[]; sample: string[][]; notes: string }
> = {
  items: {
    filename: "purepos-items-template.csv",
    headers: [
      "name",
      "category",
      "sku",
      "barcode",
      "price",
      "cost",
      "trackStock",
      "stockQty",
      "lowStock",
      "description",
      "soldBy",
      "color",
    ],
    sample: [
      ["House Latte", "Coffee", "COF-HOUSE", "2002002001", "4.25", "1.10", "true", "40", "8", "12oz latte", "each", "#3D5A4C"],
      ["Oat Cookie", "Pastries", "PAS-OAT", "", "2.95", "0.70", "true", "24", "5", "", "each", "#8B5E3C"],
    ],
    notes: "price/cost in pounds (e.g. 4.25). Matching key: sku (create or update).",
  },
  customers: {
    filename: "purepos-customers-template.csv",
    headers: ["name", "email", "phone", "note", "storeCredit", "loyaltyPoints"],
    sample: [
      ["Alex Patron", "alex@example.com", "+44 7700 900123", "Regular", "5.00", "120"],
      ["Sam Walk-in", "", "+44 7700 900456", "", "0", "0"],
    ],
    notes: "storeCredit in pounds. Matching key: email when present, otherwise always create.",
  },
  stock: {
    filename: "purepos-stock-template.csv",
    headers: ["sku", "barcode", "quantity", "lowStock", "mode", "note"],
    sample: [
      ["COF-AMER", "", "50", "8", "set", "Weekly count"],
      ["", "1001001002", "12", "", "receive", "Supplier delivery"],
    ],
    notes: "Match by sku or barcode. mode=set replaces on-hand qty; mode=receive adds to it.",
  },
};

type RowIssue = { level: "error" | "warning"; message: string };
type PreviewRow = {
  line: number;
  action: "create" | "update" | "skip" | "error";
  summary: string;
  data: Record<string, unknown>;
  issues: RowIssue[];
};

importRouter.get("/kinds", (_req, res) => {
  res.json(
    KINDS.map((kind) => ({
      kind,
      ...TEMPLATES[kind],
      templatePath: `/api/import/templates/${kind}.csv`,
    }))
  );
});

importRouter.get("/templates/:kind.csv", (req, res) => {
  const kind = String(req.params.kind).replace(/\.csv$/i, "") as ImportKind;
  if (!KINDS.includes(kind)) return res.status(404).json({ error: "Unknown import kind" });
  const tpl = TEMPLATES[kind];
  const lines = [
    tpl.headers.join(","),
    ...tpl.sample.map((row) => row.map((cell) => csvEscape(cell)).join(",")),
  ];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${tpl.filename}"`);
  res.send(lines.join("\n") + "\n");
});

const importBody = z.object({
  kind: z.enum(["items", "customers", "stock"]),
  csv: z.string().min(1),
});

importRouter.post("/preview", async (req: AuthedRequest, res) => {
  const parsedBody = importBody.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: "kind and csv are required" });
  }
  const body = parsedBody.data;

  const parsed = parseCsv(body.csv);
  if (!parsed.headers.length) return res.status(400).json({ error: "CSV is empty" });

  const missing = requiredHeaders(body.kind).filter((h) => !parsed.headers.includes(h));
  if (missing.length) {
    return res.status(400).json({
      error: `Missing required columns: ${missing.join(", ")}`,
      headers: parsed.headers,
      required: requiredHeaders(body.kind),
    });
  }

  const preview =
    body.kind === "items"
      ? await previewItems(req.user!.storeId, parsed.rows)
      : body.kind === "customers"
        ? await previewCustomers(req.user!.storeId, parsed.rows)
        : await previewStock(req.user!.storeId, parsed.rows);

  res.json({
    kind: body.kind,
    headers: parsed.headers,
    notes: TEMPLATES[body.kind].notes,
    total: preview.length,
    valid: preview.filter((r) => r.action !== "error").length,
    errors: preview.filter((r) => r.action === "error").length,
    rows: preview,
  });
});

importRouter.post("/apply", async (req: AuthedRequest, res) => {
  const parsedBody = importBody.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: "kind and csv are required" });
  }
  const body = parsedBody.data;

  const parsed = parseCsv(body.csv);
  const missing = requiredHeaders(body.kind).filter((h) => !parsed.headers.includes(h));
  if (missing.length) {
    return res.status(400).json({ error: `Missing required columns: ${missing.join(", ")}` });
  }

  const preview =
    body.kind === "items"
      ? await previewItems(req.user!.storeId, parsed.rows)
      : body.kind === "customers"
        ? await previewCustomers(req.user!.storeId, parsed.rows)
        : await previewStock(req.user!.storeId, parsed.rows);

  const blockers = preview.filter((r) => r.action === "error");
  if (blockers.length) {
    return res.status(400).json({
      error: `Fix ${blockers.length} row error(s) before importing`,
      errors: blockers.length,
      rows: blockers.slice(0, 25),
    });
  }

  const result =
    body.kind === "items"
      ? await applyItems(req.user!.storeId, preview)
      : body.kind === "customers"
        ? await applyCustomers(req.user!.storeId, preview)
        : await applyStock(req.user!.storeId, req.user!.sub, preview);

  res.json({ kind: body.kind, ...result });
});

function requiredHeaders(kind: ImportKind): string[] {
  if (kind === "items") return ["name", "sku", "price"];
  if (kind === "customers") return ["name"];
  return []; // stock needs sku or barcode per row
}

async function previewItems(storeId: string, rows: Record<string, string>[]): Promise<PreviewRow[]> {
  const existing = await prisma.variant.findMany({
    where: { item: { storeId } },
    include: { item: true },
  });
  const bySku = new Map(existing.map((v) => [v.sku.toLowerCase(), v]));
  const categories = await prisma.category.findMany({ where: { storeId } });
  const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const seenSku = new Set<string>();

  return rows.map((row, index) => {
    const line = index + 2;
    const issues: RowIssue[] = [];
    const name = row.name?.trim() ?? "";
    const sku = row.sku?.trim() ?? "";
    const priceCents = parsePoundsToCents(row.price ?? "");
    const costCents = row.cost ? parsePoundsToCents(row.cost) : 0;
    const stockQty = row.stockQty ? parseNumber(row.stockQty) : 0;
    const lowStock = row.lowStock ? parseNumber(row.lowStock) : 5;
    const soldBy = (row.soldBy || "each").toLowerCase();
    const trackStock = parseBool(row.trackStock ?? "true", true);

    if (!name) issues.push({ level: "error", message: "name is required" });
    if (!sku) issues.push({ level: "error", message: "sku is required" });
    if (priceCents == null) issues.push({ level: "error", message: "price must be a number in pounds (e.g. 3.50)" });
    if (row.cost && costCents == null) issues.push({ level: "error", message: "cost must be a number in pounds" });
    if (row.stockQty && stockQty == null) issues.push({ level: "error", message: "stockQty must be a number" });
    if (row.lowStock && lowStock == null) issues.push({ level: "error", message: "lowStock must be a number" });
    if (soldBy && !["each", "weight"].includes(soldBy)) {
      issues.push({ level: "error", message: "soldBy must be each or weight" });
    }
    const skuKey = sku.toLowerCase();
    if (sku && seenSku.has(skuKey)) issues.push({ level: "error", message: `Duplicate sku in file: ${sku}` });
    if (sku) seenSku.add(skuKey);

    let categoryId: string | null = null;
    let categoryAction: "existing" | "create" | "none" = "none";
    const categoryName = row.category?.trim() ?? "";
    if (categoryName) {
      const found = catByName.get(categoryName.toLowerCase());
      if (found) {
        categoryId = found.id;
        categoryAction = "existing";
      } else {
        categoryAction = "create";
      }
    }

    const match = sku ? bySku.get(skuKey) : undefined;
    const action: PreviewRow["action"] = issues.some((i) => i.level === "error")
      ? "error"
      : match
        ? "update"
        : "create";

    if (action === "update") {
      issues.push({ level: "warning", message: `Will update existing item “${match!.item.name}”` });
    }
    if (categoryAction === "create") {
      issues.push({ level: "warning", message: `Will create category “${categoryName}”` });
    }

    return {
      line,
      action,
      summary:
        action === "error"
          ? `${name || "(unnamed)"} · ${sku || "no sku"}`
          : `${action} ${name} (${sku}) @ £${((priceCents ?? 0) / 100).toFixed(2)}`,
      data: {
        name,
        sku,
        barcode: row.barcode?.trim() || null,
        priceCents: priceCents ?? 0,
        costCents: costCents ?? 0,
        trackStock,
        stockQty: stockQty ?? 0,
        lowStock: lowStock ?? 5,
        description: row.description?.trim() || null,
        soldBy: soldBy === "weight" ? "weight" : "each",
        color: row.color?.trim() || "#3D5A4C",
        categoryName: categoryName || null,
        categoryId,
        categoryAction,
        itemId: match?.itemId ?? null,
        variantId: match?.id ?? null,
      },
      issues,
    };
  });
}

async function previewCustomers(storeId: string, rows: Record<string, string>[]): Promise<PreviewRow[]> {
  const existing = await prisma.customer.findMany({ where: { storeId } });
  const byEmail = new Map(
    existing.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c])
  );
  const seenEmail = new Set<string>();

  return rows.map((row, index) => {
    const line = index + 2;
    const issues: RowIssue[] = [];
    const name = row.name?.trim() ?? "";
    const email = row.email?.trim() || null;
    const phone = row.phone?.trim() || null;
    const note = row.note?.trim() || null;
    const storeCreditCents = row.storeCredit ? parsePoundsToCents(row.storeCredit) : 0;
    const loyaltyPoints = row.loyaltyPoints ? parseNumber(row.loyaltyPoints) : 0;

    if (!name) issues.push({ level: "error", message: "name is required" });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      issues.push({ level: "error", message: "email is invalid" });
    }
    if (row.storeCredit && storeCreditCents == null) {
      issues.push({ level: "error", message: "storeCredit must be pounds (e.g. 5.00)" });
    }
    if (row.loyaltyPoints && loyaltyPoints == null) {
      issues.push({ level: "error", message: "loyaltyPoints must be a number" });
    }
    if (email) {
      const key = email.toLowerCase();
      if (seenEmail.has(key)) issues.push({ level: "error", message: `Duplicate email in file: ${email}` });
      seenEmail.add(key);
    }

    const match = email ? byEmail.get(email.toLowerCase()) : undefined;
    const action: PreviewRow["action"] = issues.some((i) => i.level === "error")
      ? "error"
      : match
        ? "update"
        : "create";
    if (action === "update") {
      issues.push({ level: "warning", message: `Will update existing customer “${match!.name}”` });
    }

    return {
      line,
      action,
      summary:
        action === "error"
          ? `${name || "(unnamed)"}`
          : `${action} ${name}${email ? ` · ${email}` : ""}`,
      data: {
        name,
        email,
        phone,
        note,
        storeCreditCents: storeCreditCents ?? 0,
        loyaltyPoints: Math.round(loyaltyPoints ?? 0),
        customerId: match?.id ?? null,
      },
      issues,
    };
  });
}

async function previewStock(storeId: string, rows: Record<string, string>[]): Promise<PreviewRow[]> {
  const variants = await prisma.variant.findMany({
    where: { item: { storeId }, active: true },
    include: { item: true, inventoryLevels: { where: { storeId } } },
  });
  const bySku = new Map(variants.map((v) => [v.sku.toLowerCase(), v]));
  const byBarcode = new Map(
    variants.filter((v) => v.barcode).map((v) => [v.barcode!.toLowerCase(), v])
  );

  return rows.map((row, index) => {
    const line = index + 2;
    const issues: RowIssue[] = [];
    const sku = row.sku?.trim() ?? "";
    const barcode = row.barcode?.trim() ?? "";
    const quantity = parseNumber(row.quantity ?? "");
    const lowStock = row.lowStock ? parseNumber(row.lowStock) : null;
    const mode = (row.mode || "set").trim().toLowerCase();
    const note = row.note?.trim() || "CSV stock import";

    if (!sku && !barcode) issues.push({ level: "error", message: "sku or barcode is required" });
    if (quantity == null) issues.push({ level: "error", message: "quantity must be a number" });
    if (row.lowStock && lowStock == null) issues.push({ level: "error", message: "lowStock must be a number" });
    if (!["set", "receive"].includes(mode)) {
      issues.push({ level: "error", message: "mode must be set or receive" });
    }

    const match =
      (sku && bySku.get(sku.toLowerCase())) ||
      (barcode && byBarcode.get(barcode.toLowerCase())) ||
      undefined;
    if (!match && (sku || barcode)) {
      issues.push({ level: "error", message: `No catalog variant for ${sku || barcode}` });
    }
    if (match && !match.trackStock) {
      issues.push({ level: "warning", message: "Variant does not track stock; level will still be written" });
    }

    const current = match?.inventoryLevels[0]?.quantity ?? 0;
    const action: PreviewRow["action"] = issues.some((i) => i.level === "error") ? "error" : "update";
    const nextQty = match
      ? mode === "receive"
        ? current + (quantity ?? 0)
        : (quantity ?? 0)
      : quantity ?? 0;

    return {
      line,
      action,
      summary:
        action === "error"
          ? `${sku || barcode || "unknown"}`
          : `${mode} ${match!.item.name} (${match!.sku}) → ${nextQty}`,
      data: {
        variantId: match?.id ?? null,
        itemName: match?.item.name ?? null,
        sku: match?.sku ?? sku,
        barcode: match?.barcode ?? (barcode || null),
        mode,
        quantity: quantity ?? 0,
        lowStock,
        note,
        currentQty: current,
        nextQty,
      },
      issues,
    };
  });
}

async function applyItems(storeId: string, rows: PreviewRow[]) {
  let created = 0;
  let updated = 0;
  let categoriesCreated = 0;

  for (const row of rows) {
    if (row.action === "skip" || row.action === "error") continue;
    const d = row.data as {
      name: string;
      sku: string;
      barcode: string | null;
      priceCents: number;
      costCents: number;
      trackStock: boolean;
      stockQty: number;
      lowStock: number;
      description: string | null;
      soldBy: string;
      color: string;
      categoryName: string | null;
      categoryId: string | null;
      categoryAction: "existing" | "create" | "none";
      itemId: string | null;
      variantId: string | null;
    };

    let categoryId = d.categoryId;
    if (d.categoryAction === "create" && d.categoryName) {
      const cat = await prisma.category.create({
        data: { storeId, name: d.categoryName, color: "#2F6F4E" },
      });
      categoryId = cat.id;
      categoriesCreated += 1;
    }

    if (row.action === "create") {
      const item = await prisma.item.create({
        data: {
          storeId,
          name: d.name,
          categoryId,
          color: d.color,
          description: d.description,
          soldBy: d.soldBy,
          variants: {
            create: {
              name: "Regular",
              sku: d.sku,
              barcode: d.barcode,
              priceCents: d.priceCents,
              costCents: d.costCents,
              trackStock: d.trackStock,
            },
          },
        },
        include: { variants: true },
      });
      await prisma.inventoryLevel.create({
        data: {
          storeId,
          variantId: item.variants[0].id,
          quantity: d.stockQty,
          lowStock: d.lowStock,
        },
      });
      created += 1;
    } else if (d.itemId && d.variantId) {
      await prisma.item.update({
        where: { id: d.itemId },
        data: {
          name: d.name,
          categoryId,
          color: d.color,
          description: d.description,
          soldBy: d.soldBy,
        },
      });
      await prisma.variant.update({
        where: { id: d.variantId },
        data: {
          sku: d.sku,
          barcode: d.barcode,
          priceCents: d.priceCents,
          costCents: d.costCents,
          trackStock: d.trackStock,
        },
      });
      const level = await prisma.inventoryLevel.findUnique({
        where: { storeId_variantId: { storeId, variantId: d.variantId } },
      });
      if (level) {
        await prisma.inventoryLevel.update({
          where: { id: level.id },
          data: { quantity: d.stockQty, lowStock: d.lowStock },
        });
      } else {
        await prisma.inventoryLevel.create({
          data: {
            storeId,
            variantId: d.variantId,
            quantity: d.stockQty,
            lowStock: d.lowStock,
          },
        });
      }
      updated += 1;
    }
  }

  return { created, updated, categoriesCreated, skipped: rows.filter((r) => r.action === "skip").length };
}

async function applyCustomers(storeId: string, rows: PreviewRow[]) {
  let created = 0;
  let updated = 0;
  for (const row of rows) {
    if (row.action === "skip" || row.action === "error") continue;
    const d = row.data as {
      name: string;
      email: string | null;
      phone: string | null;
      note: string | null;
      storeCreditCents: number;
      loyaltyPoints: number;
      customerId: string | null;
    };
    if (row.action === "create") {
      await prisma.customer.create({
        data: {
          storeId,
          name: d.name,
          email: d.email,
          phone: d.phone,
          note: d.note,
          storeCreditCents: d.storeCreditCents,
          loyaltyPoints: d.loyaltyPoints,
        },
      });
      created += 1;
    } else if (d.customerId) {
      await prisma.customer.update({
        where: { id: d.customerId },
        data: {
          name: d.name,
          email: d.email,
          phone: d.phone,
          note: d.note,
          storeCreditCents: d.storeCreditCents,
          loyaltyPoints: d.loyaltyPoints,
        },
      });
      updated += 1;
    }
  }
  return { created, updated, skipped: rows.filter((r) => r.action === "skip").length };
}

async function applyStock(storeId: string, employeeId: string, rows: PreviewRow[]) {
  let updated = 0;
  for (const row of rows) {
    if (row.action !== "update") continue;
    const d = row.data as {
      variantId: string;
      mode: "set" | "receive";
      quantity: number;
      lowStock: number | null;
      note: string;
      nextQty: number;
    };
    const level = await prisma.inventoryLevel.findUnique({
      where: { storeId_variantId: { storeId, variantId: d.variantId } },
    });
    const previous = level?.quantity ?? 0;
    if (level) {
      await prisma.inventoryLevel.update({
        where: { id: level.id },
        data: {
          quantity: d.nextQty,
          ...(d.lowStock != null ? { lowStock: d.lowStock } : {}),
        },
      });
    } else {
      await prisma.inventoryLevel.create({
        data: {
          storeId,
          variantId: d.variantId,
          quantity: d.nextQty,
          lowStock: d.lowStock ?? 5,
        },
      });
    }
    await prisma.inventoryMovement.create({
      data: {
        storeId,
        variantId: d.variantId,
        type: d.mode === "receive" ? "receive" : "adjust",
        quantity: d.mode === "receive" ? d.quantity : d.nextQty - previous,
        note: d.note,
        employeeId,
      },
    });
    updated += 1;
  }
  return { updated, skipped: rows.filter((r) => r.action === "skip").length };
}
