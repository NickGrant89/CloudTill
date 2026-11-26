import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole, type AuthedRequest } from "../auth.js";
import { storeAllowsFeature } from "./billing.js";
import {
  CHANNEL_LABELS,
  DELIVERY_CHANNELS,
  type DeliveryChannel,
  type IngestLine,
  getEnabledChannels,
  getWebhookSecret,
  injectDeliveryOrder,
  isDeliveryChannel,
  readSetting,
  secretsMatch,
  setEnabledChannels,
  setWebhookSecret,
  uberSignatureOk,
  writeSetting,
} from "../services/deliveryOrder.js";

export const publicDeliveryRouter = Router();
export const deliveryRouter = Router();

async function resolveStore(slugOrId: string) {
  return prisma.store.findFirst({
    where: { OR: [{ slug: slugOrId }, { id: slugOrId }] },
  });
}

function publicBase(req: Request) {
  return (
    process.env.PUBLIC_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    `${req.protocol}://${req.get("host")}`
  ).replace(/\/$/, "");
}

function webhookUrls(req: Request, slug: string) {
  const base = `${publicBase(req)}/api/public/delivery`;
  return {
    normalized: `${base}/ingest/${slug}`,
    channels: Object.fromEntries(
      DELIVERY_CHANNELS.map((c) => [c, `${base}/${c}/stores/${slug}/orders`])
    ) as Record<DeliveryChannel, string>,
  };
}

const lineSchema = z.object({
  variantId: z.string().optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  name: z.string().optional(),
  quantity: z.number().positive().default(1),
  unitPriceCents: z.number().int().optional(),
  modifiers: z.array(z.object({ name: z.string(), priceCents: z.number().int() })).optional(),
  note: z.string().optional(),
});

const normalizedSchema = z.object({
  externalOrderId: z.string().optional(),
  customerName: z.string().min(1),
  customerPhone: z.string().optional(),
  customerEmail: z.string().email().optional().or(z.literal("")),
  fulfillment: z.enum(["pickup", "dine_in", "delivery"]).default("delivery"),
  deliveryAddress: z.string().optional(),
  note: z.string().optional(),
  deliveryFeeCents: z.number().int().nonnegative().optional(),
  paidByPlatform: z.boolean().optional(),
  lines: z.array(lineSchema).min(1),
  partnerMeta: z.record(z.unknown()).optional(),
  channel: z.enum(DELIVERY_CHANNELS).optional(),
});

async function assertDeliveryAllowed(storeId: string, res: Response) {
  if (!(await storeAllowsFeature(storeId, "online_ordering"))) {
    res.status(402).json({
      error: "Delivery apps need Complete or Multi (online ordering / kitchen). Upgrade in Billing.",
    });
    return false;
  }
  return true;
}

