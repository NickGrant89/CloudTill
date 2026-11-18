import { nanoid } from "nanoid";
import { prisma } from "../db.js";
import { lineSubtotal } from "../money.js";

export function publicBaseUrl() {
  return (
    process.env.PUBLIC_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    "http://localhost:4000"
  ).replace(/\/$/, "");
}

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

export function twilioConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_FROM_NUMBER?.trim()
  );
}

export function textPayEnvStatus() {
  return {
    stripe: {
      configured: stripeConfigured(),
      requiredEnv: ["STRIPE_SECRET_KEY"],
      optionalEnv: ["STRIPE_WEBHOOK_SECRET"],
      note: stripeConfigured()
        ? "Checkout Sessions used for text-to-pay links"
        : "No STRIPE_SECRET_KEY — PurePOS hosted pay page is used instead",
    },
    twilio: {
      configured: twilioConfigured(),
      requiredEnv: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"],
      note: twilioConfigured()
        ? "SMS sends when a phone number is provided"
        : "No Twilio env — staff copy/share the pay link (WhatsApp etc.)",
    },
  };
}

async function parseModifiers(json: string) {
  try {
    const parsed = JSON.parse(json || "[]") as { name: string; priceCents: number }[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Create Stripe Checkout Session for a one-off payment (no stripe npm pkg — REST). */
export async function createStripeCheckoutSession(opts: {
  amountCents: number;
  currency: string;
  storeName: string;
  token: string;
  ticketId?: string | null;
  customerPhone?: string | null;
  lineSummary?: string;
}) {
  const secret = process.env.STRIPE_SECRET_KEY!.trim();
  const base = publicBaseUrl();
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", `${base}/pay/${opts.token}?paid=1`);
  params.set("cancel_url", `${base}/pay/${opts.token}?cancelled=1`);
  params.set("client_reference_id", opts.token);
  params.set("metadata[purepos_token]", opts.token);
  if (opts.ticketId) params.set("metadata[ticket_id]", opts.ticketId);
  if (opts.customerPhone) params.set("metadata[phone]", opts.customerPhone);
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", opts.currency.toLowerCase());
  params.set("line_items[0][price_data][unit_amount]", String(opts.amountCents));
  params.set(
    "line_items[0][price_data][product_data][name]",
    opts.lineSummary || `Payment · ${opts.storeName}`
  );
  params.set("line_items[0][price_data][product_data][description]", `PurePOS text-to-pay · ${opts.storeName}`);

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const data = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok || !data.url || !data.id) {
    throw new Error(data.error?.message || "Stripe Checkout Session failed");
  }
  return { sessionId: data.id, url: data.url };
}

export async function sendTwilioSms(to: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID!.trim();
  const token = process.env.TWILIO_AUTH_TOKEN!.trim();
  const from = process.env.TWILIO_FROM_NUMBER!.trim();
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const params = new URLSearchParams({ To: to, From: from, Body: body });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const data = (await res.json()) as { sid?: string; message?: string; error_message?: string };
  if (!res.ok || !data.sid) {
    throw new Error(data.error_message || data.message || "Twilio SMS failed");
  }
  return data.sid;
}

export async function completeTextPay(linkId: string, opts?: { employeeId?: string | null }) {
  const link = await prisma.textPayLink.findUniqueOrThrow({ where: { id: linkId } });
  if (link.status === "paid") {
    return { alreadyPaid: true as const, link };
  }

  const store = await prisma.store.findUniqueOrThrow({ where: { id: link.storeId } });
  let ticket = link.ticketId
    ? await prisma.ticket.findUnique({
        where: { id: link.ticketId },
        include: { lines: true },
      })
    : null;

  if (ticket && ticket.status === "paid") {
    const updated = await prisma.textPayLink.update({
      where: { id: link.id },
      data: { status: "paid", paidAt: new Date() },
    });
    return { alreadyPaid: true as const, link: updated };
  }

  const employee =
    (opts?.employeeId
      ? await prisma.employee.findFirst({ where: { id: opts.employeeId, storeId: link.storeId } })
      : null) ??
    (await prisma.employee.findFirst({ where: { storeId: link.storeId, role: "owner", active: true } })) ??
    (await prisma.employee.findFirst({ where: { storeId: link.storeId, active: true } }));
  if (!employee) throw new Error("No employee to attribute sale");

  const register =
    (ticket
      ? await prisma.register.findUnique({ where: { id: ticket.registerId } })
      : null) ??
    (await prisma.register.findFirst({ where: { storeId: link.storeId } }));
  if (!register) throw new Error("No register configured");

  const payType =
    (await prisma.paymentType.findFirst({
      where: { storeId: link.storeId, name: "Text to pay", enabled: true },
    })) ??
    (await prisma.paymentType.findFirst({
      where: { storeId: link.storeId, type: "card", enabled: true },
    })) ??
    (await prisma.paymentType.create({
      data: {
        storeId: link.storeId,
        name: "Text to pay",
        type: "other",
        enabled: true,
        opensDrawer: false,
      },
    }));

  const openShift = await prisma.shift.findFirst({
    where: { storeId: link.storeId, registerId: register.id, status: "open" },
  });

  const saleCount = await prisma.sale.count({ where: { storeId: link.storeId } });
  const receiptNumber = `TP-${10000 + saleCount + 1}`;

  let subtotal = link.amountCents;
  let taxCents = 0;
  let tipCents = 0;
  let discountCents = 0;
  let lineCreates: {
    variantId?: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    discountCents: number;
    taxCents: number;
    totalCents: number;
    modifiersJson: string;
  }[] = [];

  if (ticket && ticket.lines.length) {
    tipCents = ticket.tipCents;
    discountCents = ticket.discountCents;
    subtotal = 0;
    for (const l of ticket.lines) {
      const mods = await parseModifiers(l.modifiersJson);
      const modSum = mods.reduce((s, m) => s + m.priceCents, 0);
      const lineTotal = lineSubtotal(l.unitPriceCents, l.quantity, modSum, l.discountCents);
      subtotal += lineTotal;
      lineCreates.push({
        variantId: l.variantId,
        name: l.name,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        discountCents: l.discountCents,
        taxCents: 0,
        totalCents: lineTotal,
        modifiersJson: l.modifiersJson,
      });
    }
    const tax = await prisma.tax.findFirst({ where: { storeId: link.storeId, enabled: true } });
    if (tax) {
      const { calcTax } = await import("../money.js");
      taxCents = calcTax(subtotal - discountCents, tax.rateBps, tax.inclusive);
    }
  } else {
    lineCreates = [
      {
        name: link.note?.trim() || "Text to pay",
        quantity: 1,
        unitPriceCents: link.amountCents,
        discountCents: 0,
        taxCents: 0,
        totalCents: link.amountCents,
        modifiersJson: "[]",
      },
    ];
  }

  const totalCents = ticket
    ? subtotal - discountCents + (taxCents || 0) + tipCents
    : link.amountCents;

  const sale = await prisma.sale.create({
    data: {
      receiptNumber,
      storeId: link.storeId,
      registerId: register.id,
      employeeId: employee.id,
      customerId: ticket?.customerId ?? null,
      shiftId: openShift?.id,
      status: "completed",
      subtotalCents: ticket ? subtotal : link.amountCents,
      discountCents,
      taxCents,
      tipCents,
      totalCents,
      paidCents: totalCents,
      changeCents: 0,
      note: [`Text to pay`, link.phone ? `SMS ${link.phone}` : null, link.note]
        .filter(Boolean)
        .join(" · "),
      lines: { create: lineCreates },
      payments: {
        create: {
          paymentTypeId: payType.id,
          paymentTypeName: payType.name,
          amountCents: totalCents,
        },
      },
    },
  });

  if (ticket) {
    for (const line of ticket.lines) {
      const variant = await prisma.variant.findUnique({
        where: { id: line.variantId },
        include: { item: { include: { kitComponents: true } } },
      });
      if (!variant) continue;
      if (variant.item.isComposite) {
        for (const kc of variant.item.kitComponents) {
          await adjustStock(
            link.storeId,
            kc.componentVarId,
            -kc.quantity * line.quantity,
            sale.receiptNumber,
            employee.id
          );
        }
      } else if (variant.trackStock) {
        await adjustStock(link.storeId, variant.id, -line.quantity, sale.receiptNumber, employee.id);
      }
    }
    await prisma.ticket.update({ where: { id: ticket.id }, data: { status: "paid" } });
    await prisma.ticketLine.deleteMany({ where: { ticketId: ticket.id } });
  }

  const updated = await prisma.textPayLink.update({
    where: { id: link.id },
    data: { status: "paid", paidAt: new Date(), saleId: sale.id },
  });

  return {
    alreadyPaid: false as const,
    link: updated,
    sale,
    storeName: store.name,
    receiptNumber: sale.receiptNumber,
  };
}

async function adjustStock(
  storeId: string,
  variantId: string,
  quantity: number,
  note: string,
  employeeId: string
) {
  const level = await prisma.inventoryLevel.findUnique({
    where: { storeId_variantId: { storeId, variantId } },
  });
  if (level) {
    await prisma.inventoryLevel.update({
      where: { id: level.id },
      data: { quantity: level.quantity + quantity },
    });
  }
  await prisma.inventoryMovement.create({
    data: { storeId, variantId, type: "sale", quantity, note, employeeId },
  });
}

export async function createTextPayLink(opts: {
  storeId: string;
  amountCents: number;
  ticketId?: string | null;
  phone?: string | null;
  customerName?: string | null;
  note?: string | null;
  createdById?: string | null;
  sendSms?: boolean;
}) {
  if (opts.amountCents < 1) throw new Error("Amount must be at least 1p");

  const store = await prisma.store.findUniqueOrThrow({ where: { id: opts.storeId } });
  const token = nanoid(12);
  const hostedPayUrl = `${publicBaseUrl()}/pay/${token}`;

  let payUrl = hostedPayUrl;
  let stripeSessionId: string | null = null;
  let provider: "stripe" | "hosted" = "hosted";

  if (stripeConfigured()) {
    try {
      const session = await createStripeCheckoutSession({
        amountCents: opts.amountCents,
        currency: store.currency || "gbp",
        storeName: store.name,
        token,
        ticketId: opts.ticketId,
        customerPhone: opts.phone,
        lineSummary: opts.note || (opts.ticketId ? "Till payment" : "Payment request"),
      });
      payUrl = session.url;
      stripeSessionId = session.sessionId;
      provider = "stripe";
    } catch (e) {
      // Fall back to hosted page — still usable without Stripe working
      provider = "hosted";
      payUrl = hostedPayUrl;
    }
  }

  let status = "pending";
  let smsSid: string | null = null;
  let smsError: string | null = null;
  if (opts.sendSms !== false && opts.phone?.trim()) {
    if (twilioConfigured()) {
      try {
        const pounds = (opts.amountCents / 100).toFixed(2);
        smsSid = await sendTwilioSms(
          opts.phone.trim(),
          `${store.name}: pay £${pounds} securely ${payUrl}`
        );
        status = "sent";
      } catch (e) {
        smsError = e instanceof Error ? e.message : "SMS failed";
      }
    } else {
      smsError = "Twilio not configured — copy the link to send manually";
    }
  }

  const link = await prisma.textPayLink.create({
    data: {
      storeId: opts.storeId,
      ticketId: opts.ticketId ?? null,
      token,
      amountCents: opts.amountCents,
      currency: (store.currency || "GBP").toLowerCase(),
      phone: opts.phone?.trim() || null,
      customerName: opts.customerName?.trim() || null,
      status,
      payUrl,
      stripeSessionId,
      smsSid,
      note: opts.note ?? null,
      createdById: opts.createdById ?? null,
    },
  });

  return {
    link,
    provider,
    hostedPayUrl,
    smsError,
    env: textPayEnvStatus(),
  };
}
