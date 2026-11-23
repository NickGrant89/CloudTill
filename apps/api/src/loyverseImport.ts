import { prisma } from "./db.js";
import { parseNumber, parsePoundsToCents } from "./csv.js";

export type LoyversePreviewRow = {
  line: number;
  action: "create" | "update" | "skip" | "error";
  summary: string;
  data: Record<string, unknown>;
  issues: { level: "error" | "warning"; message: string }[];
};

const ITEM_NOTES =
  "Loyverse item list. One item is created per Handle. Option columns (size and similar) become choices on that item, priced from the lowest price, and their stock is added together. Modifier columns only say yes or no, so the name is linked and the choices are added afterwards under Modifiers. Tax columns are not copied. Receipts and images are not in this file.";

const CUSTOMER_NOTES =
  "Loyverse customer list. Imports name, email, phone, address, note, visits, spend, and points. Matched by email when one is present.";

type OptionChoice = { name: string; priceCents: number };
type OptionGroup = { name: string; options: OptionChoice[] };

type ItemDraft = {
  line: number;
  sku: string;
  itemName: string;
  barcode: string | null;
  priceCents: number | null;
  priceInvalid: boolean;
  costCents: number;
  trackStock: boolean;
  stockQty: number;
  lowStock: number;
  active: boolean;
  categoryName: string;
  description: string | null;
  soldBy: "each" | "weight";
  modifierFlags: string[];
  options: { name: string; value: string }[];
  components: { sku: string; quantity: number }[];
  taxes: string[];
};