async function authorizeWebhook(req: Request, storeId: string, channel: DeliveryChannel) {
  const storeSecret = await getWebhookSecret(storeId);
  const headerSecret =
    (typeof req.headers["x-purepos-delivery-secret"] === "string"
      ? req.headers["x-purepos-delivery-secret"]
      : undefined) ||
    (typeof req.headers["x-webhook-secret"] === "string" ? req.headers["x-webhook-secret"] : undefined);

  if (storeSecret && secretsMatch(headerSecret, storeSecret)) return { ok: true as const };

  if (channel === "ubereats") {
    const clientSecret = await readSetting(storeId, "delivery.ubereats.clientSecret");
    const sig = typeof req.headers["x-uber-signature"] === "string" ? req.headers["x-uber-signature"] : undefined;
    const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
    if (clientSecret && uberSignatureOk(raw, sig, clientSecret)) return { ok: true as const };
    if (!storeSecret && !clientSecret) {
      return {
        ok: false as const,
        error:
          "Set a PurePOS delivery webhook secret (or Uber client secret) in Back office → Kitchen / Delivery apps before accepting Uber Eats webhooks.",
      };
    }
  }

  if (!storeSecret) {
    return {
      ok: false as const,
      error:
        "Set delivery.webhookSecret in Back office → Kitchen / Delivery apps, then send header X-PurePOS-Delivery-Secret.",
    };
  }
  return { ok: false as const, error: "Invalid delivery webhook secret" };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pickString(...vals: unknown[]) {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function pickNumber(...vals: unknown[]) {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  }
  return undefined;
}

function normalizePartnerPayload(channel: DeliveryChannel, body: unknown): z.infer<typeof normalizedSchema> | { error: string } {
  const root = asRecord(body);

  // Already PurePOS-shaped
  const direct = normalizedSchema.safeParse(body);
  if (direct.success) return direct.data;

  if (channel === "ubereats") {
    const order = asRecord(root.order ?? root.meta ?? root);
    const eater = asRecord(order.eater ?? order.customer ?? root.eater);
    const cart = asRecord(order.cart ?? order);
    const items = Array.isArray(cart.items)
      ? cart.items
      : Array.isArray(order.items)
        ? order.items
        : Array.isArray(root.items)
          ? root.items
          : [];
    const lines: IngestLine[] = items.map((raw) => {
      const it = asRecord(raw);
      const price = asRecord(it.price ?? it.unit_price ?? {});
      const cents =
        pickNumber(it.unitPriceCents, it.price_cents, price.amount, it.price) ??
        (typeof it.price === "number" && it.price < 1000 ? Math.round(it.price * 100) : undefined);
      return {
        sku: pickString(it.external_data, it.sku, it.id) || undefined,
        name: pickString(it.title, it.name, "Item") || "Item",
        quantity: pickNumber(it.quantity) ?? 1,
        unitPriceCents: cents,
        note: pickString(it.special_instructions, it.note) || undefined,
      };
    });
    if (!lines.length) return { error: "Uber payload has no items — send PurePOS normalized lines or cart.items" };
    return {
      externalOrderId:
        pickString(order.id, root.resource_id, root.order_id, asRecord(root.meta).resource_id) || undefined,
      customerName: pickString(eater.first_name, eater.name, root.customerName, "Uber Eats guest") || "Uber Eats guest",
      customerPhone: pickString(eater.phone, eater.phone_code) || undefined,
      fulfillment: "delivery",
      deliveryAddress: pickString(
        asRecord(order.current_state).toString(),
        asRecord(order.delivery).address,
        asRecord(asRecord(order.eater_delivery).location).address,
        root.deliveryAddress
      ) || undefined,
      note: pickString(order.special_instructions, root.note) || undefined,
      lines,
      paidByPlatform: true,
      partnerMeta: { event_type: root.event_type, resource_href: root.resource_href },
    };
  }

  if (channel === "deliveroo") {
    const order = asRecord(root.order ?? root.body ?? root);
    const customer = asRecord(order.customer ?? order.consumer);
    const items = Array.isArray(order.items) ? order.items : Array.isArray(root.items) ? root.items : [];
    const lines: IngestLine[] = items.map((raw) => {
      const it = asRecord(raw);
      return {
        sku: pickString(it.pos_item_id, it.sku, it.id) || undefined,
        name: pickString(it.name, it.menu_name, "Item") || "Item",
        quantity: pickNumber(it.quantity) ?? 1,
        unitPriceCents: pickNumber(
          it.unitPriceCents,
          asRecord(it.unit_price).amount,
          asRecord(it.price).amount,
          it.price
        ),
        note: pickString(it.notes, it.note) || undefined,
      };
    });
    if (!lines.length) return { error: "Deliveroo payload has no items — map menu POS IDs to PurePOS SKUs" };
    return {
      externalOrderId: pickString(order.id, order.order_id, root.id) || undefined,
      customerName: pickString(customer.name, customer.first_name, "Deliveroo guest") || "Deliveroo guest",
      customerPhone: pickString(customer.contact_number, customer.phone) || undefined,
      fulfillment: pickString(order.order_type, order.fulfillment) === "collection" ? "pickup" : "delivery",
      deliveryAddress: pickString(asRecord(order.delivery).address, asRecord(order.delivery_address).address_line_1) || undefined,
      note: pickString(order.notes, order.cutlery_notes, root.note) || undefined,
      lines,
      paidByPlatform: true,
      partnerMeta: { status: order.status, event: root.event },
    };
  }

  if (channel === "justeat") {
    const order = asRecord(root.Order ?? root.order ?? root);
    const customer = asRecord(order.Customer ?? order.customer);
    const items = Array.isArray(order.Items ?? order.items ?? order.products)
      ? ((order.Items ?? order.items ?? order.products) as unknown[])
      : [];
    const lines: IngestLine[] = items.map((raw) => {
      const it = asRecord(raw);
      return {
        sku: pickString(it.Sku, it.sku, it.Plu, it.plu, it.Id) || undefined,
        name: pickString(it.Name, it.name, "Item") || "Item",
        quantity: pickNumber(it.Quantity, it.quantity) ?? 1,
        unitPriceCents: pickNumber(it.UnitPriceCents, it.unitPriceCents, it.Price, it.price),
        note: pickString(it.CustomerNotes, it.note) || undefined,
      };
    });
    if (!lines.length) return { error: "Just Eat payload has no items" };
    return {
      externalOrderId: pickString(order.Id, order.OrderId, order.id, root.id) || undefined,
      customerName: pickString(customer.Name, customer.name, "Just Eat guest") || "Just Eat guest",
      customerPhone: pickString(customer.PhoneNumber, customer.phone) || undefined,
      fulfillment: "delivery",
      deliveryAddress: pickString(
        asRecord(order.DeliveryAddress).formattedAddress,
        asRecord(order.deliveryAddress).line1,
        root.deliveryAddress
      ) || undefined,
      note: pickString(order.Notes, order.note) || undefined,
      lines,
      paidByPlatform: true,
      partnerMeta: { source: "justeat" },
    };
  }

  if (channel === "hungrypanda" || channel === "foodhub" || channel === "generic") {
    const order = asRecord(root.order ?? root.data ?? root);
    const customer = asRecord(order.customer ?? root.customer);
    const items = Array.isArray(order.items ?? order.lines ?? root.items ?? root.lines)
      ? ((order.items ?? order.lines ?? root.items ?? root.lines) as unknown[])
      : [];
    const lines: IngestLine[] = items.map((raw) => {
      const it = asRecord(raw);
      return {
        sku: pickString(it.sku, it.shopSku, it.productId, it.id) || undefined,
        barcode: pickString(it.barcode) || undefined,
        name: pickString(it.name, it.productName, "Item") || "Item",
        quantity: pickNumber(it.quantity, it.qty) ?? 1,
        unitPriceCents: pickNumber(it.unitPriceCents, it.priceCents, it.price),
        note: pickString(it.note, it.remark) || undefined,
      };
    });
    if (!lines.length) {
      return {
        error: `${CHANNEL_LABELS[channel]} payload needs items/lines (or PurePOS normalized body)`,
      };
    }
    return {
      externalOrderId: pickString(order.orderId, order.id, root.orderId, root.id) || undefined,
      customerName: pickString(customer.name, order.customerName, root.customerName, `${CHANNEL_LABELS[channel]} guest`) ||
        `${CHANNEL_LABELS[channel]} guest`,
      customerPhone: pickString(customer.phone, order.phone) || undefined,
      fulfillment: "delivery",
      deliveryAddress: pickString(order.address, order.deliveryAddress, root.deliveryAddress) || undefined,
      note: pickString(order.note, order.remark, root.note) || undefined,
      lines,
      paidByPlatform: true,
      partnerMeta: { channel },
    };
  }

  return { error: "Unrecognized delivery payload" };
}

async function handleIngest(
  req: Request,
  res: Response,
  storeSlug: string,
  channel: DeliveryChannel,
  body: unknown
) {
  const store = await resolveStore(storeSlug);
  if (!store) return res.status(404).json({ error: "Store not found" });
  if (!(await assertDeliveryAllowed(store.id, res))) return;

  const auth = await authorizeWebhook(req, store.id, channel);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const normalized = normalizePartnerPayload(channel, body);
  if ("error" in normalized) return res.status(400).json({ error: normalized.error });

  const parsed = normalizedSchema.parse({ ...normalized, channel });
  const result = await injectDeliveryOrder({
    storeId: store.id,
    channel: parsed.channel ?? channel,
    externalOrderId: parsed.externalOrderId,
    customerName: parsed.customerName,
    customerPhone: parsed.customerPhone,
    customerEmail: parsed.customerEmail || null,
    fulfillment: parsed.fulfillment,
    deliveryAddress: parsed.deliveryAddress,
    note: parsed.note,
    deliveryFeeCents: parsed.deliveryFeeCents,
    paidByPlatform: parsed.paidByPlatform,
    lines: parsed.lines,
    partnerMeta: parsed.partnerMeta,
  });

  if ("error" in result) {
    return res.status(result.status ?? 400).json({ error: result.error });
  }
  return res.status(result.duplicate ? 200 : 201).json({
    ok: true,
    duplicate: result.duplicate,
    channel: parsed.channel ?? channel,
    order: result.order,
    ticketId: result.ticketId,
    message: result.duplicate
      ? "Order already in kitchen queue"
      : `${CHANNEL_LABELS[parsed.channel ?? channel]} order sent to kitchen`,
  });
}

/** Normalized PurePOS ingest (middleware / Deliverect-style / demos). */
publicDeliveryRouter.post("/ingest/:slug", async (req, res) => {
  const channelRaw = typeof req.body?.channel === "string" ? req.body.channel : "generic";
  const channel: DeliveryChannel = isDeliveryChannel(channelRaw) ? channelRaw : "generic";
  await handleIngest(req, res, req.params.slug, channel, req.body);
});

/** Per-channel webhook endpoints partners can point at. */
publicDeliveryRouter.post("/:channel/stores/:slug/orders", async (req, res) => {
  const channel = req.params.channel;
  if (!isDeliveryChannel(channel)) {
    return res.status(404).json({ error: `Unknown channel. Use: ${DELIVERY_CHANNELS.join(", ")}` });
  }
  await handleIngest(req, res, req.params.slug, channel, req.body);
});

/** Uber-style single webhook URL: body must include store slug or store_id mapping. */
publicDeliveryRouter.post("/:channel/webhook", async (req, res) => {
  const channel = req.params.channel;
  if (!isDeliveryChannel(channel)) {
    return res.status(404).json({ error: `Unknown channel. Use: ${DELIVERY_CHANNELS.join(", ")}` });
  }
  const root = asRecord(req.body);
  const slug =
    pickString(req.query.store, root.storeSlug, root.store_slug, asRecord(root.meta).storeSlug) ||
    pickString(root.storeId, root.store_id);
  if (!slug) {
    // Acknowledge Uber ping without injecting — partner must pass ?store=slug
    return res.status(202).json({
      ok: true,
      accepted: false,
      message: `Add ?store=your-store-slug to the webhook URL, or include storeSlug in the body. Example: /api/public/delivery/${channel}/webhook?store=demo-cafe`,
    });
  }
  await handleIngest(req, res, slug, channel, req.body);
});

deliveryRouter.use(requireAuth);

deliveryRouter.get("/config", async (req: AuthedRequest, res) => {
  const storeId = req.user!.storeId;
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const enabled = await getEnabledChannels(storeId);
  const secret = await getWebhookSecret(storeId);
  const urls = webhookUrls(req, store.slug);
  const channels = await Promise.all(
    DELIVERY_CHANNELS.map(async (id) => ({
      id,
      label: CHANNEL_LABELS[id],
      enabled: enabled.includes(id),
      webhookUrl: urls.channels[id],
      partnerRestaurantId: await readSetting(storeId, `delivery.${id}.restaurantId`),
      hasClientSecret: Boolean(await readSetting(storeId, `delivery.${id}.clientSecret`)),
    }))
  );
  res.json({
    store: { id: store.id, slug: store.slug, name: store.name },
    enabledChannels: enabled,
    channels,
    normalizedIngestUrl: urls.normalized,
    webhookSecretSet: Boolean(secret),
    credentialsNeeded: {
      purepos: ["delivery.webhookSecret (BO) — send as X-PurePOS-Delivery-Secret"],
      justeat: ["JET Connect partner onboarding", "Restaurant / POS mapping", "Optional: delivery.justeat.restaurantId"],
      deliveroo: [
        "Deliveroo Developer portal OAuth client",
        "Order Events webhook → PurePOS URL",
        "Site ID as delivery.deliveroo.restaurantId",
      ],
      ubereats: [
        "Uber Eats Marketplace app Client ID + Client Secret",
        "Primary webhook URL → PurePOS (append ?store=slug)",
        "Store delivery.ubereats.clientSecret for X-Uber-Signature checks",
      ],
      hungrypanda: ["App Key", "Secret Key", "ShopID (from HungryPanda — partner issued, no public portal)"],
      foodhub: ["Foodhub partner / integrator credentials", "Store ID mapping"],
      generic: ["Any middleware (Deliverect, Otter, etc.) posting PurePOS normalized JSON"],
    },
  });
});

deliveryRouter.put("/config", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      enabledChannels: z.array(z.enum(DELIVERY_CHANNELS)).optional(),
      webhookSecret: z.string().min(8).max(200).optional().nullable(),
      restaurantIds: z.record(z.string()).optional(),
      clientSecrets: z.record(z.string()).optional(),
    })
    .parse(req.body);

  const storeId = req.user!.storeId;
  if (body.enabledChannels) await setEnabledChannels(storeId, body.enabledChannels);
  if (body.webhookSecret !== undefined) {
    if (body.webhookSecret === null || body.webhookSecret === "") await setWebhookSecret(storeId, "");
    else await setWebhookSecret(storeId, body.webhookSecret);
  }
  if (body.restaurantIds) {
    for (const [channel, value] of Object.entries(body.restaurantIds)) {
      if (!isDeliveryChannel(channel)) continue;
      await writeSetting(storeId, `delivery.${channel}.restaurantId`, value);
    }
  }
  if (body.clientSecrets) {
    for (const [channel, value] of Object.entries(body.clientSecrets)) {
      if (!isDeliveryChannel(channel)) continue;
      await writeSetting(storeId, `delivery.${channel}.clientSecret`, value);
    }
  }

  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  res.json({
    ok: true,
    enabledChannels: await getEnabledChannels(storeId),
    webhookSecretSet: Boolean(await getWebhookSecret(storeId)),
    urls: webhookUrls(req, store.slug),
  });
});

