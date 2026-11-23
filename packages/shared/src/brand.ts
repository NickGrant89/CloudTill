/** Product brand — GitHub/repo folder may still say CloudTill. */

export const PRODUCT_NAME = "PurePOS";
export const PRODUCT_LEGAL = "PurePOS UK";
export const PRODUCT_DOMAIN = "purepos.co.uk";
export const PRODUCT_TAGLINE = "Cloud POS · offline tills · UK";

/** Production domain (hosting currently suspended). */
export const PRODUCT_PUBLIC_URL = `https://${PRODUCT_DOMAIN}`;

/** Documented staging host for pilots until production hosting is restored. */
export const PRODUCT_STAGING_HOST = "staging.purepos.co.uk";
export const PRODUCT_STAGING_URL = `https://${PRODUCT_STAGING_HOST}`;

/** Local monorepo defaults (Vite apps + API). */
export const LOCAL_URLS = {
  api: "http://localhost:4000",
  pos: "http://localhost:5173",
  backoffice: "http://localhost:5174",
  ordering: "http://localhost:5175",
  pricing: "http://localhost:4000/pricing",
} as const;

export const DEMO_EMAILS = {
  owner: "owner@purepos.demo",
  manager: "manager@purepos.demo",
  cashier: "cashier@purepos.demo",
} as const;
