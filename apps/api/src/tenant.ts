import type { RequestHandler } from "express";
import { prisma } from "./db.js";
import type { AuthedRequest } from "./auth.js";

export type OwnedKind =
  | "category"
  | "item"
  | "modifierGroup"
  | "modifier"
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

/** True when the record with `id` belongs to `storeId`. Unknown ids count as not owned. */
export async function storeOwns(kind: OwnedKind, id: string, storeId: string): Promise<boolean> {
  const byStore = { id, storeId };
  switch (kind) {
    case "category":
      return (await prisma.category.count({ where: byStore })) > 0;
    case "item":
      return (await prisma.item.count({ where: byStore })) > 0;
    case "modifierGroup":
      return (await prisma.modifierGroup.count({ where: { id, item: { storeId } } })) > 0;
    case "modifier":
      return (await prisma.modifier.count({ where: { id, group: { item: { storeId } } } })) > 0;
    case "ticket":
      return (await prisma.ticket.count({ where: byStore })) > 0;
    case "ticketLine":
      return (await prisma.ticketLine.count({ where: { id, ticket: { storeId } } })) > 0;
    case "tax":
      return (await prisma.tax.count({ where: byStore })) > 0;
    case "paymentType":
      return (await prisma.paymentType.count({ where: byStore })) > 0;
    case "customer":
      return (await prisma.customer.count({ where: byStore })) > 0;
    case "employee":
      return (await prisma.employee.count({ where: byStore })) > 0;
    case "giftCard":
      return (await prisma.giftCard.count({ where: byStore })) > 0;
    case "sale":
      return (await prisma.sale.count({ where: byStore })) > 0;
    case "shift":
      return (await prisma.shift.count({ where: byStore })) > 0;
    case "printJob":
      return (await prisma.printJob.count({ where: byStore })) > 0;
    case "onlineOrder":
      return (await prisma.onlineOrder.count({ where: byStore })) > 0;
  }
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
