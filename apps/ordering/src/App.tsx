import { useEffect, useMemo, useState } from "react";

const SLUG = "demo-cafe";

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
  variants: { id: string; priceCents: number }[];
  modifierGroups: ModGroup[];
}

interface Category {
  id: string;
  name: string;
}

interface CartLine {
  key: string;
  variantId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  modifiers: { name: string; priceCents: number }[];
}

interface StoreInfo {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  phone: string | null;
}

type Fulfillment = "pickup" | "dine_in" | "delivery";

interface DeliveryQuote {
  feeCents: number;
  freeAboveCents: number;
  estimateMinutes: string;
}

interface PlacedOrder {
  orderNumber: string;
  totalCents: number;
  fulfillment: Fulfillment;
  customerName: string;
  deliveryAddress?: string;
  deliveryFeeCents?: number;
  deliveryEstimate?: string;
}

interface OrderStatus {
  orderNumber: string;
  status: string;
  fulfillment: string;
  customerName: string;
  totalCents: number;
  store: { name: string };
  lines: { name: string; quantity: number; unitPriceCents: number; modifiersJson: string }[];
}

const STATUS_STEPS = ["pending", "accepted", "preparing", "ready"] as const;

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function lineTotal(line: CartLine) {
  const mods = line.modifiers.reduce((sum, mod) => sum + mod.priceCents, 0);
  return (line.unitPriceCents + mods) * line.quantity;
}

function statusIndex(status: string) {
  if (status === "completed") return STATUS_STEPS.length;
  if (status === "cancelled") return -1;
  const idx = STATUS_STEPS.indexOf(status as (typeof STATUS_STEPS)[number]);
  return idx >= 0 ? idx : 0;
}

function fulfillmentLabel(fulfillment: string) {
  if (fulfillment === "dine_in") return "Dine in";
  if (fulfillment === "delivery") return "Delivery";
  return "Pickup";
}

function statusCopy(status: string, fulfillment: string) {
  switch (status) {
    case "pending":
      return "We’ve got your order — waiting for the café to accept it.";
    case "accepted":
      return "Accepted. The kitchen will start shortly.";
    case "preparing":
      return fulfillment === "delivery" ? "Being prepared for delivery." : "Being prepared now.";
    case "ready":
      if (fulfillment === "delivery") return "Out for delivery — hang tight.";
      if (fulfillment === "dine_in") return "Ready — come to the counter.";
      return "Ready for pickup.";
    case "completed":
      return "All done. Thanks for ordering with CloudTill.";
    case "cancelled":
      return "This order was cancelled. Start a new one anytime.";
    default:
      return "Tracking your order…";
  }
}

function quoteDeliveryFee(subtotal: number, quote: DeliveryQuote | null, fulfillment: Fulfillment) {
  if (fulfillment !== "delivery" || !quote) return 0;
  return subtotal >= quote.freeAboveCents ? 0 : quote.feeCents;
}

