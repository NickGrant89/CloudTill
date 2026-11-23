import type { RequestHandler } from "express";
import { prisma } from "./db.js";

const PLATFORM_HOSTS = new Set([
  "purepos.co.uk",
  "www.purepos.co.uk",
  "staging.purepos.co.uk",
  "localhost",
  "127.0.0.1",
  "::1",
]);

export function bareHost(host: string) {
  return host.split(":")[0].trim().toLowerCase().replace(/\.$/, "");
}

/** Hosts that keep serving the normal PurePOS site. */
export function isPlatformHost(host: string) {
  const name = bareHost(host);
  if (!name) return true;
  if (PLATFORM_HOSTS.has(name)) return true;
  if (name.endsWith(".purepos.co.uk")) return true;
  if (name.endsWith(".railway.app")) return true;
  return false;
}

/** The hostname owners point their CNAME at. A local dev URL is not a public host. */
export function orderingCnameTarget() {
  const fallback = (process.env.PRODUCT_DOMAIN || "purepos.co.uk").trim().toLowerCase() || "purepos.co.uk";
  const base = process.env.PUBLIC_BASE_URL?.trim();
  if (!base) return fallback;
  try {
    const host = new URL(base).hostname.toLowerCase();
    if (!host || host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) return fallback;
    return host;
  } catch {
    return fallback;
  }
}

/** Empty input clears the domain. Otherwise a single hostname, or an error message. */
export function normalizeOrderingDomain(raw: string | null): { domain: string | null } | { error: string } {
  let value = (raw ?? "").trim().toLowerCase();
  if (!value) return { domain: null };
  value = value.replace(/^https?:\/\//, "").split("/")[0].split("?")[0].replace(/\.$/, "").replace(/:\d+$/, "");
  if (value === "purepos.co.uk" || value.endsWith(".purepos.co.uk")) {
    return { error: "purepos.co.uk is the PurePOS site. Use your own domain, such as order.yourcafe.co.uk" };
  }
  const ok = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(value);
  if (!ok) return { error: "Enter a domain like order.yourcafe.co.uk" };
  return { domain: value };
}

/**
 * A saved shop domain serves that store's ordering page (/order/?store=slug).
 * Any other host continues to the normal site.
 */
export function orderingHostMiddleware(): RequestHandler {
  return async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const host = bareHost(req.hostname || "");
    if (isPlatformHost(host)) return next();
    if (req.path.startsWith("/api/")) return next();
    const last = req.path.split("/").pop() ?? "";
    if (req.path.startsWith("/order/") && last.includes(".")) return next();

    try {
      const store = await prisma.store.findUnique({
        where: { customDomain: host },
        select: { slug: true },
      });
      if (!store) return next();

      const params = new URLSearchParams(req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?") + 1) : "");
      const queryStore = (params.get("store") || params.get("slug") || "").toLowerCase();
      const onOrderRoot = req.path === "/order" || req.path === "/order/";
      const onOrderSlug = req.path === `/order/${store.slug}` || req.path.startsWith(`/order/${store.slug}/`);
      if ((onOrderRoot && queryStore === store.slug) || onOrderSlug) return next();
      return res.redirect(302, `/order/?store=${encodeURIComponent(store.slug)}`);
    } catch (err) {
      next(err);
    }
  };
}