/** Demo / pilot: push a sample marketplace order into kitchen without partner APIs. */
deliveryRouter.post("/simulate", requireRole("owner", "manager"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      channel: z.enum(DELIVERY_CHANNELS).default("deliveroo"),
      customerName: z.string().optional(),
      itemName: z.string().optional(),
    })
    .parse(req.body ?? {});

  const storeId = req.user!.storeId;
  if (!(await assertDeliveryAllowed(storeId, res))) return;

  const item = body.itemName
    ? await prisma.item.findFirst({
        where: { storeId, active: true, name: { contains: body.itemName } },
        include: { variants: { where: { active: true }, take: 1 } },
      })
    : await prisma.item.findFirst({
        where: { storeId, active: true },
        include: { variants: { where: { active: true }, take: 1 } },
        orderBy: { name: "asc" },
      });
  const variant = item?.variants[0];
  if (!variant || !item) return res.status(400).json({ error: "No active items to simulate with" });

  const result = await injectDeliveryOrder({
    storeId,
    channel: body.channel,
    externalOrderId: `sim-${body.channel}-${Date.now()}`,
    customerName: body.customerName || `${CHANNEL_LABELS[body.channel]} Guest`,
    customerPhone: "07000000000",
    fulfillment: "delivery",
    deliveryAddress: "14 Example Street, London, E1 6AN",
    note: "Simulated marketplace order (no partner API call)",
    deliveryFeeCents: 0,
    paidByPlatform: true,
    lines: [
      {
        variantId: variant.id,
        name: item.name,
        quantity: 1,
        unitPriceCents: variant.priceCents,
      },
    ],
    partnerMeta: { simulated: true },
  });

  if ("error" in result) {
    return res.status(result.status ?? 400).json({ error: result.error });
  }
  res.status(201).json({
    ok: true,
    message: `${CHANNEL_LABELS[body.channel]} simulation → kitchen`,
    order: result.order,
    ticketId: result.ticketId,
  });
});

/** Express error passthrough for async zod */
deliveryRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "ZodError") {
    return res.status(400).json({ error: "Validation error", details: err });
  }
  return next(err);
});
