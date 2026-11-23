import { z } from "zod";
import { prisma } from "../db.js";
import { writeSetting } from "./deliveryOrder.js";

/** Per-store online ordering setup, stored as one JSON Setting row. */
const SETTINGS_KEY = "ordering.settings";

export const orderingSettingsSchema = z.object({
  pickupEnabled: z.boolean(),
  dineInEnabled: z.boolean(),
  deliveryEnabled: z.boolean(),
  prepMinutes: z.number().int().min(1).max(180),
  deliveryMinutes: z.number().int().min(5).max(240),
  deliveryFeeCents: z.number().int().min(0).max(5000),
  freeDeliveryAboveCents: z.number().int().min(0).max(100000),
  /** ISO time online orders resume; "" = taking orders, "off" = paused until someone resumes. */
  pausedUntil: z.string(),
});

export type OrderingSettings = z.infer<typeof orderingSettingsSchema>;

export const ORDERING_DEFAULTS: OrderingSettings = {
  pickupEnabled: true,
  dineInEnabled: true,
  deliveryEnabled: true,
  prepMinutes: 15,
  deliveryMinutes: 30,
  deliveryFeeCents: 399,
  freeDeliveryAboveCents: 3000,
  pausedUntil: "",
};

export async function readOrderingSettings(storeId: string): Promise<OrderingSettings> {
  const row = await prisma.setting.findUnique({ where: { storeId_key: { storeId, key: SETTINGS_KEY } } });
  if (!row?.value) return { ...ORDERING_DEFAULTS };
  try {
    const parsed = orderingSettingsSchema.partial().safeParse(JSON.parse(row.value));
    return { ...ORDERING_DEFAULTS, ...(parsed.success ? parsed.data : {}) };
  } catch {
    return { ...ORDERING_DEFAULTS };
  }
}

export async function writeOrderingSettings(storeId: string, patch: Partial<OrderingSettings>) {
  const next = { ...(await readOrderingSettings(storeId)), ...patch };
  await writeSetting(storeId, SETTINGS_KEY, JSON.stringify(next));
  return next;
}

export function isPaused(settings: OrderingSettings, now = new Date()) {
  if (!settings.pausedUntil) return false;
  if (settings.pausedUntil === "off") return true;
  const until = Date.parse(settings.pausedUntil);
  return Number.isFinite(until) && until > now.getTime();
}

export type Fulfillment = "pickup" | "dine_in" | "delivery";

export function fulfillmentEnabled(settings: OrderingSettings, fulfillment: Fulfillment) {
  if (fulfillment === "delivery") return settings.deliveryEnabled;
  if (fulfillment === "dine_in") return settings.dineInEnabled;
  return settings.pickupEnabled;
}

/** Minutes from order to ready (pickup / dine in) or to the door (delivery). */
export function estimateMinutes(settings: OrderingSettings, fulfillment: Fulfillment) {
  return fulfillment === "delivery" ? settings.prepMinutes + settings.deliveryMinutes : settings.prepMinutes;
}

export function estimateLabel(settings: OrderingSettings, fulfillment: Fulfillment) {
  const m = estimateMinutes(settings, fulfillment);
  return `${m}–${m + 10} min`;
}

export function deliveryFeeFor(settings: OrderingSettings, subtotalCents: number) {
  return subtotalCents >= settings.freeDeliveryAboveCents ? 0 : settings.deliveryFeeCents;
}

/** Public, customer-safe view of the settings for the menu endpoint. */
export function publicOrderingInfo(settings: OrderingSettings) {
  const paused = isPaused(settings);
  const fulfillments = (["pickup", "dine_in", "delivery"] as const).filter((f) => fulfillmentEnabled(settings, f));
  return {
    open: !paused && fulfillments.length > 0,
    paused,
    pausedUntil: paused && settings.pausedUntil !== "off" ? settings.pausedUntil : null,
    fulfillments,
    estimates: {
      pickup: estimateLabel(settings, "pickup"),
      dine_in: estimateLabel(settings, "dine_in"),
      delivery: estimateLabel(settings, "delivery"),
    },
  };
}
