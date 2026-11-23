import { createHmac, timingSafeEqual } from "node:crypto";
import { receiptModifierLines } from "@cloudtill/shared";
import { prisma } from "../db.js";
import { calcTax, lineSubtotal } from "../money.js";
import { attributionEmployee } from "../company.js";
import { soldOutItemIds } from "./soldOut.js";

export const DELIVERY_CHANNELS = [
  "justeat",
  "deliveroo",
  "ubereats",
  "hungrypanda",
  "foodhub",
  "generic",
] as const;

export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export const CHANNEL_LABELS: Record<DeliveryChannel, string> = {
  justeat: "Just Eat",
  deliveroo: "Deliveroo",
  ubereats: "Uber Eats",
  hungrypanda: "HungryPanda",
  foodhub: "Foodhub",
  generic: "Delivery (middleware)",
};

const ENABLED_KEY = "delivery.enabledChannels";
const SECRET_KEY = "delivery.webhookSecret";

export function isDeliveryChannel(value: string): value is DeliveryChannel {
  return (DELIVERY_CHANNELS as readonly string[]).includes(value);
}

export async function readSetting(storeId: string, key: string) {
  const row = await prisma.setting.findUnique({ where: { storeId_key: { storeId, key } } });
  return row?.value ?? "";
}

export async function writeSetting(storeId: string, key: string, value: string) {
  await prisma.setting.upsert({
    where: { storeId_key: { storeId, key } },
    create: { storeId, key, value },
    update: { value },
  });
}

export async function getEnabledChannels(storeId: string): Promise<DeliveryChannel[]> {
  const raw = await readSetting(storeId, ENABLED_KEY);
  if (!raw.trim()) return [...DELIVERY_CHANNELS];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DELIVERY_CHANNELS];
    return parsed.filter((c): c is DeliveryChannel => typeof c === "string" && isDeliveryChannel(c));
  } catch {
    return [...DELIVERY_CHANNELS];
  }
}

export async function setEnabledChannels(storeId: string, channels: DeliveryChannel[]) {
  await writeSetting(storeId, ENABLED_KEY, JSON.stringify(channels));
}

export async function getWebhookSecret(storeId: string) {
  return readSetting(storeId, SECRET_KEY);
}

export async function setWebhookSecret(storeId: string, secret: string) {
  await writeSetting(storeId, SECRET_KEY, secret.trim());
}

