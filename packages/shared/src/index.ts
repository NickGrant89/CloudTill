/** Shared PurePOS domain types & constants (repo may still be named CloudTill). */

export * from "./brand.js";
export * from "./catalogSort.js";
export * from "./modifierPricing.js";
export * from "./pizzaTill.js";
export * from "./pizzaHalfAndHalfWizard.js";
export * from "./textPayMessage.js";

export const ROLES = ["owner", "manager", "cashier"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  owner: ["*"],
  manager: [
    "pos",
    "shifts",
    "catalog",
    "inventory",
    "customers",
    "employees.read",
    "sales",
    "reports",
    "settings.receipt",
    "void",
    "refund",
    "discount",
  ],
  cashier: ["pos", "shifts", "customers.read", "sales.read"],
};

export type MoneyCents = number;

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  storeId: string;
  pin: string;
}

export interface StoreSummary {
  id: string;
  name: string;
  address?: string | null;
  currency: string;
  timezone: string;
}

export interface RegisterSummary {
  id: string;
  name: string;
  storeId: string;
}

export interface CategoryDto {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
}

export interface ModifierDto {
  id: string;
  name: string;
  priceCents: MoneyCents;
}

export interface ModifierGroupDto {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  /** Priced options included at £0 before extras are charged (per group). */
  freeSelect: number;
  modifiers: ModifierDto[];
}

export interface VariantDto {
  id: string;
  name: string;
  sku: string;
  barcode?: string | null;
  priceCents: MoneyCents;
  costCents: MoneyCents;
  trackStock: boolean;
  stockQty: number;
}

export interface ItemDto {
  id: string;
  name: string;
  description?: string | null;
  categoryId?: string | null;
  color: string;
  imageUrl?: string | null;
  soldBy: "each" | "weight";
  isComposite: boolean;
  variants: VariantDto[];
  modifierGroups: ModifierGroupDto[];
}

export interface CustomerDto {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  note?: string | null;
  loyaltyPoints: number;
  storeCreditCents: MoneyCents;
  totalSpentCents: MoneyCents;
  visitCount: number;
}

export interface CartLineModifier {
  modifierId: string;
  name: string;
  priceCents: MoneyCents;
}

export interface CartLine {
  key: string;
  variantId: string;
  itemId: string;
  name: string;
  quantity: number;
  unitPriceCents: MoneyCents;
  modifiers: CartLineModifier[];
  discountCents: MoneyCents;
  note?: string;
}

export interface TicketDto {
  id: string;
  name: string;
  status: "open" | "held" | "paid" | "voided" | "refunded";
  lines: CartLine[];
  customerId?: string | null;
  discountCents: MoneyCents;
  discountPercent: number;
  tipCents: MoneyCents;
  taxCents: MoneyCents;
  subtotalCents: MoneyCents;
  totalCents: MoneyCents;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentInput {
  paymentTypeId: string;
  amountCents: MoneyCents;
  tenderedCents?: MoneyCents;
}

export interface TaxDto {
  id: string;
  name: string;
  rateBps: number; // basis points, 1000 = 10%
  inclusive: boolean;
  enabled: boolean;
}

export interface PaymentTypeDto {
  id: string;
  name: string;
  type: "cash" | "card" | "other" | "store_credit";
  enabled: boolean;
  opensDrawer: boolean;
}

export interface ShiftDto {
  id: string;
  storeId: string;
  registerId: string;
  employeeId: string;
  employeeName: string;
  openedAt: string;
  closedAt?: string | null;
  openingFloatCents: MoneyCents;
  closingCashCents?: MoneyCents | null;
  expectedCashCents?: MoneyCents | null;
  differenceCents?: MoneyCents | null;
  note?: string | null;
  status: "open" | "closed";
}

export interface SaleDto {
  id: string;
  receiptNumber: string;
  storeId: string;
  registerId: string;
  employeeId: string;
  employeeName: string;
  customerId?: string | null;
  customerName?: string | null;
  status: "completed" | "voided" | "refunded" | "partial_refund";
  subtotalCents: MoneyCents;
  discountCents: MoneyCents;
  taxCents: MoneyCents;
  tipCents: MoneyCents;
  totalCents: MoneyCents;
  paidCents: MoneyCents;
  changeCents: MoneyCents;
  lines: Array<{
    id: string;
    name: string;
    quantity: number;
    unitPriceCents: MoneyCents;
    discountCents: MoneyCents;
    taxCents: MoneyCents;
    totalCents: MoneyCents;
    modifiersJson?: string | null;
  }>;
  payments: Array<{
    id: string;
    paymentTypeName: string;
    amountCents: MoneyCents;
    tenderedCents?: MoneyCents | null;
  }>;
  createdAt: string;
}

export interface ReceiptSettings {
  header: string;
  footer: string;
  showLogo: boolean;
  showTaxBreakdown: boolean;
}

export interface AppSettings {
  currency: string;
  currencySymbol: string;
  receipt: ReceiptSettings;
  tipPresetsPercent: number[];
}

export const DEFAULT_CURRENCY = "GBP";
export const DEFAULT_CURRENCY_SYMBOL = "£";
export const API_PREFIX = "/api";

export * from "./receipt.js";
export * from "./plans.js";
export * from "./planGates.js";

export interface GiftCardDto {
  id: string;
  code: string;
  balanceCents: MoneyCents;
  initialCents: MoneyCents;
  status: string;
  customerId?: string | null;
}

export interface InventoryTransferDto {
  id: string;
  fromStoreId: string;
  toStoreId: string;
  variantId: string;
  quantity: number;
  status: string;
  note?: string | null;
  createdAt: string;
}

export interface TimeClockEntryDto {
  id: string;
  employeeId: string;
  employeeName?: string;
  storeId: string;
  clockIn: string;
  clockOut?: string | null;
  note?: string | null;
}