function norm(header: string) {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

function headerMap(headers: string[]) {
  const map = new Map<string, string>();
  for (const header of headers) map.set(norm(header), header);
  return map;
}

function cell(row: Record<string, string>, map: Map<string, string>, name: string) {
  const key = map.get(norm(name));
  return key ? (row[key] ?? "").trim() : "";
}

function yes(raw: string, whenBlank: boolean) {
  const value = raw.trim().toLowerCase();
  if (!value) return whenBlank;
  return value === "y" || value === "yes" || value === "true" || value === "1";
}

function money(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const dotted = /^\d+,\d{1,2}$/.test(trimmed) ? trimmed.replace(",", ".") : trimmed;
  return parsePoundsToCents(dotted);
}

function firstStoreColumn(row: Record<string, string>, base: string) {
  const want = norm(base);
  for (const [key, value] of Object.entries(row)) {
    const name = norm(key);
    if (name.startsWith(`${want} [`) && value.trim()) return value.trim();
  }
  return "";
}

function quotedName(raw: string) {
  return raw.trim().replace(/^"|"$/g, "").trim();
}

export function detectLoyverse(headers: string[]): "items" | "customers" | null {
  const names = headers.map(norm);
  const has = (name: string) => names.includes(name);
  const hasPrefix = (prefix: string) => names.some((name) => name === prefix || name.startsWith(`${prefix} [`));
  if (has("sku") && (has("name") || hasPrefix("price") || has("default price") || has("option 1 name") || has("handle"))) {
    return "items";
  }
  const customerName = has("customer name") || has("name");
  const customerField =
    has("email") ||
    has("phone") ||
    has("phone number") ||
    has("points balance") ||
    has("total points") ||
    has("loyalty points");
  if (customerName && customerField && !has("sku")) return "customers";
  return null;
}

function priceOf(row: Record<string, string>, map: Map<string, string>) {
  return cell(row, map, "Price") || cell(row, map, "Default price") || firstStoreColumn(row, "price");
}

function readOptions(row: Record<string, string>, map: Map<string, string>, carried: string[]) {
  const options: { name: string; value: string }[] = [];
  for (let i = 1; i <= 3; i += 1) {
    const named = cell(row, map, `Option ${i} name`);
    if (named) carried[i - 1] = named;
    const value = cell(row, map, `Option ${i} value`);
    if (!value) continue;
    options.push({ name: named || carried[i - 1] || "", value });
  }
  return options;
}

function columnFlags(row: Record<string, string>, prefix: "modifier" | "tax") {
  const names: string[] = [];
  const pattern = new RegExp(`^${prefix}\\s*-\\s*(.+)$`, "i");
  for (const [key, value] of Object.entries(row)) {
    const match = pattern.exec(key.trim());
    if (match && yes(value, false)) names.push(quotedName(match[1]));
  }
  return names;
}

function buildItems(headers: string[], rows: Record<string, string>[]) {
  const map = headerMap(headers);
  const groups = new Map<string, ItemDraft[]>();
  const carriedOptions = new Map<string, string[]>();
  let anon = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const line = index + 2;
    const handle = cell(row, map, "Handle");
    const sku = cell(row, map, "SKU");
    const componentSku = cell(row, map, "SKU of included item");
    const name = cell(row, map, "Name");
    if (!handle && !sku && !componentSku && !name) continue;

    const key = handle || `row-${++anon}`;
    const list = groups.get(key) ?? [];
    const previous = list[list.length - 1];

    if (componentSku && !sku) {
      const quantity = parseNumber(cell(row, map, "Quantity of included item") || "1") ?? 1;
      if (previous) previous.components.push({ sku: componentSku, quantity });
      else list.push({ ...blankDraft(line), components: [{ sku: componentSku, quantity }] });
      groups.set(key, list);
      continue;
    }

    const priceRaw = priceOf(row, map);
    const parsedPrice = priceRaw ? money(priceRaw) : null;
    const costRaw = cell(row, map, "Cost") || cell(row, map, "Purchase cost");
    const stockRaw = cell(row, map, "In stock") || firstStoreColumn(row, "in stock");
    const lowRaw = cell(row, map, "Low stock") || firstStoreColumn(row, "low stock");
    const optionNames = carriedOptions.get(key) ?? ["", "", ""];
    const flags = columnFlags(row, "modifier");
    const taxes = columnFlags(row, "tax");
    const draft: ItemDraft = {
      line,
      sku,
      itemName: name || previous?.itemName || "",
      barcode: cell(row, map, "Barcode") || null,
      priceCents: parsedPrice,
      priceInvalid: Boolean(priceRaw) && parsedPrice == null,
      costCents: costRaw ? money(costRaw) ?? previous?.costCents ?? 0 : previous?.costCents ?? 0,
      trackStock: yes(cell(row, map, "Track stock") || (previous ? (previous.trackStock ? "Y" : "N") : ""), false),
      stockQty: stockRaw ? parseNumber(stockRaw) ?? 0 : 0,
      lowStock: lowRaw ? parseNumber(lowRaw) ?? previous?.lowStock ?? 5 : previous?.lowStock ?? 5,
      active: yes(
        cell(row, map, "Available for sale") || firstStoreColumn(row, "available for sale"),
        previous ? previous.active : true
      ),
      categoryName: cell(row, map, "Category") || previous?.categoryName || "",
      description: cell(row, map, "Description") || previous?.description || null,
      soldBy: yes(cell(row, map, "Sold by weight"), previous?.soldBy === "weight") ? "weight" : "each",
      modifierFlags: flags.length ? flags : previous?.modifierFlags ?? [],
      options: readOptions(row, map, optionNames),
      components: [],
      taxes: taxes.length ? taxes : previous?.taxes ?? [],
    };
    carriedOptions.set(key, optionNames);
    if (componentSku) {
      draft.components.push({
        sku: componentSku,
        quantity: parseNumber(cell(row, map, "Quantity of included item") || "1") ?? 1,
      });
    }
    list.push(draft);
    groups.set(key, list);
  }
  return groups;
}

function blankDraft(line: number): ItemDraft {
  return {
    line,
    sku: "",
    itemName: "",
    barcode: null,
    priceCents: null,
    priceInvalid: false,
    costCents: 0,
    trackStock: false,
    stockQty: 0,
    lowStock: 5,
    active: true,
    categoryName: "",
    description: null,
    soldBy: "each",
    modifierFlags: [],
    options: [],
    components: [],
    taxes: [],
  };
}

function pickBase(list: ItemDraft[]) {
  const priced = list.filter((row) => row.priceCents != null);
  const pool = priced.length ? priced : list;
  return pool.reduce((best, row) => {
    const price = row.priceCents ?? Number.MAX_SAFE_INTEGER;
    const bestPrice = best.priceCents ?? Number.MAX_SAFE_INTEGER;
    if (price < bestPrice) return row;
    if (price === bestPrice && row.line < best.line) return row;
    return best;
  });
}

function optionLabel(row: ItemDraft) {
  const values = row.options.map((option) => option.value).filter(Boolean);
  return values.join(" · ");
}

