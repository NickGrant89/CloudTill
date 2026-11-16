import { useCallback, useEffect, useMemo, useState } from "react";
import { api, money } from "./api";
import type { SessionRegister, SessionStore, SessionUser } from "./App";

interface Category {
  id: string;
  name: string;
  color: string;
}

interface Modifier {
  id: string;
  name: string;
  priceCents: number;
}

interface ModGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: Modifier[];
}

interface Item {
  id: string;
  name: string;
  color: string;
  categoryId: string | null;
  isComposite: boolean;
  variants: {
    id: string;
    name: string;
    sku: string;
    barcode: string | null;
    priceCents: number;
    stockQty: number;
    trackStock: boolean;
  }[];
  modifierGroups: ModGroup[];
}

interface TicketLine {
  key: string;
  variantId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  modifiers: { name: string; priceCents: number; modifierId?: string }[];
}

interface Ticket {
  id: string;
  name: string;
  status: string;
  customerId: string | null;
  customer?: { id: string; name: string; loyaltyPoints: number; storeCreditCents: number } | null;
  lines: TicketLine[];
  discountCents: number;
  discountPercent: number;
  tipCents: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

interface PaymentType {
  id: string;
  name: string;
  type: string;
  opensDrawer: boolean;
}

interface Customer {
  id: string;
  name: string;
  phone?: string | null;
  loyaltyPoints: number;
  storeCreditCents: number;
}

interface Props {
  user: SessionUser;
  store: SessionStore;
  registers: SessionRegister[];
  registerId: string;
  onRegisterChange: (id: string) => void;
  onLogout: () => void;
}

type Modal =
  | null
  | { type: "modifiers"; item: Item }
  | { type: "pay" }
  | { type: "held" }
  | { type: "customers" }
  | { type: "discount" }
  | { type: "tip" }
  | { type: "receipt"; text: string; changeCents: number }
  | { type: "shift" }
  | { type: "message"; title: string; body: string };

export function Register({ user, store, registers, registerId, onRegisterChange, onLogout }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [categoryId, setCategoryId] = useState<string | "all">("all");
  const [query, setQuery] = useState("");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [paymentTypes, setPaymentTypes] = useState<PaymentType[]>([]);
  const [settings, setSettings] = useState<{ receipt: { header: string; footer: string }; tipPresetsPercent: number[] } | null>(null);
  const [shift, setShift] = useState<{ id: string; openingFloatCents: number } | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [held, setHeld] = useState<Ticket[]>([]);
  const [payAmounts, setPayAmounts] = useState<Record<string, number>>({});
  const [selectedMods, setSelectedMods] = useState<Record<string, Modifier[]>>({});
  const [busy, setBusy] = useState(false);

  const loadCatalog = useCallback(async () => {
    const [cats, its, pts, sett, curShift] = await Promise.all([
      api<Category[]>("/catalog/categories"),
      api<Item[]>("/catalog/items"),
      api<PaymentType[]>("/pos/payment-types"),
      api<{ receipt: { header: string; footer: string }; tipPresetsPercent: number[] }>("/settings"),
      api<{ id: string; openingFloatCents: number } | null>(`/shifts/current?registerId=${registerId}`),
    ]);
    setCategories(cats);
    setItems(its);
    setPaymentTypes(pts);
    setSettings(sett);
    setShift(curShift);
  }, [registerId]);

  const ensureTicket = useCallback(async () => {
    if (ticket) return ticket;
    const t = await api<Ticket>("/pos/tickets", {
      method: "POST",
      body: JSON.stringify({ registerId, name: "Sale" }),
    });
    setTicket(t);
    return t;
  }, [ticket, registerId]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    setTicket(null);
  }, [registerId]);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (categoryId !== "all" && item.categoryId !== categoryId) return false;
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        item.variants.some(
          (v) => v.sku.toLowerCase().includes(q) || (v.barcode && v.barcode.includes(query.trim()))
        )
      );
    });
  }, [items, categoryId, query]);

  async function addItem(item: Item) {
    if (item.modifierGroups.length > 0) {
      const initial: Record<string, Modifier[]> = {};
      for (const g of item.modifierGroups) {
        if (g.minSelect > 0 && g.modifiers[0]) initial[g.id] = [g.modifiers[0]];
        else initial[g.id] = [];
      }
      setSelectedMods(initial);
      setModal({ type: "modifiers", item });
      return;
    }
    await addVariant(item, []);
  }

  async function addVariant(item: Item, modifiers: { modifierId?: string; name: string; priceCents: number }[]) {
    const t = await ensureTicket();
    const variant = item.variants[0];
    const updated = await api<Ticket>(`/pos/tickets/${t.id}/lines`, {
      method: "POST",
      body: JSON.stringify({ variantId: variant.id, quantity: 1, modifiers }),
    });
    setTicket(updated);
    setModal(null);
  }

  async function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || !query.trim()) return;
    const exact = items.find((it) => it.variants.some((v) => v.barcode === query.trim() || v.sku === query.trim()));
    if (exact) {
      setQuery("");
      await addItem(exact);
    }
  }

  async function updateQty(line: TicketLine, quantity: number) {
    if (!ticket) return;
    if (quantity <= 0) {
      const updated = await api<Ticket>(`/pos/tickets/${ticket.id}/lines/${line.key}`, { method: "DELETE" });
      setTicket(updated);
      return;
    }
    const updated = await api<Ticket>(`/pos/tickets/${ticket.id}/lines/${line.key}`, {
      method: "PATCH",
      body: JSON.stringify({ quantity }),
    });
    setTicket(updated);
  }

  async function holdTicket() {
    if (!ticket || ticket.lines.length === 0) return;
    await api(`/pos/tickets/${ticket.id}/hold`, { method: "POST" });
    setTicket(null);
  }

  async function openHeld() {
    const list = await api<Ticket[]>("/pos/tickets?status=held");
    setHeld(list);
    setModal({ type: "held" });
  }

  async function recall(id: string) {
    const t = await api<Ticket>(`/pos/tickets/${id}/recall`, { method: "POST" });
    setTicket(t);
    setModal(null);
  }

  async function openCustomers() {
    const list = await api<Customer[]>("/customers");
    setCustomers(list);
    setModal({ type: "customers" });
  }

  async function attachCustomer(c: Customer) {
    if (!ticket) await ensureTicket();
    const t = ticket ?? (await ensureTicket());
    const updated = await api<Ticket>(`/pos/tickets/${t.id}`, {
      method: "PATCH",
      body: JSON.stringify({ customerId: c.id }),
    });
    setTicket(updated);
    setModal(null);
  }

  async function applyDiscount(discountCents: number, discountPercent: number) {
    if (!ticket) return;
    const updated = await api<Ticket>(`/pos/tickets/${ticket.id}`, {
      method: "PATCH",
      body: JSON.stringify({ discountCents, discountPercent }),
    });
    setTicket(updated);
    setModal(null);
  }

  async function applyTip(tipCents: number) {
    if (!ticket) return;
    const updated = await api<Ticket>(`/pos/tickets/${ticket.id}`, {
      method: "PATCH",
      body: JSON.stringify({ tipCents }),
    });
    setTicket(updated);
    setModal(null);
  }

  async function openDrawer() {
    try {
      await api("/pos/drawer/open", {
        method: "POST",
        body: JSON.stringify({ registerId, note: "Manual open" }),
      });
      setModal({ type: "message", title: "Cash drawer", body: "Drawer open signal sent." });
    } catch (e) {
      setModal({ type: "message", title: "Cash drawer", body: e instanceof Error ? e.message : "Failed" });
    }
  }

  function openPay() {
    if (!ticket || ticket.lines.length === 0) return;
    const cash = paymentTypes.find((p) => p.type === "cash");
    setPayAmounts(cash ? { [cash.id]: ticket.totalCents } : {});
    setModal({ type: "pay" });
  }

  async function completePay() {
    if (!ticket) return;
    const payments = Object.entries(payAmounts)
      .filter(([, amt]) => amt > 0)
      .map(([paymentTypeId, amountCents]) => {
        const pt = paymentTypes.find((p) => p.id === paymentTypeId);
        return {
          paymentTypeId,
          amountCents,
          tenderedCents: pt?.type === "cash" ? amountCents : undefined,
        };
      });
    if (!payments.length) return;
    setBusy(true);
    try {
      const result = await api<{
        sale: {
          receiptNumber: string;
          totalCents: number;
          taxCents: number;
          tipCents: number;
          discountCents: number;
          subtotalCents: number;
          changeCents: number;
          lines: { name: string; quantity: number; totalCents: number }[];
          payments: { paymentTypeName: string; amountCents: number }[];
          employeeName: string;
          customerName: string | null;
        };
        changeCents: number;
        drawerOpened: boolean;
      }>(`/pos/tickets/${ticket.id}/pay`, {
        method: "POST",
        body: JSON.stringify({ payments, tipCents: ticket.tipCents }),
      });
      const s = result.sale;
      const lines = s.lines.map((l) => `${l.quantity} x ${l.name}`.padEnd(28) + money(l.totalCents)).join("\n");
      const pays = s.payments.map((p) => `${p.paymentTypeName}`.padEnd(28) + money(p.amountCents)).join("\n");
      const text = [
        settings?.receipt.header ?? store.name,
        "--------------------------------",
        `Receipt ${s.receiptNumber}`,
        `Cashier: ${s.employeeName}`,
        s.customerName ? `Customer: ${s.customerName}` : null,
        "--------------------------------",
        lines,
        "--------------------------------",
        `Subtotal`.padEnd(28) + money(s.subtotalCents),
        s.discountCents ? `Discount`.padEnd(28) + money(-s.discountCents) : null,
        `Tax`.padEnd(28) + money(s.taxCents),
        s.tipCents ? `Tip`.padEnd(28) + money(s.tipCents) : null,
        `TOTAL`.padEnd(28) + money(s.totalCents),
        pays,
        result.changeCents > 0 ? `Change`.padEnd(28) + money(result.changeCents) : null,
        result.drawerOpened ? "[Drawer opened]" : null,
        "--------------------------------",
        settings?.receipt.footer ?? "Thank you!",
      ]
        .filter(Boolean)
        .join("\n");
      setTicket(null);
      setModal({ type: "receipt", text, changeCents: result.changeCents });
      void loadCatalog();
    } catch (e) {
      setModal({ type: "message", title: "Payment failed", body: e instanceof Error ? e.message : "Error" });
    } finally {
      setBusy(false);
    }
  }

  async function openOrCloseShift(action: "open" | "close", floatCents?: number) {
    try {
      if (action === "open") {
        const s = await api<{ id: string; openingFloatCents: number }>("/shifts/open", {
          method: "POST",
          body: JSON.stringify({ registerId, openingFloatCents: floatCents ?? 15000 }),
        });
        setShift(s);
        setModal({ type: "message", title: "Shift opened", body: `Float ${money(s.openingFloatCents)}` });
      } else if (shift) {
        const closed = await api<{ expectedCashCents: number; differenceCents: number; closingCashCents: number }>(
          `/shifts/${shift.id}/close`,
          {
            method: "POST",
            body: JSON.stringify({ closingCashCents: floatCents ?? 15000 }),
          }
        );
        setShift(null);
        setModal({
          type: "message",
          title: "Shift closed",
          body: `Expected ${money(closed.expectedCashCents)} · Counted ${money(closed.closingCashCents)} · Diff ${money(closed.differenceCents)}`,
        });
      }
    } catch (e) {
      setModal({ type: "message", title: "Shift", body: e instanceof Error ? e.message : "Error" });
    }
  }

  const paidSum = Object.values(payAmounts).reduce((a, b) => a + b, 0);

  return (
    <div className="app-shell">
      <div className="toolbar-dark">
        <strong>{store.name}</strong>
        <span>·</span>
        <span>{user.name}</span>
        <select
          value={registerId}
          onChange={(e) => onRegisterChange(e.target.value)}
          style={{ minHeight: 40, borderRadius: 10, border: "none", padding: "0 10px" }}
        >
          {registers.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setModal({ type: "shift" })}>
          {shift ? "Shift open" : "Open shift"}
        </button>
        <button type="button" onClick={() => void openDrawer()}>
          Drawer
        </button>
        <button type="button" onClick={onLogout}>
          Lock
        </button>
      </div>

      <div className="register">
        <section className="panel">
          <div className="topbar">
            <div className="brand-mini">CloudTill</div>
            <input
              className="search"
              placeholder="Search or scan barcode / SKU"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => void onSearchKey(e)}
            />
          </div>
          <div className="chip-row">
            <button type="button" className={`chip ${categoryId === "all" ? "active" : ""}`} onClick={() => setCategoryId("all")}>
              All
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`chip ${categoryId === c.id ? "active" : ""}`}
                onClick={() => setCategoryId(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
          <div className="grid">
            {filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                className="item-tile"
                style={{ backgroundColor: item.color }}
                onClick={() => void addItem(item)}
              >
                <span className="name">{item.name}</span>
                <span className="price">{money(item.variants[0]?.priceCents ?? 0)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="ticket-head">
            <div>
              <h2>{ticket?.name ?? "New sale"}</h2>
              <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                {ticket?.customer ? `${ticket.customer.name} · ${ticket.customer.loyaltyPoints} pts` : "Walk-in"}
              </div>
            </div>
            <button type="button" className="btn ghost" onClick={() => void openCustomers()}>
              Customer
            </button>
          </div>

          <div className="ticket-lines">
            {(ticket?.lines ?? []).map((line) => {
              const modSum = line.modifiers.reduce((s, m) => s + m.priceCents, 0);
              const lineTotal = Math.round((line.unitPriceCents + modSum) * line.quantity) - line.discountCents;
              return (
                <div key={line.key} className="line">
                  <div>
                    <div style={{ fontWeight: 600 }}>{line.name}</div>
                    {line.modifiers.length > 0 && (
                      <div className="meta">{line.modifiers.map((m) => m.name).join(", ")}</div>
                    )}
                    <div className="qty-controls" style={{ marginTop: 6 }}>
                      <button type="button" onClick={() => void updateQty(line, line.quantity - 1)}>
                        −
                      </button>
                      <span>{line.quantity}</span>
                      <button type="button" onClick={() => void updateQty(line, line.quantity + 1)}>
                        +
                      </button>
                    </div>
                  </div>
                  <div style={{ fontWeight: 600 }}>{money(lineTotal)}</div>
                </div>
              );
            })}
            {!ticket?.lines.length && (
              <p style={{ color: "var(--muted)", padding: 16 }}>Tap items to build the ticket.</p>
            )}
          </div>

          <div className="totals">
            <div className="row">
              <span>Subtotal</span>
              <span>{money(ticket?.subtotalCents ?? 0)}</span>
            </div>
            <div className="row">
              <span>Discount</span>
              <span>{money(-(ticket?.discountCents ?? 0))}</span>
            </div>
            <div className="row">
              <span>Tax</span>
              <span>{money(ticket?.taxCents ?? 0)}</span>
            </div>
            <div className="row">
              <span>Tip</span>
              <span>{money(ticket?.tipCents ?? 0)}</span>
            </div>
            <div className="row grand">
              <span>Total</span>
              <span>{money(ticket?.totalCents ?? 0)}</span>
            </div>
          </div>

          <div className="actions">
            <button type="button" onClick={() => void holdTicket()}>
              Hold
            </button>
            <button type="button" onClick={() => void openHeld()}>
              Recall
            </button>
            <button type="button" onClick={() => setModal({ type: "discount" })}>
              Discount
            </button>
            <button type="button" onClick={() => setModal({ type: "tip" })}>
              Tip
            </button>
            <button
              type="button"
              onClick={() => {
                setTicket(null);
              }}
            >
              Clear
            </button>
            <button type="button" onClick={() => void openCustomers()}>
              Customer
            </button>
            <button type="button" className="pay-btn" onClick={openPay}>
              Charge {money(ticket?.totalCents ?? 0)}
            </button>
          </div>
        </section>
      </div>

      {modal?.type === "modifiers" && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{modal.item.name}</h3>
            {modal.item.modifierGroups.map((g) => (
              <div key={g.id} style={{ marginBottom: 14 }}>
                <strong>
                  {g.name}
                  {g.minSelect > 0 ? " *" : ""}
                </strong>
                <div className="pay-grid">
                  {g.modifiers.map((m) => {
                    const selected = (selectedMods[g.id] ?? []).some((x) => x.id === m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        className={selected ? "active" : ""}
                        onClick={() => {
                          setSelectedMods((prev) => {
                            const cur = prev[g.id] ?? [];
                            if (g.maxSelect <= 1) return { ...prev, [g.id]: [m] };
                            if (selected) return { ...prev, [g.id]: cur.filter((x) => x.id !== m.id) };
                            if (cur.length >= g.maxSelect) return prev;
                            return { ...prev, [g.id]: [...cur, m] };
                          });
                        }}
                      >
                        {m.name}
                        {m.priceCents ? ` (+${money(m.priceCents)})` : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  const mods = Object.values(selectedMods)
                    .flat()
                    .map((m) => ({ modifierId: m.id, name: m.name, priceCents: m.priceCents }));
                  void addVariant(modal.item, mods);
                }}
              >
                Add to ticket
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "pay" && ticket && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Take payment</h3>
            <p>
              Due <strong>{money(ticket.totalCents)}</strong>
              {paidSum > 0 && <> · Tendered {money(paidSum)}</>}
              {paidSum > ticket.totalCents && <> · Change {money(paidSum - ticket.totalCents)}</>}
            </p>
            <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>Split tender: enter amounts per method.</p>
            {paymentTypes.map((pt) => (
              <div key={pt.id} className="field">
                <label>
                  {pt.name}
                  {pt.type === "store_credit" && ticket.customer
                    ? ` (available ${money(ticket.customer.storeCreditCents)})`
                    : ""}
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={((payAmounts[pt.id] ?? 0) / 100).toFixed(2)}
                    onChange={(e) =>
                      setPayAmounts((prev) => ({
                        ...prev,
                        [pt.id]: Math.round(parseFloat(e.target.value || "0") * 100),
                      }))
                    }
                  />
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setPayAmounts({ [pt.id]: ticket.totalCents })}
                  >
                    Exact
                  </button>
                </div>
              </div>
            ))}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy || paidSum < ticket.totalCents}
                onClick={() => void completePay()}
              >
                {busy ? "Processing…" : "Complete sale"}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "held" && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Held tickets</h3>
            {held.length === 0 && <p style={{ color: "var(--muted)" }}>No held tickets.</p>}
            {held.map((t) => (
              <button key={t.id} type="button" className="list-btn" onClick={() => void recall(t.id)}>
                <strong>{t.name}</strong>
                <div style={{ color: "var(--muted)" }}>
                  {t.lines.length} lines · {money(t.totalCents)}
                </div>
              </button>
            ))}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setModal(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "customers" && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Customers</h3>
            {customers.map((c) => (
              <button key={c.id} type="button" className="list-btn" onClick={() => void attachCustomer(c)}>
                <strong>{c.name}</strong>
                <div style={{ color: "var(--muted)" }}>
                  {c.loyaltyPoints} pts · credit {money(c.storeCreditCents)}
                </div>
              </button>
            ))}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setModal(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "discount" && ticket && (
        <DiscountModal
          onClose={() => setModal(null)}
          onApply={(cents, pct) => void applyDiscount(cents, pct)}
        />
      )}

      {modal?.type === "tip" && ticket && (
        <TipModal
          total={ticket.subtotalCents}
          presets={settings?.tipPresetsPercent ?? [10, 15, 20]}
          onClose={() => setModal(null)}
          onApply={(cents) => void applyTip(cents)}
        />
      )}

      {modal?.type === "receipt" && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Receipt</h3>
            {modal.changeCents > 0 && <p>Change due: {money(modal.changeCents)}</p>}
            <pre className="receipt">{modal.text}</pre>
            <div className="modal-actions">
              <button type="button" className="btn primary" onClick={() => setModal(null)}>
                Done / reprint later from sales
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "shift" && (
        <ShiftModal
          shift={shift}
          onClose={() => setModal(null)}
          onOpen={(cents) => void openOrCloseShift("open", cents)}
          onCloseShift={(cents) => void openOrCloseShift("close", cents)}
          onCashEvent={async (type, amountCents, note) => {
            if (!shift) return;
            await api(`/shifts/${shift.id}/cash`, {
              method: "POST",
              body: JSON.stringify({ type, amountCents, note }),
            });
            setModal({ type: "message", title: "Cash event", body: `${type} ${money(amountCents)} recorded` });
          }}
        />
      )}

      {modal?.type === "message" && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{modal.title}</h3>
            <p>{modal.body}</p>
            <div className="modal-actions">
              <button type="button" className="btn primary" onClick={() => setModal(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DiscountModal({
  onClose,
  onApply,
}: {
  onClose: () => void;
  onApply: (cents: number, pct: number) => void;
}) {
  const [mode, setMode] = useState<"cents" | "pct">("pct");
  const [value, setValue] = useState("10");
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Discount</h3>
        <div className="pay-grid">
          <button type="button" className={mode === "pct" ? "active" : ""} onClick={() => setMode("pct")}>
            Percent
          </button>
          <button type="button" className={mode === "cents" ? "active" : ""} onClick={() => setMode("cents")}>
            Amount
          </button>
        </div>
        <div className="field">
          <label>{mode === "pct" ? "Percent" : "Amount ($)"}</label>
          <input value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              const n = parseFloat(value || "0");
              if (mode === "pct") onApply(0, n);
              else onApply(Math.round(n * 100), 0);
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function TipModal({
  total,
  presets,
  onClose,
  onApply,
}: {
  total: number;
  presets: number[];
  onClose: () => void;
  onApply: (cents: number) => void;
}) {
  const [custom, setCustom] = useState("");
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Tip</h3>
        <div className="pay-grid">
          {presets.map((p) => (
            <button key={p} type="button" onClick={() => onApply(Math.round((total * p) / 100))}>
              {p}% ({money(Math.round((total * p) / 100))})
            </button>
          ))}
          <button type="button" onClick={() => onApply(0)}>
            No tip
          </button>
        </div>
        <div className="field">
          <label>Custom ($)</label>
          <input value={custom} onChange={(e) => setCustom(e.target.value)} />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => onApply(Math.round(parseFloat(custom || "0") * 100))}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function ShiftModal({
  shift,
  onClose,
  onOpen,
  onCloseShift,
  onCashEvent,
}: {
  shift: { id: string; openingFloatCents: number } | null;
  onClose: () => void;
  onOpen: (cents: number) => void;
  onCloseShift: (cents: number) => void;
  onCashEvent: (type: "pay_in" | "pay_out", amountCents: number, note?: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState("150.00");
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Shift & cash</h3>
        <p style={{ color: "var(--muted)" }}>
          {shift ? `Open · float ${money(shift.openingFloatCents)}` : "No open shift on this register"}
        </p>
        <div className="field">
          <label>{shift ? "Closing cash count ($)" : "Opening float ($)"}</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="modal-actions" style={{ justifyContent: "stretch" }}>
          {!shift ? (
            <button
              type="button"
              className="btn primary"
              onClick={() => onOpen(Math.round(parseFloat(amount || "0") * 100))}
            >
              Open shift
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn ghost"
                onClick={() => void onCashEvent("pay_in", Math.round(parseFloat(amount || "0") * 100), "Pay in")}
              >
                Pay in
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => void onCashEvent("pay_out", Math.round(parseFloat(amount || "0") * 100), "Pay out")}
              >
                Pay out
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => onCloseShift(Math.round(parseFloat(amount || "0") * 100))}
              >
                Close shift
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
