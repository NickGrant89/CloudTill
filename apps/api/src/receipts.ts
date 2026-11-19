import {
  buildEscPosBytes,
  buildReceiptHtml,
  buildReceiptText,
  drawerKickBytes,
  type ReceiptData,
} from "@cloudtill/shared";
import { prisma } from "./db.js";

export async function loadReceiptData(saleId: string): Promise<ReceiptData> {
  const sale = await prisma.sale.findUniqueOrThrow({
    where: { id: saleId },
    include: {
      lines: true,
      payments: true,
      employee: true,
      customer: true,
      register: true,
      store: true,
    },
  });
  const settings = await prisma.setting.findMany({ where: { storeId: sale.storeId } });
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));

  return {
    header: map["receipt.header"] ?? sale.store.name,
    footer: map["receipt.footer"] ?? "Thank you!",
    receiptNumber: sale.receiptNumber,
    storeName: sale.store.name,
    registerName: sale.register.name,
    employeeName: sale.employee.name,
    customerName: sale.customer?.name ?? null,
    lines: sale.lines.map((l) => {
      let modifiers: string[] = [];
      try {
        modifiers = (JSON.parse(l.modifiersJson) as { name: string }[]).map((m) => m.name);
      } catch {
        /* ignore */
      }
      return {
        name: l.name,
        quantity: l.quantity,
        totalCents: l.totalCents,
        modifiers,
      };
    }),
    subtotalCents: sale.subtotalCents,
    discountCents: sale.discountCents,
    taxCents: sale.taxCents,
    tipCents: sale.tipCents,
    totalCents: sale.totalCents,
    changeCents: sale.changeCents,
    payments: sale.payments.map((p) => ({
      paymentTypeName: p.paymentTypeName,
      amountCents: p.amountCents,
    })),
    createdAt: sale.createdAt.toISOString(),
    currencySymbol: sale.store.currency === "GBP" ? "£" : sale.store.currency === "USD" ? "$" : sale.store.currency === "EUR" ? "€" : sale.store.currency,
  };
}

export function renderReceipt(
  data: ReceiptData,
  format: "text" | "html" | "escpos" | "escpos-base64"
): { contentType: string; body: string | Buffer } {
  if (format === "html") {
    return { contentType: "text/html; charset=utf-8", body: buildReceiptHtml(data) };
  }
  if (format === "escpos") {
    return { contentType: "application/vnd.escpos", body: Buffer.from(buildEscPosBytes(data)) };
  }
  if (format === "escpos-base64") {
    return {
      contentType: "application/json",
      body: JSON.stringify({
        format: "escpos",
        encoding: "base64",
        width: 80,
        data: Buffer.from(buildEscPosBytes(data)).toString("base64"),
        drawerKickBase64: Buffer.from(drawerKickBytes()).toString("base64"),
        textPreview: buildReceiptText(data),
      }),
    };
  }
  return { contentType: "text/plain; charset=utf-8", body: buildReceiptText(data) };
}