function buildChoices(list: ItemDraft[], base: ItemDraft): OptionGroup[] {
  if (list.length < 2 || !list.some((row) => row.options.length > 0)) return [];
  const axes = [...new Set(list.flatMap((row) => row.options.map((option) => option.name).filter(Boolean)))];
  const ordered = [base, ...list.filter((row) => row !== base)];
  if (axes.length <= 1) {
    const byValue = new Map<string, OptionChoice>();
    for (const row of ordered) {
      const name = row.options[0]?.value || "Regular";
      const key = name.toLowerCase();
      if (byValue.has(key)) continue;
      byValue.set(key, { name, priceCents: (row.priceCents ?? base.priceCents ?? 0) - (base.priceCents ?? 0) });
    }
    return [{ name: axes[0] || "Option", options: [...byValue.values()] }];
  }
  return [
    {
      name: axes.join(" · "),
      options: ordered.map((row) => ({
        name: optionLabel(row) || "Regular",
        priceCents: (row.priceCents ?? base.priceCents ?? 0) - (base.priceCents ?? 0),
      })),
    },
  ];
}

function pounds(cents: number) {
  const sign = cents < 0 ? "-" : "";
  return `${sign}£${(Math.abs(cents) / 100).toFixed(2)}`;
}

export async function previewLoyverseItems(
  storeId: string,
  headers: string[],
  rows: Record<string, string>[]
): Promise<LoyversePreviewRow[]> {
  const existing = await prisma.variant.findMany({
    where: { item: { storeId } },
    include: { item: true },
  });
  const bySku = new Map(existing.map((variant) => [variant.sku.toLowerCase(), variant]));
  const seen = new Set<string>();
  const fileSkus = new Set<string>();
  const groups = buildItems(headers, rows);
  for (const list of groups.values()) {
    for (const row of list) if (row.sku) fileSkus.add(row.sku.toLowerCase());
  }

  const preview: LoyversePreviewRow[] = [];
  for (const [itemKey, list] of groups) {
    const itemName = list.find((row) => row.itemName)?.itemName || "";
    const base = pickBase(list);
    const choices = buildChoices(list, base);
    const components = list.flatMap((row) => row.components);
    const matchedIds = [
      ...new Set(
        list
          .map((row) => (row.sku ? bySku.get(row.sku.toLowerCase())?.itemId : undefined))
          .filter((id): id is string => Boolean(id))
      ),
    ];
    const baseMatch = base.sku ? bySku.get(base.sku.toLowerCase()) : undefined;
    const matchedVariant =
      baseMatch ?? list.map((row) => (row.sku ? bySku.get(row.sku.toLowerCase()) : undefined)).find(Boolean);
    const itemId = matchedIds.length === 1 ? matchedIds[0] : null;

    for (const row of list) {
      const issues: LoyversePreviewRow["issues"] = [];
      if (!itemName) issues.push({ level: "error", message: "Name is required" });
      if (!row.sku) issues.push({ level: "error", message: "SKU is required" });
      if (row.sku && seen.has(row.sku.toLowerCase())) {
        issues.push({ level: "error", message: `Duplicate SKU in the file: ${row.sku}` });
      }
      if (row.sku) seen.add(row.sku.toLowerCase());
      if (row.priceInvalid) issues.push({ level: "error", message: "Price is not a number" });
      else if (row.priceCents == null) {
        issues.push({ level: "warning", message: "No price in the file, so this uses the item price" });
      }
      if (matchedIds.length > 1) issues.push({ level: "error", message: "These SKUs already belong to different items" });
      for (const component of row.components) {
        if (!fileSkus.has(component.sku.toLowerCase()) && !bySku.has(component.sku.toLowerCase())) {
          issues.push({
            level: "warning",
            message: `Component SKU ${component.sku} is not in this file or the catalogue, so it will not be linked`,
          });
        }
      }

      const isBase = row === base;
      if (isBase && row.modifierFlags.length) {
        issues.push({
          level: "warning",
          message: `${row.modifierFlags.map((name) => `“${name}”`).join(", ")} will be linked. Loyverse does not include the choices or their prices.`,
        });
      }
      if (isBase && row.taxes.length) {
        issues.push({
          level: "warning",
          message: `${row.taxes.join(", ")} is not copied. This store keeps its own VAT.`,
        });
      }
      if (!isBase) {
        const extra = (row.priceCents ?? base.priceCents ?? 0) - (base.priceCents ?? 0);
        const label = optionLabel(row) || row.sku;
        issues.push({
          level: "warning",
          message: `${label} is a choice on ${itemName || "this item"} (${extra >= 0 ? "+" : ""}${pounds(extra)}). Its stock is added to SKU ${base.sku}.`,
        });
        if (row.barcode) {
          issues.push({ level: "warning", message: `Barcode ${row.barcode} is not scanned on its own.` });
        }
      } else if (matchedVariant) {
        issues.push({ level: "warning", message: `Will update “${matchedVariant.item.name}”` });
      }

      const blocked = issues.some((issue) => issue.level === "error");
      const action: LoyversePreviewRow["action"] = blocked ? "error" : matchedVariant ? "update" : "create";
      const extra = (row.priceCents ?? base.priceCents ?? 0) - (base.priceCents ?? 0);
      const summary = !itemName
        ? row.sku || "(unnamed)"
        : isBase
          ? `${action} ${itemName} (${row.sku || "no SKU"}) @ ${pounds(row.priceCents ?? 0)}`
          : `${itemName} — ${optionLabel(row) || row.sku} · ${extra >= 0 ? "+" : ""}${pounds(extra)}`;

      preview.push({
        line: row.line,
        action,
        summary,
        data: isBase
          ? {
              role: "base",
              itemKey,
              itemName,
              sku: matchedVariant?.sku ?? row.sku,
              barcode: row.barcode,
              priceCents: row.priceCents ?? 0,
              costCents: row.costCents,
              trackStock: list.some((entry) => entry.trackStock),
              stockQty: list.reduce((sum, entry) => sum + (entry.trackStock ? entry.stockQty : 0), 0),
              lowStock: row.lowStock,
              active: list.some((entry) => entry.active),
              categoryName: row.categoryName || null,
              description: row.description,
              soldBy: row.soldBy,
              modifierFlags: row.modifierFlags,
              optionGroups: choices,
              components,
              isComposite: components.length > 0,
              itemId,
              variantId: matchedVariant?.id ?? null,
            }
          : { role: "option", itemKey },
        issues,
      });
    }
  }
  return preview;
}

