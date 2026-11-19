import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { prisma } from "../db.js";
import { requireAuth, requireRole, type AuthedRequest } from "../auth.js";

export const giftCardsRouter = Router();
giftCardsRouter.use(requireAuth);

giftCardsRouter.get("/", async (req: AuthedRequest, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const cards = await prisma.giftCard.findMany({
    where: {
      storeId: req.user!.storeId,
      ...(q ? { OR: [{ code: { contains: q } }] } : {}),
    },
    include: { customer: true, ledger: { orderBy: { createdAt: "desc" }, take: 20 } },
    orderBy: { createdAt: "desc" },
  });
  res.json(cards);
});

giftCardsRouter.get("/:code", async (req: AuthedRequest, res) => {
  const card = await prisma.giftCard.findFirst({
    where: {
      OR: [{ code: req.params.code }, { id: req.params.code }],
      storeId: req.user!.storeId,
    },
    include: { customer: true, ledger: { orderBy: { createdAt: "desc" } } },
  });
  if (!card) return res.status(404).json({ error: "Gift card not found" });
  res.json(card);
});

giftCardsRouter.post("/", requireRole("owner", "manager", "cashier"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      amountCents: z.number().int().positive(),
      code: z.string().min(4).optional(),
      customerId: z.string().nullable().optional(),
      note: z.string().optional(),
    })
    .parse(req.body);

  const code = (body.code ?? `GC-${nanoid(8)}`).toUpperCase();
  const card = await prisma.giftCard.create({
    data: {
      storeId: req.user!.storeId,
      code,
      initialCents: body.amountCents,
      balanceCents: body.amountCents,
      customerId: body.customerId ?? null,
      status: "active",
      ledger: {
        create: {
          type: "issue",
          amountCents: body.amountCents,
          balanceAfter: body.amountCents,
          note: body.note ?? "Issued",
          employeeId: req.user!.sub,
        },
      },
    },
    include: { ledger: true },
  });
  res.status(201).json(card);
});

giftCardsRouter.post("/:id/reload", requireRole("owner", "manager", "cashier"), async (req: AuthedRequest, res) => {
  const body = z.object({ amountCents: z.number().int().positive(), note: z.string().optional() }).parse(req.body);
  const card = await prisma.giftCard.findUniqueOrThrow({ where: { id: req.params.id } });
  if (card.status !== "active") return res.status(400).json({ error: "Card disabled" });
  const balance = card.balanceCents + body.amountCents;
  const updated = await prisma.giftCard.update({
    where: { id: card.id },
    data: {
      balanceCents: balance,
      ledger: {
        create: {
          type: "reload",
          amountCents: body.amountCents,
          balanceAfter: balance,
          note: body.note ?? "Reload",
          employeeId: req.user!.sub,
        },
      },
    },
    include: { ledger: { orderBy: { createdAt: "desc" }, take: 20 } },
  });
  res.json(updated);
});

giftCardsRouter.post("/:id/adjust", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z.object({ balanceCents: z.number().int().nonnegative(), note: z.string().optional() }).parse(req.body);
  const card = await prisma.giftCard.findUniqueOrThrow({ where: { id: req.params.id } });
  const delta = body.balanceCents - card.balanceCents;
  const updated = await prisma.giftCard.update({
    where: { id: card.id },
    data: {
      balanceCents: body.balanceCents,
      ledger: {
        create: {
          type: "adjust",
          amountCents: delta,
          balanceAfter: body.balanceCents,
          note: body.note ?? "Manual adjust",
          employeeId: req.user!.sub,
        },
      },
    },
    include: { ledger: { orderBy: { createdAt: "desc" }, take: 20 } },
  });
  res.json(updated);
});

giftCardsRouter.patch("/:id", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z.object({ status: z.enum(["active", "disabled"]).optional(), customerId: z.string().nullable().optional() }).parse(req.body);
  const updated = await prisma.giftCard.update({ where: { id: req.params.id }, data: body });
  res.json(updated);
});

/** Redeem helper used by POS pay path as well */
export async function redeemGiftCard(opts: {
  storeId: string;
  code: string;
  amountCents: number;
  employeeId: string;
  saleId?: string;
}) {
  const card = await prisma.giftCard.findFirst({
    where: { storeId: opts.storeId, code: opts.code.toUpperCase(), status: "active" },
  });
  if (!card) throw new Error("Gift card not found");
  if (card.balanceCents < opts.amountCents) throw new Error("Insufficient gift card balance");
  const balance = card.balanceCents - opts.amountCents;
  await prisma.giftCard.update({
    where: { id: card.id },
    data: {
      balanceCents: balance,
      ledger: {
        create: {
          type: "redeem",
          amountCents: -opts.amountCents,
          balanceAfter: balance,
          saleId: opts.saleId,
          note: "POS redeem",
          employeeId: opts.employeeId,
        },
      },
    },
  });
  return { cardId: card.id, code: card.code, balanceAfter: balance };
}
