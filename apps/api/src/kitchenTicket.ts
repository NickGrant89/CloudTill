import { receiptModifierLines } from "@cloudtill/shared";
import { prisma } from "./db.js";

export type KitchenTicketLine = {
  name: string;
  quantity: number;
  modifiersJson?: string | null;
  note?: string | null;
};

export function buildKitchenTicketText(opts: {
  orderNumber: string;
  customerName?: string | null;
  fulfillment?: string | null;
  lines: KitchenTicketLine[];
  note?: string | null;
  paidLabel?: string | null;
}) {
  const fulfillment =
    opts.fulfillment === "delivery"
      ? ">>> DELIVERY <<<"
      : opts.fulfillment === "pickup"
        ? "TAKE AWAY"
        : "EAT IN";
  return [
    `KITCHEN · ${opts.orderNumber}`,
    fulfillment,
    opts.customerName?.trim() || null,
    opts.paidLabel || null,
    "----",
    ...opts.lines.map((line) => {
      let extra = "";
      try {
        const mods = receiptModifierLines(JSON.parse(line.modifiersJson || "[]") as { name?: string; groupName?: string }[]);
        extra = mods.length ? `\n${mods.join("\n")}` : "";
      } catch {
        extra = "";
      }
      return `${line.quantity} x ${line.name}${extra}${line.note ? `\n  Note: ${line.note}` : ""}`;
    }),
    opts.note?.trim() ? `Note: ${opts.note.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function queueKitchenPrintJob(opts: {
  storeId: string;
  text: string;
  ticketId?: string | null;
  saleId?: string | null;
}) {
  const encoder = new TextEncoder();
  const payload = encoder.encode(`\x1b\x40${opts.text}\n\n\x1d\x56\x01`);
  const printer = await prisma.printerDevice.findFirst({
    where: { storeId: opts.storeId, enabled: true },
    orderBy: { isDefault: "desc" },
  });
  return prisma.printJob.create({
    data: {
      storeId: opts.storeId,
      printerId: printer?.id,
      type: "kitchen",
      status: "queued",
      payloadB64: Buffer.from(payload).toString("base64"),
      preview: opts.text,
      ticketId: opts.ticketId ?? undefined,
      saleId: opts.saleId ?? undefined,
    },
  });
}

/** After a till sale, put the order on the kitchen screen and queue a kitchen print with modifiers. */
export async function ensureKitchenTicketForSale(opts: {
  storeId: string;
  saleId: string;
  receiptNumber: string;
  ticketId: string;
  customerName?: string | null;
  fulfillment?: string | null;
  note?: string | null;
  lines: {
    variantId: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    modifiersJson: string;
    note?: string | null;
  }[];
  alreadySent: boolean;
}) {
  const text = buildKitchenTicketText({
    orderNumber: opts.receiptNumber,
    customerName: opts.customerName,
    fulfillment: opts.fulfillment ?? "dine_in",
    lines: opts.lines,
    note: opts.note,
    paidLabel: `PAID · ${opts.receiptNumber}`,
  });

  if (opts.alreadySent || !opts.lines.length) {
    return { preview: text, orderId: null, printJobId: null as string | null };
  }

  const count = await prisma.onlineOrder.count({ where: { storeId: opts.storeId, channel: "till" } });
  const subtotal = opts.lines.reduce((sum, line) => sum + Math.round(line.unitPriceCents * line.quantity), 0);
  const order = await prisma.onlineOrder.create({
    data: {
      storeId: opts.storeId,
      ticketId: opts.ticketId,
      orderNumber: `T-${100 + count + 1}`,
      customerName: opts.customerName?.trim() || "Till sale",
      fulfillment: opts.fulfillment === "pickup" || opts.fulfillment === "delivery" ? opts.fulfillment : "dine_in",
      channel: "till",
      status: "pending",
      note: opts.note?.trim() || null,
      subtotalCents: subtotal,
      totalCents: subtotal,
      receiptNumber: opts.receiptNumber,
      lines: {
        create: opts.lines.map((line) => ({
          variantId: line.variantId,
          name: line.name,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          modifiersJson: line.modifiersJson,
          note: line.note ?? null,
        })),
      },
    },
  });
  await prisma.ticket.update({
    where: { id: opts.ticketId },
    data: { kitchenStatus: "queued" },
  });

  const job = await queueKitchenPrintJob({
    storeId: opts.storeId,
    text,
    ticketId: opts.ticketId,
    saleId: opts.saleId,
  });

  return { preview: text, orderId: order.id, printJobId: job.id };
}