function customerCell(row: Record<string, string>, map: Map<string, string>, names: string[]) {
  for (const name of names) {
    const value = cell(row, map, name);
    if (value) return value;
  }
  return "";
}

export async function previewLoyverseCustomers(
  storeId: string,
  headers: string[],
  rows: Record<string, string>[]
): Promise<LoyversePreviewRow[]> {
  const map = headerMap(headers);
  const existing = await prisma.customer.findMany({ where: { storeId } });
  const byEmail = new Map(
    existing.filter((customer) => customer.email).map((customer) => [customer.email!.toLowerCase(), customer])
  );
  const seen = new Set<string>();

  return rows.flatMap((row, index) => {
    const line = index + 2;
    const name = customerCell(row, map, ["Customer name", "Name"]);
    const email = customerCell(row, map, ["Email"]) || null;
    const phone = customerCell(row, map, ["Phone", "Phone number"]) || null;
    const code = customerCell(row, map, ["Customer code"]);
    const noteText = customerCell(row, map, ["Note", "Notes"]);
    const address = [
      customerCell(row, map, ["Address"]),
      customerCell(row, map, ["City"]),
      customerCell(row, map, ["Region", "State"]),
      customerCell(row, map, ["Postal code", "Zip", "Postcode"]),
      customerCell(row, map, ["Country", "Country code"]),
    ]
      .filter(Boolean)
      .join(", ");
    if (!name && !email && !phone) return [];
    const issues: LoyversePreviewRow["issues"] = [];
    if (!name) issues.push({ level: "error", message: "Customer name is required" });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) issues.push({ level: "error", message: "Email is invalid" });
    if (email && seen.has(email.toLowerCase())) {
      issues.push({ level: "error", message: `Duplicate email in the file: ${email}` });
    }
    if (email) seen.add(email.toLowerCase());
    const pointsRaw = customerCell(row, map, ["Points balance", "Total points", "Loyalty points", "Points"]);
    const visitsRaw = customerCell(row, map, ["Total visits", "Visits"]);
    const spentRaw = customerCell(row, map, ["Total spent"]);
    const points = pointsRaw ? parseNumber(pointsRaw) : 0;
    const visits = visitsRaw ? parseNumber(visitsRaw) : 0;
    const spent = spentRaw ? money(spentRaw) : 0;
    if (pointsRaw && points == null) issues.push({ level: "error", message: "Points must be a number" });
    if (visitsRaw && visits == null) issues.push({ level: "error", message: "Total visits must be a number" });
    if (spentRaw && spent == null) issues.push({ level: "error", message: "Total spent must be a number" });
    const match = email ? byEmail.get(email.toLowerCase()) : undefined;
    const action: LoyversePreviewRow["action"] = issues.some((issue) => issue.level === "error")
      ? "error"
      : match
        ? "update"
        : "create";
    const note = [noteText, code ? `Customer code ${code}` : "", address ? `Address: ${address}` : ""]
      .filter(Boolean)
      .join(" · ") || null;
    return [
      {
        line,
        action,
        summary: action === "error" ? name || "(unnamed)" : `${action} ${name}${email ? ` · ${email}` : ""}`,
        data: {
          name,
          email,
          phone,
          note,
          loyaltyPoints: Math.round(points ?? 0),
          visitCount: Math.round(visits ?? 0),
          totalSpentCents: spent ?? 0,
          customerId: match?.id ?? null,
        },
        issues,
      },
    ];
  });
}

