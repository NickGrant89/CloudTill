/** Print-friendly receipt builders: plain text, HTML, and ESC/POS byte pipeline */

export interface ReceiptLine {
  name: string;
  quantity: number;
  totalCents: number;
  modifiers?: string[];
}

export interface ReceiptPayment {
  paymentTypeName: string;
  amountCents: number;
}

export interface ReceiptData {
  header: string;
  footer: string;
  receiptNumber: string;
  storeName: string;
  registerName?: string;
  employeeName: string;
  customerName?: string | null;
  lines: ReceiptLine[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  changeCents?: number;
  payments: ReceiptPayment[];
  createdAt: string;
  currencySymbol?: string;
}

export function formatMoney(cents: number, symbol = "$"): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}${symbol}${(Math.abs(cents) / 100).toFixed(2)}`;
}

function padLine(left: string, right: string, width = 32): string {
  const space = Math.max(1, width - left.length - right.length);
  return left + " ".repeat(space) + right;
}

export function buildReceiptText(data: ReceiptData, width = 32): string {
  const $ = (c: number) => formatMoney(c, data.currencySymbol ?? "$");
  const lines: string[] = [
    data.header || data.storeName,
    "-".repeat(width),
    `Receipt ${data.receiptNumber}`,
    `Cashier: ${data.employeeName}`,
  ];
  if (data.registerName) lines.push(`Register: ${data.registerName}`);
  if (data.customerName) lines.push(`Customer: ${data.customerName}`);
  lines.push(new Date(data.createdAt).toLocaleString());
  lines.push("-".repeat(width));
  for (const line of data.lines) {
    lines.push(padLine(`${line.quantity} x ${line.name}`.slice(0, width - 8), $(line.totalCents), width));
    for (const m of line.modifiers ?? []) {
      lines.push(`  + ${m}`.slice(0, width));
    }
  }
  lines.push("-".repeat(width));
  lines.push(padLine("Subtotal", $(data.subtotalCents), width));
  if (data.discountCents) lines.push(padLine("Discount", $(-data.discountCents), width));
  lines.push(padLine("Tax", $(data.taxCents), width));
  if (data.tipCents) lines.push(padLine("Tip", $(data.tipCents), width));
  lines.push(padLine("TOTAL", $(data.totalCents), width));
  for (const p of data.payments) {
    lines.push(padLine(p.paymentTypeName, $(p.amountCents), width));
  }
  if (data.changeCents && data.changeCents > 0) {
    lines.push(padLine("Change", $(data.changeCents), width));
  }
  lines.push("-".repeat(width));
  lines.push(data.footer || "Thank you!");
  return lines.join("\n");
}

export function buildReceiptHtml(data: ReceiptData): string {
  const text = buildReceiptText(data);
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Receipt ${data.receiptNumber}</title>
  <style>
    @page { size: 80mm auto; margin: 4mm; }
    body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; margin: 0; color: #111; }
    .ticket { width: 72mm; margin: 0 auto; white-space: pre-wrap; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  <p class="no-print" style="text-align:center;font-family:system-ui">
    <button onclick="window.print()">Print</button>
  </p>
  <pre class="ticket">${escaped}</pre>
</body>
</html>`;
}

/** ESC/POS command builders for 80mm thermal printers (and network/USB bridges). */
export function buildEscPosBytes(data: ReceiptData): Uint8Array {
  const chunks: number[] = [];
  const enc = new TextEncoder();
  const push = (bytes: ArrayLike<number>) => {
    for (let i = 0; i < bytes.length; i++) chunks.push(bytes[i]!);
  };
  const cmd = (...b: number[]) => push(b);
  const text = (s: string) => push(enc.encode(s));

  // Init
  cmd(0x1b, 0x40);
  // Center align + double height header
  cmd(0x1b, 0x61, 0x01);
  cmd(0x1d, 0x21, 0x11);
  text((data.header || data.storeName) + "\n");
  cmd(0x1d, 0x21, 0x00);
  cmd(0x1b, 0x61, 0x00);
  text(buildReceiptText(data) + "\n\n");
  // Cut (partial)
  cmd(0x1d, 0x56, 0x01);
  // Optional cash drawer pulse (pin 2)
  // cmd(0x1b, 0x70, 0x00, 0x19, 0xfa);

  return Uint8Array.from(chunks);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  if (typeof btoa === "function") return btoa(binary);
  // Node without DOM btoa
  const g = globalThis as { Buffer?: { from: (b: Uint8Array) => { toString: (e: string) => string } } };
  if (g.Buffer) return g.Buffer.from(bytes).toString("base64");
  throw new Error("No base64 encoder available");
}

export function escPosToBase64(data: ReceiptData): string {
  return bytesToBase64(buildEscPosBytes(data));
}

export function drawerKickBytes(): Uint8Array {
  // ESC p m t1 t2 — open cash drawer
  return Uint8Array.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);
}
