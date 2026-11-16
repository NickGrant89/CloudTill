import { useEffect, useMemo, useState } from "react";

const SLUG = "demo-cafe";

interface Item {
  id: string;
  name: string;
  color: string;
  categoryId: string | null;
  variants: { id: string; priceCents: number }[];
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
}

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function App() {
  const [storeName, setStoreName] = useState("CloudTill");
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [taxRateBps, setTaxRateBps] = useState(0);
  const [categoryId, setCategoryId] = useState<string | "all">("all");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [fulfillment, setFulfillment] = useState<"pickup" | "dine_in">("pickup");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [placed, setPlaced] = useState<{ orderNumber: string; totalCents: number } | null>(null);

  useEffect(() => {
    void fetch(`/api/public/stores/${SLUG}/menu`)
      .then((r) => r.json())
      .then((data) => {
        setStoreName(data.store.name);
        setCategories(data.categories);
        setItems(data.items);
        setTaxRateBps(data.tax?.rateBps ?? 0);
      })
      .catch(() => setError("Could not load menu"));
  }, []);

  const filtered = useMemo(
    () => items.filter((i) => categoryId === "all" || i.categoryId === categoryId),
    [items, categoryId]
  );

  const subtotal = cart.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
  const tax = Math.round((subtotal * taxRateBps) / 10000);
  const total = subtotal + tax;

  function addItem(item: Item) {
    const variant = item.variants[0];
    setCart((prev) => {
      const existing = prev.find((l) => l.variantId === variant.id);
      if (existing) {
        return prev.map((l) =>
          l.variantId === variant.id ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [
        ...prev,
        {
          key: variant.id,
          variantId: variant.id,
          name: item.name,
          quantity: 1,
          unitPriceCents: variant.priceCents,
        },
      ];
    });
  }

  async function placeOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!cart.length || !name.trim()) return;
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
          note: note || undefined,
          lines: cart.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Order failed");
      setPlaced({ orderNumber: data.order.orderNumber, totalCents: data.order.totalCents });
      setCart([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order failed");
    } finally {
      setBusy(false);
    }
  }

  if (placed) {
    return (
      <div className="shell">
        <div className="success">
          <h2>Order received</h2>
          <p>
            <strong>{placed.orderNumber}</strong> · {money(placed.totalCents)}
          </p>
          <p style={{ color: "var(--muted)" }}>
            The kitchen has your ticket. We’ll text/call when it’s ready for {fulfillment === "pickup" ? "pickup" : "dine-in"}.
          </p>
          <button type="button" onClick={() => setPlaced(null)}>
            Order again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="hero">
        <h1>{storeName}</h1>
        <p>Online ordering · pickup or dine-in · kitchen ticket created instantly</p>
      </header>

      <div className="layout">
        <section>
          <div className="chips">
            <button
              type="button"
              className={`chip ${categoryId === "all" ? "active" : ""}`}
              onClick={() => setCategoryId("all")}
            >
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
                className="tile"
                style={{ backgroundColor: item.color }}
                onClick={() => addItem(item)}
              >
                <span className="name">{item.name}</span>
                <span className="price">{money(item.variants[0]?.priceCents ?? 0)}</span>
              </button>
            ))}
          </div>
        </section>

        <aside className="cart">
          <h2>Your order</h2>
          {cart.length === 0 && <p style={{ color: "var(--muted)" }}>Tap items to add them.</p>}
          {cart.map((l) => (
            <div key={l.key} className="line">
              <div>
                <strong>
                  {l.quantity} × {l.name}
                </strong>
              </div>
              <div>
                {money(l.unitPriceCents * l.quantity)}{" "}
                <button
                  type="button"
                  className="ghost"
                  style={{ minHeight: 32, padding: "0 8px" }}
                  onClick={() => setCart((prev) => prev.filter((x) => x.key !== l.key))}
                >
                  ×
                </button>
              </div>
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
            <div className="row grand">
              <span>Total</span>
              <span>{money(total)}</span>
            </div>
          </div>

          <form onSubmit={(e) => void placeOrder(e)}>
            <div className="field">
              <label>Name</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </div>
            <div className="field">
              <label>Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
            </div>
            <div className="field">
              <label>Fulfillment</label>
              <select value={fulfillment} onChange={(e) => setFulfillment(e.target.value as "pickup" | "dine_in")}>
                <option value="pickup">Pickup</option>
                <option value="dine_in">Dine in</option>
              </select>
            </div>
            <div className="field">
              <label>Note</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Extra hot, etc." />
            </div>
            {error && <p className="error">{error}</p>}
            <button type="submit" disabled={busy || !cart.length} style={{ width: "100%", marginTop: 8 }}>
              {busy ? "Placing…" : `Place order · ${money(total)}`}
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
}