export function loyverseNotes(kind: "items" | "customers") {
  return kind === "items" ? ITEM_NOTES : CUSTOMER_NOTES;
}

type BaseItem = {
  role: "base";
  itemName: string;
  sku: string;
  barcode: string | null;
  priceCents: number;
  costCents: number;
  trackStock: boolean;
  stockQty: number;
  lowStock: number;
  active: boolean;
  categoryName: string | null;
  description: string | null;
  soldBy: string;
  modifierFlags: string[];
  optionGroups: OptionGroup[];
  components: { sku: string; quantity: number }[];
  isComposite: boolean;
  itemId: string | null;
  variantId: string | null;
};

type CustomerData = {
  name: string;
  email: string | null;
  phone: string | null;
  note: string | null;
  loyaltyPoints: number;
  visitCount: number;
  totalSpentCents: number;
  customerId: string | null;
};

export async function applyLoyverse(storeId: string, rows: LoyversePreviewRow[], detected: "items" | "customers") {
  if (detected === "customers") return applyCustomers(storeId, rows);
  return applyItems(storeId, rows);
}

async function applyCustomers(storeId: string, rows: LoyversePreviewRow[]) {
  let created = 0;
  let updated = 0;
  for (const row of rows) {
    if (row.action === "error" || row.action === "skip") continue;
    const data = row.data as CustomerData;
    if (row.action === "create") {
      await prisma.customer.create({
        data: {
          storeId,
          name: data.name,
          email: data.email,
          phone: data.phone,
          note: data.note,
          loyaltyPoints: data.loyaltyPoints,
          visitCount: data.visitCount,
          totalSpentCents: data.totalSpentCents,
        },
      });
      created += 1;
    } else if (data.customerId) {
      await prisma.customer.update({
        where: { id: data.customerId },
        data: {
          name: data.name,
          email: data.email,
          phone: data.phone,
          note: data.note,
          loyaltyPoints: data.loyaltyPoints,
          visitCount: data.visitCount,
          totalSpentCents: data.totalSpentCents,
        },
      });
      updated += 1;
    }
  }
  return { created, updated, categoriesCreated: 0, modifiersLinked: 0, componentsLinked: 0 };
}