export function App() {
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [taxRateBps, setTaxRateBps] = useState(0);
  const [categoryId, setCategoryId] = useState<string | "all">("all");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [fulfillment, setFulfillment] = useState<Fulfillment>("pickup");
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuote | null>(null);
  const [address, setAddress] = useState("");
  const [unit, setUnit] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [menuError, setMenuError] = useState("");
  const [loading, setLoading] = useState(true);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const [liveOrder, setLiveOrder] = useState<OrderStatus | null>(null);

  const [modItem, setModItem] = useState<Item | null>(null);
  const [pickedMods, setPickedMods] = useState<Record<string, Modifier[]>>({});
  const [modError, setModError] = useState("");

  useEffect(() => {
    void fetch(`/api/public/stores/${SLUG}/menu`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load menu");
        setStore(data.store);
        setCategories(data.categories);
        setItems(
          (data.items as Item[]).map((item) => ({
            ...item,
            modifierGroups: item.modifierGroups ?? [],
          }))
        );
        setTaxRateBps(data.tax?.rateBps ?? 0);
        if (data.delivery) setDeliveryQuote(data.delivery);
      })
      .catch((err) => setMenuError(err instanceof Error ? err.message : "Could not load menu"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!placed) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/public/orders/${placed!.orderNumber}`);
        const data = await res.json();
        if (!res.ok) return;
        if (!cancelled) setLiveOrder(data);
      } catch {
        /* keep last known status */
      }
    }

    void poll();
    const id = window.setInterval(() => void poll(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [placed]);

  const filtered = useMemo(
    () => items.filter((item) => categoryId === "all" || item.categoryId === categoryId),
    [items, categoryId]
  );

  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = cart.reduce((sum, line) => sum + lineTotal(line), 0);
  const tax = Math.round((subtotal * taxRateBps) / 10000);
  const deliveryFee = quoteDeliveryFee(subtotal, deliveryQuote, fulfillment);
  const total = subtotal + tax + deliveryFee;

  function openModifiers(item: Item) {
    const initial: Record<string, Modifier[]> = {};
    for (const group of item.modifierGroups) {
      initial[group.id] =
        group.minSelect > 0 && group.modifiers[0] ? [group.modifiers[0]] : [];
    }
    setPickedMods(initial);
    setModError("");
    setModItem(item);
  }

  function chooseMod(group: ModGroup, modifier: Modifier) {
    setPickedMods((prev) => {
      const current = prev[group.id] ?? [];
      if (group.maxSelect <= 1) return { ...prev, [group.id]: [modifier] };
      if (current.some((entry) => entry.id === modifier.id)) {
        return { ...prev, [group.id]: current.filter((entry) => entry.id !== modifier.id) };
      }
      if (current.length >= group.maxSelect) return prev;
      return { ...prev, [group.id]: [...current, modifier] };
    });
  }

  function pushCartLine(item: Item, modifiers: { name: string; priceCents: number }[]) {
    const variant = item.variants[0];
    if (!variant) return;
    const signature = modifiers
      .map((mod) => `${mod.name}:${mod.priceCents}`)
      .sort()
      .join("|");
    const key = `${variant.id}::${signature}`;
    setCart((prev) => {
      const existing = prev.find((line) => line.key === key);
      if (existing) {
        return prev.map((line) =>
          line.key === key ? { ...line, quantity: line.quantity + 1 } : line
        );
      }
      return [
        ...prev,
        {
          key,
          variantId: variant.id,
          name: item.name,
          quantity: 1,
          unitPriceCents: variant.priceCents,
          modifiers,
        },
      ];
    });
    setCartOpen(true);
  }

  function addItem(item: Item) {
    if (item.modifierGroups.length > 0) {
      openModifiers(item);
      return;
    }
    pushCartLine(item, []);
  }

  function confirmModifiers() {
    if (!modItem) return;
    for (const group of modItem.modifierGroups) {
      const selected = pickedMods[group.id] ?? [];
      if (selected.length < group.minSelect) {
        setModError(`Choose at least ${group.minSelect} for ${group.name}.`);
        return;
      }
    }
    const modifiers = Object.values(pickedMods)
      .flat()
      .map((mod) => ({ name: mod.name, priceCents: mod.priceCents }));
    pushCartLine(modItem, modifiers);
    setModItem(null);
  }

  function setQty(key: string, next: number) {
    setCart((prev) => {
      if (next <= 0) return prev.filter((line) => line.key !== key);
      return prev.map((line) => (line.key === key ? { ...line, quantity: next } : line));
    });
  }

  async function placeOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!cart.length || !name.trim()) return;
    if (fulfillment === "delivery") {
      if (!address.trim()) {
        setError("Add a delivery address.");
        setCartOpen(true);
        return;
      }
      if (!phone.trim()) {
        setError("Phone is required for delivery.");
        setCartOpen(true);
        return;
      }
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/public/stores/${SLUG}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: name.trim(),
          customerPhone: phone || undefined,
          fulfillment,
          deliveryAddress: fulfillment === "delivery" ? address.trim() : undefined,
          deliveryUnit: fulfillment === "delivery" ? unit.trim() || undefined : undefined,
          deliveryInstructions:
            fulfillment === "delivery" ? deliveryInstructions.trim() || undefined : undefined,
          note: note || undefined,
          lines: cart.map((line) => ({
            variantId: line.variantId,
            quantity: line.quantity,
            modifiers: line.modifiers,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Order failed");
      setPlaced({
        orderNumber: data.order.orderNumber,
        totalCents: data.order.totalCents,
        fulfillment,
        customerName: name.trim(),
        deliveryAddress: data.order.deliveryAddress ?? undefined,
        deliveryFeeCents: data.deliveryFeeCents ?? data.order.deliveryFeeCents ?? 0,
        deliveryEstimate: data.deliveryEstimate,
      });
      setLiveOrder(data.order);
      setCart([]);
      setCartOpen(false);
      setNote("");
      setDeliveryInstructions("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order failed");
    } finally {
      setBusy(false);
    }
  }

  function resetToMenu() {
    setPlaced(null);
    setLiveOrder(null);
    setError("");
  }

  const cartPanelProps = {
    cart,
    subtotal,
    tax,
    deliveryFee,
    deliveryQuote,
    total,
    name,
    phone,
    fulfillment,
    address,
    unit,
    deliveryInstructions,
    note,
    busy,
    error,
    onName: setName,
    onPhone: setPhone,
    onNote: setNote,
    onAddress: setAddress,
    onUnit: setUnit,
    onDeliveryInstructions: setDeliveryInstructions,
    onFulfillment: setFulfillment,
    onQty: setQty,
    onSubmit: (e: React.FormEvent) => void placeOrder(e),
  };

  if (placed) {
    const status = liveOrder?.status ?? "pending";
    const idx = statusIndex(status);
    return (
      <div className="status-shell">
        <div className="status-card">
          <p className="brand-mini">CloudTill</p>
          <h1>{status === "ready" ? "It’s ready" : "Order on the way"}</h1>
          <p className="order-no">{placed.orderNumber}</p>
          <p style={{ margin: "6px 0 0", fontWeight: 600 }}>{money(placed.totalCents)}</p>
          <div className="steps" aria-label="Order progress">
            {STATUS_STEPS.map((step, i) => {
              const done = idx > i || status === "completed";
              const active = idx === i;
              return (
                <div key={step} className={`step${done ? " done" : ""}${active ? " active" : ""}`}>
                  <div className="dot" />
                  {step === "pending"
                    ? "Received"
                    : step === "accepted"
                      ? "Accepted"
                      : step === "preparing"
                        ? "Preparing"
                        : "Ready"}
                </div>
              );
            })}
          </div>
          <p className="status-note">{statusCopy(status, placed.fulfillment)}</p>
          <p style={{ color: "var(--muted)", marginTop: 0 }}>
            {fulfillmentLabel(placed.fulfillment)} · {placed.customerName}
            {store?.name ? ` · ${store.name}` : ""}
          </p>
          {placed.fulfillment === "delivery" && placed.deliveryAddress && (
            <p style={{ color: "var(--muted)", marginTop: 8 }}>{placed.deliveryAddress}</p>
          )}
          {placed.fulfillment === "delivery" && placed.deliveryEstimate && (
            <p style={{ color: "var(--muted)", marginTop: 4 }}>ETA stub · {placed.deliveryEstimate}</p>
          )}
          <button type="button" onClick={resetToMenu} style={{ width: "100%", marginTop: 8 }}>
            Order something else
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="loading">Warming up the menu…</div>;
  }

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-inner">
          <h1 className="brand">CloudTill</h1>
          <p className="hero-kicker">{store?.name ?? "Demo Café"}</p>
          <p className="hero-lead">Order ahead for pickup, dine-in, or delivery. The kitchen gets your ticket the moment you place it.</p>
          <div className="fulfillment" role="group" aria-label="Fulfillment">
            <button
              type="button"
              className={fulfillment === "pickup" ? "active" : ""}
              onClick={() => setFulfillment("pickup")}
            >
              Pickup
            </button>
            <button
              type="button"
              className={fulfillment === "dine_in" ? "active" : ""}
              onClick={() => setFulfillment("dine_in")}
            >
              Dine in
            </button>
            <button
              type="button"
              className={fulfillment === "delivery" ? "active" : ""}
              onClick={() => setFulfillment("delivery")}
            >
              Delivery
            </button>
          </div>
          {(store?.address || store?.phone) && (
            <p className="store-meta">
              {[store.address, store.phone].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </header>

      <div className="main">
        <section className="menu-panel">
          <h2 className="section-label">Menu</h2>
          {menuError && <p className="error">{menuError}</p>}
          <div className="chips">
            <button
              type="button"
              className={`chip ${categoryId === "all" ? "active" : ""}`}
              onClick={() => setCategoryId("all")}
            >
              All
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={`chip ${categoryId === category.id ? "active" : ""}`}
                onClick={() => setCategoryId(category.id)}
              >
                {category.name}
              </button>
            ))}
          </div>
          <div className="grid">
            {filtered.length === 0 && <p className="empty">Nothing in this category yet.</p>}
            {filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                className="tile"
                style={{ backgroundColor: item.color || "#2f6b4f" }}
                onClick={() => addItem(item)}
              >
                {item.modifierGroups.length > 0 && <span className="badge">Options</span>}
                <span className="name">{item.name}</span>
                <span className="price">{money(item.variants[0]?.priceCents ?? 0)}</span>
              </button>
            ))}
          </div>
        </section>

        <aside className="desktop-cart cart">
          <CartPanel {...cartPanelProps} />
        </aside>
      </div>

      {cartCount > 0 && (
        <div className="cart-bar">
          <div className="summary">
            <strong>{money(total)}</strong>
            <span>
              {cartCount} item{cartCount === 1 ? "" : "s"} · {fulfillmentLabel(fulfillment)}
            </span>
          </div>
          <button type="button" onClick={() => setCartOpen(true)}>
            View cart
          </button>
        </div>
      )}

      {cartOpen && (
        <>
          <div className="cart-sheet-backdrop" onClick={() => setCartOpen(false)} aria-hidden="true" />
          <div className="cart-sheet" role="dialog" aria-label="Your order">
            <div className="sheet-handle" />
            <div className="cart-head">
              <h2>Your order</h2>
              <button type="button" className="ghost" style={{ minHeight: 40 }} onClick={() => setCartOpen(false)}>
                Close
              </button>
            </div>
            <CartPanel {...cartPanelProps} hideTitle />
          </div>
        </>
      )}

      {modItem && (
        <div className="modal-backdrop" onClick={() => setModItem(null)}>
          <div
            className="modal"
            role="dialog"
            aria-label={`Customize ${modItem.name}`}
            onClick={(e) => e.stopPropagation()}
          >
            <h3>{modItem.name}</h3>
            <p className="sub">Choose your options, then add to cart.</p>
            {modItem.modifierGroups.map((group) => (
              <div key={group.id} className="mod-group">
                <h4>
                  {group.name}
                  {group.minSelect > 0 ? " · required" : " · optional"}
                  {group.maxSelect > 1 ? ` · up to ${group.maxSelect}` : ""}
                </h4>
                <div className="mod-options">
                  {group.modifiers.map((option) => {
                    const active = (pickedMods[group.id] ?? []).some((entry) => entry.id === option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={`mod-option${active ? " active" : ""}`}
                        onClick={() => chooseMod(group, option)}
                      >
                        {option.name}
                        {option.priceCents ? ` · +${money(option.priceCents)}` : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {modError && <p className="error">{modError}</p>}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setModItem(null)}>
                Cancel
              </button>
              <button type="button" onClick={confirmModifiers}>
                Add to cart
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CartPanel({
  cart,
  subtotal,
  tax,
  deliveryFee,
  deliveryQuote,
  total,
  name,
  phone,
  fulfillment,
  address,
  unit,
  deliveryInstructions,
  note,
  busy,
  error,
  hideTitle,
  onName,
  onPhone,
  onNote,
  onAddress,
  onUnit,
  onDeliveryInstructions,
  onFulfillment,
  onQty,
  onSubmit,
}: {
  cart: CartLine[];
  subtotal: number;
  tax: number;
  deliveryFee: number;
  deliveryQuote: DeliveryQuote | null;
  total: number;
  name: string;
  phone: string;
  fulfillment: Fulfillment;
  address: string;
  unit: string;
  deliveryInstructions: string;
  note: string;
  busy: boolean;
  error: string;
  hideTitle?: boolean;
  onName: (value: string) => void;
  onPhone: (value: string) => void;
  onNote: (value: string) => void;
  onAddress: (value: string) => void;
  onUnit: (value: string) => void;
  onDeliveryInstructions: (value: string) => void;
  onFulfillment: (value: Fulfillment) => void;
  onQty: (key: string, next: number) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const freeDelivery = Boolean(
    deliveryQuote && fulfillment === "delivery" && subtotal >= deliveryQuote.freeAboveCents
  );

  return (
    <div>
      {!hideTitle && (
        <div className="cart-head">
          <h2>Your order</h2>
          <span className="cart-count">
            {cart.reduce((sum, line) => sum + line.quantity, 0) || "Empty"}
          </span>
        </div>
      )}

      {cart.length === 0 && <p className="empty">Tap a menu item to start.</p>}
      {cart.map((line) => (
        <div key={line.key} className="line">
          <div>
            <div className="line-title">{line.name}</div>
            {line.modifiers.length > 0 && (
              <div className="line-mods">{line.modifiers.map((mod) => mod.name).join(", ")}</div>
            )}
            <div className="qty" style={{ marginTop: 8 }}>
              <button type="button" aria-label="Decrease" onClick={() => onQty(line.key, line.quantity - 1)}>
                −
              </button>
              <strong>{line.quantity}</strong>
              <button type="button" aria-label="Increase" onClick={() => onQty(line.key, line.quantity + 1)}>
                +
              </button>
            </div>
          </div>
          <div style={{ fontWeight: 650 }}>{money(lineTotal(line))}</div>
        </div>
      ))}

      <div className="totals">
        <div className="row">
          <span>Subtotal</span>
          <span>{money(subtotal)}</span>
        </div>
        <div className="row">
          <span>Tax</span>
          <span>{money(tax)}</span>
        </div>
        {fulfillment === "delivery" && (
          <div className="row">
            <span>Delivery{freeDelivery ? " (free)" : ""}</span>
            <span>{money(deliveryFee)}</span>
          </div>
        )}
        <div className="row grand">
          <span>Total</span>
          <span>{money(total)}</span>
        </div>
      </div>

      {fulfillment === "delivery" && deliveryQuote && (
        <p className="delivery-stub">
          ETA stub · {deliveryQuote.estimateMinutes}
          {!freeDelivery
            ? ` · $${(deliveryQuote.feeCents / 100).toFixed(2)} fee (free over $${(deliveryQuote.freeAboveCents / 100).toFixed(0)})`
            : " · free delivery unlocked"}
        </p>
      )}

      <form onSubmit={onSubmit}>
        <div className="field">
          <label>Fulfillment</label>
          <select value={fulfillment} onChange={(e) => onFulfillment(e.target.value as Fulfillment)}>
            <option value="pickup">Pickup</option>
            <option value="dine_in">Dine in</option>
            <option value="delivery">Delivery</option>
          </select>
        </div>
        <div className="field">
          <label>Name</label>
          <input required value={name} onChange={(e) => onName(e.target.value)} placeholder="For the ticket" />
        </div>
        <div className="field">
          <label>Phone{fulfillment === "delivery" ? " (required)" : ""}</label>
          <input
            required={fulfillment === "delivery"}
            value={phone}
            onChange={(e) => onPhone(e.target.value)}
            placeholder={fulfillment === "delivery" ? "Driver contact" : "Optional"}
            inputMode="tel"
          />
        </div>
        {fulfillment === "delivery" && (
          <>
            <div className="field">
              <label>Address</label>
              <input
                required
                value={address}
                onChange={(e) => onAddress(e.target.value)}
                placeholder="Street and number"
                autoComplete="street-address"
              />
            </div>
            <div className="field">
              <label>Apt / unit</label>
              <input value={unit} onChange={(e) => onUnit(e.target.value)} placeholder="Optional" />
            </div>
            <div className="field">
              <label>Delivery instructions</label>
              <textarea
                value={deliveryInstructions}
                onChange={(e) => onDeliveryInstructions(e.target.value)}
                placeholder="Buzzer, gate code, leave at door…"
              />
            </div>
          </>
        )}
        <div className="field">
          <label>Note</label>
          <textarea value={note} onChange={(e) => onNote(e.target.value)} placeholder="Extra hot, no ice…" />
        </div>
        {error && <p className="error">{error}</p>}
        <button className="place-btn" type="submit" disabled={busy || !cart.length}>
          {busy ? "Placing…" : `Place order · ${money(total)}`}
        </button>
      </form>
    </div>
  );
}
