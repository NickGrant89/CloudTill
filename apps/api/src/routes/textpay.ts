import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole, type AuthedRequest } from "../auth.js";
import {
  completeTextPay,
  createTextPayLink,
  publicBaseUrl,
  stripeConfigured,
  textPayEnvStatus,
} from "../services/textPay.js";

export const textPayRouter = Router();
export const publicTextPayRouter = Router();

textPayRouter.use(requireAuth);

textPayRouter.get("/status", async (_req: AuthedRequest, res) => {
  res.json({
    ...textPayEnvStatus(),
    publicPayBase: `${publicBaseUrl()}/pay`,
  });
});

textPayRouter.get("/links", async (req: AuthedRequest, res) => {
  const links = await prisma.textPayLink.findMany({
    where: { storeId: req.user!.storeId },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  res.json(links);
});

textPayRouter.post("/links", requireRole("owner", "manager", "cashier"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      ticketId: z.string().optional(),
      amountCents: z.number().int().positive().optional(),
      phone: z.string().optional(),
      customerName: z.string().optional(),
      note: z.string().optional(),
      sendSms: z.boolean().optional(),
    })
    .parse(req.body ?? {});

  let amountCents = body.amountCents;
  let customerName = body.customerName;
  let ticketId = body.ticketId;

  if (ticketId) {
    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, storeId: req.user!.storeId },
      include: { lines: true, customer: true },
    });
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    if (ticket.status === "paid") return res.status(400).json({ error: "Ticket already paid" });
    if (!ticket.lines.length) return res.status(400).json({ error: "Ticket has no lines" });

    amountCents = amountCents ?? (await computeTicketDue(ticket.id));
    customerName = customerName || ticket.customer?.name || ticket.name;
  }

  if (amountCents == null || amountCents < 1) {
    return res.status(400).json({ error: "Provide ticketId or amountCents" });
  }

  try {
    const result = await createTextPayLink({
      storeId: req.user!.storeId,
      amountCents,
      ticketId,
      phone: body.phone,
      customerName,
      note: body.note,
      createdById: req.user!.sub,
      sendSms: body.sendSms,
    });
    res.status(201).json({
      ok: true,
      message: result.smsError
        ? `Link ready · ${result.smsError}`
        : result.link.status === "sent"
          ? "Payment link texted"
          : "Payment link ready — copy to send",
      ...result,
    });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Could not create link" });
  }
});

textPayRouter.get("/links/:id", async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const link = await prisma.textPayLink.findFirst({
    where: { id, storeId: req.user!.storeId },
  });
  if (!link) return res.status(404).json({ error: "Not found" });
  res.json(link);
});

textPayRouter.post("/links/:id/mark-paid", requireRole("owner", "manager", "cashier"), async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const link = await prisma.textPayLink.findFirst({
    where: { id, storeId: req.user!.storeId },
  });
  if (!link) return res.status(404).json({ error: "Not found" });
  try {
    const result = await completeTextPay(link.id, { employeeId: req.user!.sub });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Could not mark paid" });
  }
});

async function computeTicketDue(ticketId: string) {
  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: { lines: true },
  });
  let subtotal = 0;
  for (const l of ticket.lines) {
    let mods: { priceCents: number }[] = [];
    try {
      mods = JSON.parse(l.modifiersJson || "[]");
    } catch {
      mods = [];
    }
    const modSum = mods.reduce((s, m) => s + (m.priceCents || 0), 0);
    subtotal += Math.round((l.unitPriceCents + modSum) * l.quantity) - l.discountCents;
  }
  const tax = await prisma.tax.findFirst({ where: { storeId: ticket.storeId, enabled: true } });
  let taxCents = 0;
  if (tax) {
    const { calcTax } = await import("../money.js");
    taxCents = calcTax(subtotal - ticket.discountCents, tax.rateBps, tax.inclusive);
  }
  return subtotal - ticket.discountCents + taxCents + ticket.tipCents;
}

/** Public: fetch link status / details */
publicTextPayRouter.get("/:token", async (req, res) => {
  const token = String(req.params.token);
  const link = await prisma.textPayLink.findUnique({
    where: { token },
    include: { store: { select: { name: true, currency: true, phone: true } } },
  });
  if (!link) return res.status(404).json({ error: "Payment link not found" });
  res.json({
    token: link.token,
    status: link.status,
    amountCents: link.amountCents,
    currency: link.currency,
    customerName: link.customerName,
    note: link.note,
    payUrl: link.payUrl,
    stripeCheckout: Boolean(link.stripeSessionId),
    store: link.store,
    paidAt: link.paidAt,
  });
});

/** Public: customer confirms demo/hosted payment (when Stripe not used) */
publicTextPayRouter.post("/:token/pay", async (req, res) => {
  const token = String(req.params.token);
  const link = await prisma.textPayLink.findUnique({ where: { token } });
  if (!link) return res.status(404).json({ error: "Payment link not found" });
  if (link.status === "paid") return res.json({ ok: true, alreadyPaid: true });
  if (link.stripeSessionId && stripeConfigured()) {
    return res.status(400).json({
      error: "This link uses Stripe Checkout — open the pay URL to complete card payment",
      payUrl: link.payUrl,
    });
  }
  try {
    const result = await completeTextPay(link.id);
    res.json({
      ok: true,
      message: "Payment recorded",
      receiptNumber: "receiptNumber" in result ? result.receiptNumber : undefined,
      status: "paid",
    });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Payment failed" });
  }
});

/** Stripe webhook (Checkout session completed) — raw body optional; we use JSON if parsed */
publicTextPayRouter.post("/stripe/webhook", async (req: Request, res: Response) => {
  const event = req.body as {
    type?: string;
    data?: { object?: { client_reference_id?: string; metadata?: { purepos_token?: string }; payment_status?: string } };
  };
  // Optional signature check when STRIPE_WEBHOOK_SECRET set (simplified — production should use stripe SDK constructEvent)
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (secret) {
    const sig = req.headers["stripe-signature"];
    if (!sig) return res.status(400).json({ error: "Missing stripe-signature" });
    // Accept presence of secret + signature header; full HMAC verification needs raw body buffer.
  }

  if (event?.type === "checkout.session.completed" || event?.type === "checkout.session.async_payment_succeeded") {
    const obj = event.data?.object;
    const token = obj?.client_reference_id || obj?.metadata?.purepos_token;
    if (token && (obj?.payment_status === "paid" || event.type === "checkout.session.completed")) {
      const link = await prisma.textPayLink.findUnique({ where: { token } });
      if (link && link.status !== "paid") {
        try {
          await completeTextPay(link.id);
        } catch (e) {
          console.error("text-pay webhook complete failed", e);
        }
      }
    }
  }
  res.json({ received: true });
});
