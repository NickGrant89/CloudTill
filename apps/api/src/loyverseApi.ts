const API_ROOT = "https://api.loyverse.com/v1.0";
const PAGE_LIMIT = 250;
const MAX_PAGES = 40;

export class LoyverseApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type LoyverseStore = { id?: string; name?: string };
export type LoyverseCategory = { id?: string; name?: string; deleted_at?: string | null };
export type LoyverseModifierOption = {
  name?: string;
  price?: number | null;
  position?: number | null;
  deleted_at?: string | null;
};
export type LoyverseModifier = {
  id?: string;
  name?: string;
  deleted_at?: string | null;
  modifier_options?: LoyverseModifierOption[];
};
export type LoyverseVariantStore = {
  store_id?: string;
  pricing_type?: string;
  price?: number | null;
  available_for_sale?: boolean;
  low_stock?: number | null;
};
export type LoyverseVariant = {
  variant_id?: string;
  sku?: string | null;
  option1_value?: string | null;
  option2_value?: string | null;
  option3_value?: string | null;
  barcode?: string | null;
  cost?: number | null;
  purchase_cost?: number | null;
  default_pricing_type?: string;
  default_price?: number | null;
  deleted_at?: string | null;
  stores?: LoyverseVariantStore[];
};
export type LoyverseItem = {
  id?: string;
  handle?: string | null;
  item_name?: string;
  description?: string | null;
  category_id?: string | null;
  track_stock?: boolean;
  sold_by_weight?: boolean;
  deleted_at?: string | null;
  components?: { variant_id?: string; quantity?: number }[];
  /** Loyverse docs say modifiers_ids; the live API returns modifier_ids. */
  modifier_ids?: string[];
  modifiers_ids?: string[];
  option1_name?: string | null;
  option2_name?: string | null;
  option3_name?: string | null;
  variants?: LoyverseVariant[];
};

/** Prefer the live API field; keep the documented typo as a fallback. */
export function itemModifierIds(item: Pick<LoyverseItem, "modifier_ids" | "modifiers_ids">) {
  const ids = item.modifier_ids ?? item.modifiers_ids ?? [];
  return ids.filter((id): id is string => typeof id === "string" && id.length > 0);
}
export type LoyverseCustomer = {
  name?: string;
  email?: string | null;
  phone_number?: string | null;
  address?: string | null;
  city?: string | null;
  region?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
  customer_code?: string | null;
  note?: string | null;
  total_visits?: number | null;
  total_spent?: number | null;
  total_points?: number | null;
  deleted_at?: string | null;
};
export type LoyverseInventory = { variant_id?: string; store_id?: string; in_stock?: number | null };

export type LoyverseCatalog = {
  stores: LoyverseStore[];
  categories: LoyverseCategory[];
  items: LoyverseItem[];
  modifiers: LoyverseModifier[];
  customers: LoyverseCustomer[];
  inventory: LoyverseInventory[];
  warnings: string[];
};

type Resource = {
  path: string;
  key: string;
  required?: boolean;
  label: string;
};

const RESOURCES: Resource[] = [
  { path: "stores", key: "stores", label: "stores" },
  { path: "categories", key: "categories", required: true, label: "categories" },
  { path: "items", key: "items", required: true, label: "items" },
  { path: "modifiers", key: "modifiers", required: true, label: "modifiers" },
  { path: "customers", key: "customers", label: "customers" },
  { path: "inventory", key: "inventory_levels", label: "stock levels" },
];

export function cleanLoyverseToken(raw: string) {
  const token = raw
    .replace(/^\uFEFF/, "")
    .replace(/^Bearer\s+/i, "")
    .replace(/\s+/g, "")
    .trim();
  if (token.length < 20 || token.length > 500 || !/^[A-Za-z0-9._~+/=-]+$/.test(token)) {
    throw new LoyverseApiError(
      400,
      "Paste the access token from Loyverse Back Office → Access tokens (no spaces). It is used once and not saved."
    );
  }
  return token;
}

export function catalogStats(catalog: LoyverseCatalog) {
  const liveItems = catalog.items.filter((item) => !item.deleted_at);
  const liveCustomers = catalog.customers.filter((customer) => !customer.deleted_at);
  return {
    stores: catalog.stores.length,
    categories: catalog.categories.filter((category) => !category.deleted_at).length,
    items: liveItems.length,
    variants: liveItems.reduce(
      (sum, item) => sum + (item.variants ?? []).filter((variant) => !variant.deleted_at).length,
      0
    ),
    modifiers: catalog.modifiers.filter((modifier) => !modifier.deleted_at).length,
    customers: liveCustomers.length,
    inventory: catalog.inventory.length,
    warnings: catalog.warnings,
  };
}

export async function pullLoyverse(rawToken: string, fetchImpl: typeof fetch = fetch): Promise<LoyverseCatalog> {
  const token = cleanLoyverseToken(rawToken);
  const catalog: LoyverseCatalog = {
    stores: [],
    categories: [],
    items: [],
    modifiers: [],
    customers: [],
    inventory: [],
    warnings: [],
  };
  for (const resource of RESOURCES) {
    try {
      const rows = await fetchPages(token, resource.path, resource.key, fetchImpl);
      if (resource.key === "stores") catalog.stores = rows as LoyverseStore[];
      if (resource.key === "categories") catalog.categories = rows as LoyverseCategory[];
      if (resource.key === "items") catalog.items = rows as LoyverseItem[];
      if (resource.key === "modifiers") catalog.modifiers = rows as LoyverseModifier[];
      if (resource.key === "customers") catalog.customers = rows as LoyverseCustomer[];
      if (resource.key === "inventory_levels") catalog.inventory = rows as LoyverseInventory[];
    } catch (error) {
      if (error instanceof LoyverseApiError && !resource.required && (error.status === 401 || error.status === 403)) {
        catalog.warnings.push(
          `Token could not read ${resource.label} — create a new Loyverse access token with ${resource.label} allowed, or continue without them.`
        );
        continue;
      }
      throw error;
    }
  }
  if (!catalog.items.length && !catalog.customers.length) {
    throw new LoyverseApiError(
      400,
      "Loyverse returned no items or customers. Check the token has Items (and Customers if needed) permission, and that the Loyverse account has a catalogue."
    );
  }
  return catalog;
}

async function fetchPages(token: string, path: string, key: string, fetchImpl: typeof fetch) {
  const collected: unknown[] = [];
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`${API_ROOT}/${path}`);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (cursor) url.searchParams.set("cursor", cursor);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      throw new LoyverseApiError(502, `Could not reach Loyverse (${path}). Try again in a moment.`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new LoyverseApiError(
        response.status,
        `Loyverse blocked ${path} for this access token. In Loyverse → Access tokens, create a token with Items, Categories, Modifiers, Customers and Inventory ticked.`
      );
    }
    if (response.status === 429) {
      throw new LoyverseApiError(429, "Loyverse is limiting requests. Wait a minute and try again.");
    }
    if (!response.ok) {
      throw new LoyverseApiError(502, `Loyverse could not return ${path} (HTTP ${response.status}).`);
    }
    const body = (await response.json()) as Record<string, unknown>;
    const batch = body[key];
    if (Array.isArray(batch)) collected.push(...batch);
    const next = body.cursor;
    if (typeof next !== "string" || !next || next === cursor) break;
    cursor = next;
  }
  return collected;
}