async function applyItems(storeId: string, rows: LoyversePreviewRow[]) {
  let created = 0;
  let updated = 0;
  let categoriesCreated = 0;
  let modifiersLinked = 0;
  let componentsLinked = 0;
  const categories = new Map(
    (await prisma.category.findMany({ where: { storeId } })).map((category) => [category.name.toLowerCase(), category.id])
  );
  const bases = rows.filter((row) => row.action !== "error" && row.action !== "skip" && row.data.role === "base");
  const pendingComponents: { itemId: string; components: BaseItem["components"] }[] = [];

  for (const row of bases) {
    const data = row.data as BaseItem;
    let categoryId: string | null = null;
    if (data.categoryName) {
      const found = categories.get(data.categoryName.toLowerCase());
      if (found) categoryId = found;
      else {
        const category = await prisma.category.create({
          data: { storeId, name: data.categoryName, color: "#2F6F4E" },
        });
        categoryId = category.id;
        categories.set(data.categoryName.toLowerCase(), category.id);
        categoriesCreated += 1;
      }
    }

    let itemId = data.itemId;
    if (!itemId) {
      const item = await prisma.item.create({
        data: {
          storeId,
          name: data.itemName,
          categoryId,
          description: data.description,
          soldBy: data.soldBy,
          isComposite: data.isComposite,
          active: data.active,
        },
      });
      itemId = item.id;
      created += 1;
    } else {
      await prisma.item.update({
        where: { id: itemId },
        data: {
          name: data.itemName,
          categoryId,
          description: data.description,
          soldBy: data.soldBy,
          isComposite: data.isComposite,
          active: data.active,
        },
      });
      updated += 1;
    }

    let variantId = data.variantId;
    if (!variantId) {
      const variant = await prisma.variant.create({
        data: {
          itemId,
          name: "Regular",
          sku: data.sku,
          barcode: data.barcode,
          priceCents: data.priceCents,
          costCents: data.costCents,
          trackStock: data.trackStock,
          active: true,
        },
      });
      variantId = variant.id;
      await prisma.inventoryLevel.create({
        data: { storeId, variantId, quantity: data.stockQty, lowStock: data.lowStock },
      });
    } else {
      await prisma.variant.update({
        where: { id: variantId },
        data: {
          sku: data.sku,
          barcode: data.barcode,
          priceCents: data.priceCents,
          costCents: data.costCents,
          trackStock: data.trackStock,
          active: true,
        },
      });
      await prisma.inventoryLevel.upsert({
        where: { storeId_variantId: { storeId, variantId } },
        create: { storeId, variantId, quantity: data.stockQty, lowStock: data.lowStock },
        update: { quantity: data.stockQty, lowStock: data.lowStock },
      });
    }

    const groups = await prisma.modifierGroup.findMany({
      where: { itemId },
      include: { modifiers: true },
    });
    const byName = new Map(groups.map((group) => [group.name.toLowerCase(), group]));

    for (const flag of data.modifierFlags) {
      if (byName.has(flag.toLowerCase())) continue;
      const createdGroup = await prisma.modifierGroup.create({
        data: { itemId, name: flag, minSelect: 0, maxSelect: 1 },
        include: { modifiers: true },
      });
      byName.set(flag.toLowerCase(), createdGroup);
      modifiersLinked += 1;
    }

    for (const group of data.optionGroups) {
      let existing = byName.get(group.name.toLowerCase());
      if (!existing) {
        existing = await prisma.modifierGroup.create({
          data: {
            itemId,
            name: group.name,
            minSelect: 1,
            maxSelect: 1,
            modifiers: { create: group.options },
          },
          include: { modifiers: true },
        });
        byName.set(group.name.toLowerCase(), existing);
        modifiersLinked += group.options.length;
        continue;
      }
      for (const option of group.options) {
        const found = existing.modifiers.find((modifier) => modifier.name.toLowerCase() === option.name.toLowerCase());
        if (found) {
          if (found.priceCents !== option.priceCents) {
            await prisma.modifier.update({ where: { id: found.id }, data: { priceCents: option.priceCents } });
          }
        } else {
          await prisma.modifier.create({
            data: { groupId: existing.id, name: option.name, priceCents: option.priceCents },
          });
          modifiersLinked += 1;
        }
      }
    }

    if (data.components.length) pendingComponents.push({ itemId, components: data.components });
  }

  const variants = await prisma.variant.findMany({
    where: { item: { storeId } },
    select: { id: true, sku: true },
  });
  const variantBySku = new Map(variants.map((variant) => [variant.sku.toLowerCase(), variant.id]));
  for (const pending of pendingComponents) {
    for (const component of pending.components) {
      const variantId = variantBySku.get(component.sku.toLowerCase());
      if (!variantId) continue;
      const already = await prisma.kitComponent.findFirst({
        where: { parentItemId: pending.itemId, componentVarId: variantId },
      });
      if (already) continue;
      await prisma.kitComponent.create({
        data: { parentItemId: pending.itemId, componentVarId: variantId, quantity: component.quantity },
      });
      componentsLinked += 1;
    }
  }

  return { created, updated, categoriesCreated, modifiersLinked, componentsLinked };
}
