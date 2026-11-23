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
export type LoyverseModifierOption = { name?: string; price?: number | null; deleted_at?: string | null };
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
  modifiers_ids?: string[];
  option1_name?: string | null;
  option2_name?: string | null;
  option3_name?: string | null;
  variants?: LoyverseVariant[];
};
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
};

const RESOURCES: { path: string; key: string }[] = [
  { path: "stores", key: "stores" },
  { path: "categories", key: "categories" },
  { path: "items", key: "items" },
  { path: "modifiers", key: "modifiers" },
  { path: "customers", key: "customers" },
  { path: "inventory", key: "inventory_levels" },
];

export function cleanLoyverseToken(raw: string) {
  const token = raw.trim().replace(/^Bearer\s+/i, "").trim();
  if (token.length < 20 || token.length > 500 || !/^[A-Za-z0-9._~+/-]+$/.test(token)) {
    throw new LoyverseApiError(
      400,
      "Paste the access token from Loyverse Back Office → Access tokens. It is used once and not saved."
    );
  }
  return token;
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
  };
  for (const resource of RESOURCES) {
    const rows = await fetchPages(token, resource.path, resource.key, fetchImpl);
    if (resource.key === "stores") catalog.stores = rows as LoyverseStore[];
    if (resource.key === "categories") catalog.categories = rows as LoyverseCategory[];
    if (resource.key === "items") catalog.items = rows as LoyverseItem[];
    if (resource.key === "modifiers") catalog.modifiers = rows as LoyverseModifier[];
    if (resource.key === "customers") catalog.customers = rows as LoyverseCustomer[];
    if (resource.key === "inventory_levels") catalog.inventory = rows as LoyverseInventory[];
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
      throw new LoyverseApiError(502, "Could not reach Loyverse. Try again in a moment.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new LoyverseApiError(
        401,
        "Loyverse did not accept that access token. Create one in Back Office → Access tokens and paste it here."
      );
    }
    if (response.status === 429) {
      throw new LoyverseApiError(429, "Loyverse is limiting requests. Wait a minute and try again.");
    }
    if (!response.ok) {
      throw new LoyverseApiError(502, "Loyverse could not return the catalogue.");
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
