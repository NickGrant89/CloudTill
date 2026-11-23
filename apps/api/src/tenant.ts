import type { RequestHandler, Response } from "express";
import { prisma } from "./db.js";
import type { AuthedRequest } from "./auth.js";

export type OwnedKind =
  | "category"
  | "item"
  | "modifierGroup"
  | "modifier"
  | "variant"
  | "register"
  | "ticket"
  | "ticketLine"
  | "tax"
  | "paymentType"
  | "customer"
  | "employee"
  | "giftCard"
  | "sale"
  | "shift"
  | "printJob"
  | "onlineOrder";

/** How many of `ids` belong to `storeId`. Unknown ids count as not owned. */
async function ownedCount(kind: OwnedKind, ids: string[], storeId: string): Promise<number> {
  const id = { in: ids };
  switch (kind) {
    case "category":
      return prisma.category.count({ where: { id, storeId } });
    case "item":
      return prisma.item.count({ where: { id, storeId } });
    case "modifierGroup":
      return prisma.modifierGroup.count({ where: { id, item: { storeId } } });
    case "modifier":
      return prisma.modifier.count({ where: { id, group: { item: { storeId } } } });
    case "variant":
      return prisma.variant.count({ where: { id, item: { storeId } } });
    case "register":
      return prisma.register.count({ where: { id, storeId } });
    case "ticket":
      return prisma.ticket.count({ where: { id, storeId } });
    case "ticketLine":
      return prisma.ticketLine.count({ where: { id, ticket: { storeId } } });
    case "tax":
      return prisma.tax.count({ where: { id, storeId } });
    case "paymentType":
      return prisma.paymentType.count({ where: { id, storeId } });
    case "customer":
      return prisma.customer.count({ where: { id, storeId } });
    case "employee":
      return prisma.employee.count({ where: { id, storeId } });
    case "giftCard":
      return prisma.giftCard.count({ where: { id, storeId } });
    case "sale":
      return prisma.sale.count({ where: { id, storeId } });
    case "shift":
      return prisma.shift.count({ where: { id, storeId } });
    case "printJob":
      return prisma.printJob.count({ where: { id, storeId } });
    case "onlineOrder":
      return prisma.onlineOrder.count({ where: { id, storeId } });
  }
}

/** True when every id belongs to `storeId`. An empty list passes. */
export async function allOwned(kind: OwnedKind, ids: Array<string | null | undefined>, storeId: string) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return true;
  return (await ownedCount(kind, unique, storeId)) === unique.length;
}

/** True when the record with `id` belongs to `storeId`. Unknown ids count as not owned. */
export async function storeOwns(kind: OwnedKind, id: string, storeId: string) {
  return allOwned(kind, [id], storeId);
}

/**
 * Writes 404 and returns true when any id is missing or belongs to another business.
 * Blank ids are ignored, so an optional field left empty still passes.
 */
export async function rejectForeign(
  res: Response,
  kind: OwnedKind,
  ids: Array<string | null | undefined>,
  storeId: string
) {
  if (await allOwned(kind, ids, storeId)) return false;
  res.status(404).json({ error: "Not found" });
  return true;
}

/**
 * Route guard: 404s unless `req.params[param]` is a `kind` record in the signed-in store.
 * Answers 404 rather than 403 so other businesses' ids can't be probed.
 */
// `any` params keep Express inferring each route's own params from its path.
export function owned(kind: OwnedKind, param = "id"): RequestHandler<any> {
  return async (req, res, next) => {
    const id = req.params[param];
    const storeId = (req as AuthedRequest).user?.storeId;
    if (!id || !storeId || !(await storeOwns(kind, String(id), storeId))) {
      return res.status(404).json({ error: "Not found" });
    }
    next();
  };
}