export function secretsMatch(provided: string | undefined, expected: string) {
  if (!expected) return false;
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Uber Eats: HMAC-SHA256(client_secret, raw body) hex, header X-Uber-Signature. */
export function uberSignatureOk(rawBody: string, signatureHeader: string | undefined, clientSecret: string) {
  if (!clientSecret || !signatureHeader) return false;
  const expected = createHmac("sha256", clientSecret).update(rawBody).digest("hex");
  return secretsMatch(signatureHeader.toLowerCase(), expected.toLowerCase());
}

export type IngestLine = {
  variantId?: string;
  sku?: string;
  barcode?: string;
  name?: string;
  quantity: number;
  unitPriceCents?: number;
  modifiers?: { name: string; priceCents: number }[];
  note?: string;
};

export type IngestOrderInput = {
  storeId: string;
  channel: DeliveryChannel;
  externalOrderId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  fulfillment?: "pickup" | "dine_in" | "delivery";
  deliveryAddress?: string | null;
  note?: string | null;
  deliveryFeeCents?: number;
  lines: IngestLine[];
  partnerMeta?: Record<string, unknown>;
  /** When true, mark as already paid by the marketplace */
  paidByPlatform?: boolean;
};

async function resolveLine(
  storeId: string,
  line: IngestLine
): Promise<{
  variantId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  modifiersJson: string;
  note?: string;
} | { error: string }> {
  let variant =
    line.variantId
      ? await prisma.variant.findFirst({
          where: { id: line.variantId, item: { storeId } },
          include: { item: true },
        })
      : null;

  if (!variant && line.sku) {
    variant = await prisma.variant.findFirst({
      where: { sku: line.sku, item: { storeId } },
      include: { item: true },
    });
  }
  if (!variant && line.barcode) {
    variant = await prisma.variant.findFirst({
      where: { barcode: line.barcode, item: { storeId } },
      include: { item: true },
    });
  }
  if (!variant && line.name) {
    const needle = line.name.trim().toLowerCase();
    const candidates = await prisma.item.findMany({
      where: { storeId, active: true },
      include: { variants: { where: { active: true }, take: 1 } },
      take: 200,
    });
    const found =
      candidates.find((i) => i.name.toLowerCase() === needle) ??
      candidates.find((i) => i.name.toLowerCase().includes(needle) || needle.includes(i.name.toLowerCase()));
    if (found?.variants[0]) {
      variant = await prisma.variant.findFirst({
        where: { id: found.variants[0].id },
        include: { item: true },
      });
    }
  }

  if (!variant) {
    return {
      error: `Could not map line "${line.name || line.sku || line.barcode || line.variantId || "?"}" to a catalog item (set SKU/barcode to match)`,
    };
  }

  const mods = line.modifiers ?? [];
  return {
    variantId: variant.id,
    name: line.name?.trim() || variant.item.name,
    quantity: line.quantity > 0 ? line.quantity : 1,
    unitPriceCents: typeof line.unitPriceCents === "number" ? line.unitPriceCents : variant.priceCents,
    modifiersJson: JSON.stringify(mods),
    note: line.note,
  };
}

async function sellStock(storeId: string, variantId: string, quantity: number, note: string, employeeId: string) {
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

/** Inject a marketplace / middleware order into kitchen + till like PurePOS online orders. */
export async function injectDeliveryOrder(input: IngestOrderInput) {
  const channel = input.channel;
  const label = CHANNEL_LABELS[channel];
  const enabled = await getEnabledChannels(input.storeId);
  if (!enabled.includes(channel)) {
    return { error: `${label} is disabled for this store`, status: 403 as const };
  }

  if (input.externalOrderId) {
    const existing = await prisma.onlineOrder.findFirst({
      where: {
        storeId: input.storeId,
        channel,
        externalOrderId: input.externalOrderId,
      },
      include: { lines: true, ticket: true },
    });
    if (existing) {
      return { order: existing, ticketId: existing.ticketId, duplicate: true as const };
    }
  }

  const employee = await attributionEmployee(input.storeId);
  const register =
    (await prisma.register.findFirst({ where: { storeId: input.storeId, name: { contains: "Front" } } })) ??
    (await prisma.register.findFirst({ where: { storeId: input.storeId } }));
  if (!employee || !register) {
    return { error: "Store needs an active employee and register", status: 400 as const };
  }

  const resolvedLines = [];
  for (const line of input.lines) {
    const resolved = await resolveLine(input.storeId, line);
    if ("error" in resolved) return { error: resolved.error, status: 400 as const };
    resolvedLines.push(resolved);
  }
  if (!resolvedLines.length) return { error: "Order has no lines", status: 400 as const };

  const soldOut = await soldOutItemIds(input.storeId);
  if (soldOut.size) {
    const variants = await prisma.variant.findMany({
      where: { id: { in: resolvedLines.map((line) => line.variantId) } },
      select: { id: true, itemId: true, item: { select: { name: true } } },
    });
    const blocked = variants.find((variant) => soldOut.has(variant.itemId));
    if (blocked) {
      return { error: `Sorry, ${blocked.item.name} has just sold out.`, status: 409 as const };
    }
  }

  const tax = await prisma.tax.findFirst({ where: { storeId: input.storeId, enabled: true } });
  let subtotal = 0;
  for (const line of resolvedLines) {
    const mods = JSON.parse(line.modifiersJson || "[]") as { priceCents?: number }[];
    const modSum = mods.reduce((s, m) => s + (m.priceCents ?? 0), 0);
    subtotal += lineSubtotal(line.unitPriceCents, line.quantity, modSum, 0);
  }

  const fulfillment = input.fulfillment ?? "delivery";
  const deliveryFeeCents = input.deliveryFeeCents ?? 0;
  const taxCents = tax ? calcTax(subtotal, tax.rateBps, tax.inclusive) : 0;
  const totalCents = subtotal + (tax?.inclusive ? 0 : taxCents) + deliveryFeeCents;

  const count = await prisma.onlineOrder.count({ where: { storeId: input.storeId } });
  const prefix =
    channel === "justeat"
      ? "JE"
      : channel === "deliveroo"
        ? "DR"
        : channel === "ubereats"
          ? "UE"
          : channel === "hungrypanda"
            ? "HP"
            : channel === "foodhub"
              ? "FH"
              : "DL";
  const orderNumber = `${prefix}-${1000 + count + 1}`;

  const ticketNote = [
    label.toUpperCase(),
    fulfillment === "delivery" ? "DELIVERY" : fulfillment,
    input.customerName,
    input.customerPhone,
    input.deliveryAddress,
    input.note,
    input.externalOrderId ? `Ext ${input.externalOrderId}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const ticket = await prisma.ticket.create({
    data: {
      storeId: input.storeId,
      registerId: register.id,
      name: `${label} ${orderNumber}`,
      status: input.paidByPlatform === false ? "held" : "paid",
      source: channel === "generic" ? "delivery" : channel,
      kitchenStatus: "queued",
      note: ticketNote,
      lines: {
        create: resolvedLines.map((l) => ({
          variantId: l.variantId,
          name: l.name,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          modifiersJson: l.modifiersJson,
          note: l.note,
        })),
      },
    },
  });

  const partnerMetaJson = input.partnerMeta
    ? JSON.stringify(input.partnerMeta).slice(0, 8000)
    : null;

  const order = await prisma.onlineOrder.create({
    data: {
      storeId: input.storeId,
      ticketId: ticket.id,
      orderNumber,
      customerName: input.customerName,
      customerPhone: input.customerPhone ?? null,
      customerEmail: input.customerEmail ?? null,
      fulfillment,
      status: "pending",
      channel,
      externalOrderId: input.externalOrderId ?? null,
      partnerMetaJson,
      note: input.note ?? null,
      deliveryAddress: input.deliveryAddress ?? null,
      deliveryFeeCents,
      subtotalCents: subtotal,
      taxCents,
      totalCents,
      cardBrand: label,
      cardLast4: input.paidByPlatform === false ? null : "APP",
      lines: {
        create: resolvedLines.map((l) => ({
          variantId: l.variantId,
          name: l.name,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          modifiersJson: l.modifiersJson,
          note: l.note,
        })),
      },
    },
    include: { lines: true, ticket: true },
  });

  const kitchenText = [
    `KITCHEN · ${orderNumber}`,
    `>>> ${label.toUpperCase()} <<<`,
    fulfillment === "delivery" ? "DELIVERY" : fulfillment.toUpperCase(),
    input.customerName,
    input.customerPhone || null,
    input.deliveryAddress ? `Addr: ${input.deliveryAddress}` : null,
    input.externalOrderId ? `Partner #${input.externalOrderId}` : null,
    input.paidByPlatform === false ? "UNPAID / confirm on tablet" : `PAID via ${label}`,
    "----",
    ...resolvedLines.map((l) => {
      let extra = "";
      try {
        const lines = receiptModifierLines(JSON.parse(l.modifiersJson || "[]") as { name?: string; groupName?: string }[]);
        extra = lines.length ? `\n${lines.map((line) => `  ${line}`).join("\n")}` : "";
      } catch {
        extra = "";
      }
      return `${l.quantity} x ${l.name}${extra}`;
    }),
    input.note ? `Note: ${input.note}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const encoder = new TextEncoder();
  const payload = encoder.encode(`\x1b\x40${kitchenText}\n\n\x1d\x56\x01`);
  const printer = await prisma.printerDevice.findFirst({
    where: { storeId: input.storeId, enabled: true },
    orderBy: { isDefault: "desc" },
  });
  await prisma.printJob.create({
    data: {
      storeId: input.storeId,
      printerId: printer?.id,
      type: "kitchen",
      status: "queued",
      payloadB64: Buffer.from(payload).toString("base64"),
      preview: kitchenText,
      ticketId: ticket.id,
    },
  });

  if (input.paidByPlatform !== false) {
    const saleCount = await prisma.sale.count({ where: { storeId: input.storeId } });
    const receiptNumber = `DL-${10000 + saleCount + 1}`;
    const openShift = await prisma.shift.findFirst({
      where: { storeId: input.storeId, registerId: register.id, status: "open" },
    });
    const payType =
      (await prisma.paymentType.findFirst({
        where: { storeId: input.storeId, name: label, enabled: true },
      })) ??
      (await prisma.paymentType.findFirst({
        where: { storeId: input.storeId, type: "other", enabled: true },
      })) ??
      (await prisma.paymentType.findFirst({ where: { storeId: input.storeId, enabled: true } }));

    const saleLines: {
      variantId?: string;
      name: string;
      quantity: number;
      unitPriceCents: number;
      totalCents: number;
      modifiersJson: string;
    }[] = resolvedLines.map((line) => {
      const mods = JSON.parse(line.modifiersJson || "[]") as { priceCents?: number }[];
      const modSum = mods.reduce((sum, mod) => sum + (mod.priceCents ?? 0), 0);
      return {
        variantId: line.variantId,
        name: line.name,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        totalCents: lineSubtotal(line.unitPriceCents, line.quantity, modSum, 0),
        modifiersJson: line.modifiersJson,
      };
    });
    if (deliveryFeeCents > 0) {
      saleLines.push({
        name: `${label} delivery fee`,
        quantity: 1,
        unitPriceCents: deliveryFeeCents,
        totalCents: deliveryFeeCents,
        modifiersJson: "[]",
      });
    }

    if (payType) {
      await prisma.sale.create({
        data: {
          receiptNumber,
          storeId: input.storeId,
          registerId: register.id,
          employeeId: employee.id,
          shiftId: openShift?.id,
          status: "completed",
          subtotalCents: subtotal,
          taxCents,
          totalCents,
          paidCents: totalCents,
          note: `${label} ${orderNumber}`,
          lines: { create: saleLines },
          payments: {
            create: {
              paymentTypeId: payType.id,
              paymentTypeName: label,
              amountCents: totalCents,
            },
          },
        },
      });

      for (const line of resolvedLines) {
        const variant = await prisma.variant.findUnique({
          where: { id: line.variantId },
          include: { item: { include: { kitComponents: true } } },
        });
        if (!variant) continue;
        if (variant.item.isComposite) {
          for (const component of variant.item.kitComponents) {
            await sellStock(
              input.storeId,
              component.componentVarId,
              -component.quantity * line.quantity,
              receiptNumber,
              employee.id
            );
          }
        } else if (variant.trackStock) {
          await sellStock(input.storeId, variant.id, -line.quantity, receiptNumber, employee.id);
        }
      }

      await prisma.onlineOrder.update({
        where: { id: order.id },
        data: { receiptNumber },
      });
    }
  }

  const fresh = await prisma.onlineOrder.findUniqueOrThrow({
    where: { id: order.id },
    include: { lines: true, ticket: true },
  });

  return { order: fresh, ticketId: ticket.id, duplicate: false as const };
}
