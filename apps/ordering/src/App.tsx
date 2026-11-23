import { useEffect, useMemo, useState } from "react";

const DEFAULT_SLUG = "demo-cafe";
const CART_KEY = "purepos.order.cart.v1";
const TRACK_KEY = "purepos.order.track.v1";

function resolveStoreSlug() {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("store") || params.get("slug");
    if (fromQuery?.trim()) return fromQuery.trim().toLowerCase();
    const parts = window.location.pathname.split("/").filter(Boolean);
    // /order/<slug> or /order/?store=
    if (parts[0] === "order" && parts[1] && parts[1] !== "index.html") {
      return parts[1].toLowerCase();
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SLUG;
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
  description?: string | null;
  color: string;
  categoryId: string | null;
  variants: { id: string; priceCents: number }[];
  modifierGroups: ModGroup[];
  soldOut?: boolean;
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
  modifiers: { id?: string; name: string; priceCents: number }[];
  note?: string;
}

interface StoreInfo {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  phone: string | null;
}

type Fulfillment = "pickup" | "dine_in" | "delivery";
type View = "menu" | "item" | "cart" | "details" | "pay";

interface OrderingInfo {
  open: boolean;
  paused: boolean;
  pausedUntil: string | null;
  fulfillments: Fulfillment[];
  estimates: Record<Fulfillment, string>;
}

const DEFAULT_ORDERING: OrderingInfo = {
  open: true,
  paused: false,
  pausedUntil: null,
  fulfillments: ["pickup", "dine_in", "delivery"],
  estimates: { pickup: "15–25 min", dine_in: "15–25 min", delivery: "45–55 min" },
};

interface DeliveryQuote {
  feeCents: number;
  freeAboveCents: number;
  estimateMinutes: string;
}

interface OrderLine {
  name: string;
  quantity: number;
  unitPriceCents: number;
  modifiersJson: string;
}

interface PlacedOrder {
  orderNumber: string;
  trackingToken: string;
  createdAt?: string;
  estimate?: string;
  totalCents: number;
  fulfillment: Fulfillment;
  customerName: string;
  deliveryAddress?: string;
  deliveryFeeCents?: number;
  lines: OrderLine[];
  cardBrand?: string | null;
  cardLast4?: string | null;
  receiptNumber?: string | null;
}

interface OrderStatus {
  orderNumber: string;
  status: string;
  createdAt?: string;
  estimate?: string;
  fulfillment: string;
  customerName: string;
  totalCents: number;
  deliveryAddress?: string | null;
  store: { name: string; address?: string | null; phone?: string | null };
  lines: OrderLine[];
  cardBrand?: string | null;
  cardLast4?: string | null;
  receiptNumber?: string | null;
}

const STATUS_STEPS = ["pending", "preparing", "ready"] as const;

function money(cents: number) {
  return `£${(cents / 100).toFixed(2)}`;
}

function lineTotal(line: CartLine) {
  const mods = line.modifiers.reduce((sum, mod) => sum + mod.priceCents, 0);
  return (line.unitPriceCents + mods) * line.quantity;
}

function statusIndex(status: string) {
  if (status === "completed") return STATUS_STEPS.length;
  if (status === "cancelled") return -1;
  if (status === "accepted") return 0;
  const idx = STATUS_STEPS.indexOf(status as (typeof STATUS_STEPS)[number]);
  return idx >= 0 ? idx : 0;
}

function fulfillmentLabel(fulfillment: string) {
  if (fulfillment === "dine_in") return "Dine in";
  if (fulfillment === "delivery") return "Delivery";
  return "Pickup";
}

function readyAround(createdAt: string | undefined, estimate: string | undefined) {
  const minutes = Number(estimate?.match(/\d+/)?.[0]);
  if (!createdAt || !Number.isFinite(minutes)) return "";
  return new Date(Date.parse(createdAt) + minutes * 60000).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pausedMessage(info: OrderingInfo) {
  if (info.pausedUntil) {
    const at = new Date(info.pausedUntil).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return `Not taking online orders until ${at}`;
  }
  return info.paused ? "Not taking online orders right now" : "Online ordering is closed";
}

function readTracked(slug: string): PlacedOrder | null {
  try {
    const raw = localStorage.getItem(`${TRACK_KEY}:${slug}`);
    return raw ? (JSON.parse(raw) as PlacedOrder) : null;
  } catch {
    return null;
  }
}

function statusTitle(status: string, fulfillment: string) {
  switch (status) {
    case "pending":
      return "Order received";
    case "accepted":
      return "The café accepted it";
    case "preparing":
      return "In the kitchen";
    case "ready":
      if (fulfillment === "delivery") return "Out for delivery";
      if (fulfillment === "dine_in") return "Ready at the counter";
      return "Ready for pickup";
    case "completed":
      return "All done";
    case "cancelled":
      return "Order cancelled";
    default:
      return "Tracking your order";
  }
}

function statusCopy(status: string, fulfillment: string) {
  switch (status) {
    case "pending":
      return "We’ve got it and paid. The kitchen will start on it shortly.";
    case "accepted":
      return "Accepted. The kitchen is about to start.";
    case "preparing":
      return fulfillment === "delivery" ? "Being made for delivery." : "Being made now.";
    case "ready":
      if (fulfillment === "delivery") return "A driver is on the way.";
      if (fulfillment === "dine_in") return "Come to the counter and we’ll bring it over.";
      return "Come to the counter and say your name.";
    case "completed":
      return "Thanks for ordering.";
    case "cancelled":
      return "This order was cancelled. You can start another whenever you like.";
    default:
      return "Checking with the café…";
  }
}

function quoteDeliveryFee(subtotal: number, quote: DeliveryQuote | null, fulfillment: Fulfillment) {
  if (fulfillment !== "delivery" || !quote) return 0;
  return subtotal >= quote.freeAboveCents ? 0 : quote.feeCents;
}

function parseMods(json: string) {
  try {
    const parsed = JSON.parse(json) as { name?: string; priceCents?: number }[];
    return {
      label: parsed.map((mod) => mod.name).filter(Boolean).join(", "),
      priceCents: parsed.reduce((sum, mod) => sum + (mod.priceCents ?? 0), 0),
    };
  } catch {
    return { label: "", priceCents: 0 };
  }
}

export function App() {
  const [slug] = useState(() => resolveStoreSlug());
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [taxRateBps, setTaxRateBps] = useState(0);
  const [taxInclusive, setTaxInclusive] = useState(true);
  const [ordering, setOrdering] = useState<OrderingInfo>(DEFAULT_ORDERING);
  const [popularIds, setPopularIds] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState<string | "all">("all");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>(() => {
    try {
      const raw = sessionStorage.getItem(`${CART_KEY}:${resolveStoreSlug()}`);
      return raw ? (JSON.parse(raw) as CartLine[]) : [];
    } catch {
      return [];
    }
  });
  const [view, setView] = useState<View>("menu");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [fulfillment, setFulfillment] = useState<Fulfillment>("pickup");
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuote | null>(null);
  const [address, setAddress] = useState("");
  const [unit, setUnit] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [note, setNote] = useState("");
  const [cardName, setCardName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExp, setCardExp] = useState("");
  const [cardCvc, setCardCvc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [menuError, setMenuError] = useState("");
  const [loading, setLoading] = useState(true);
  const [placed, setPlaced] = useState<PlacedOrder | null>(() => readTracked(resolveStoreSlug()));
  const [liveOrder, setLiveOrder] = useState<OrderStatus | null>(null);
  const [toast, setToast] = useState("");

  const [modItem, setModItem] = useState<Item | null>(null);
  const [pickedMods, setPickedMods] = useState<Record<string, Modifier[]>>({});
  const [modQty, setModQty] = useState(1);
  const [modNote, setModNote] = useState("");
  const [modError, setModError] = useState("");

  useEffect(() => {
    try {
      sessionStorage.setItem(`${CART_KEY}:${slug}`, JSON.stringify(cart));
    } catch {
      /* ignore quota */
    }
  }, [cart, slug]);

  useEffect(() => {
    void fetch(`/api/public/stores/${slug}/menu`)
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
        setTaxInclusive(data.tax?.inclusive ?? true);
        if (data.delivery) setDeliveryQuote(data.delivery);
        if (data.ordering) {
          const info = data.ordering as OrderingInfo;
          setOrdering(info);
          setFulfillment((current) => (info.fulfillments.includes(current) ? current : info.fulfillments[0] ?? current));
        }
        setPopularIds(data.popularItemIds ?? []);
        document.title = `Order · ${data.store?.name || "PurePOS"}`;
      })
      .catch((err) => setMenuError(err instanceof Error ? err.message : "Could not load menu"))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (!placed) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/public/orders/${encodeURIComponent(placed!.trackingToken)}`);
        if (res.status === 404) {
          localStorage.removeItem(`${TRACK_KEY}:${slug}`);
          if (!cancelled) setPlaced(null);
          return;
        }
        const data = await res.json();
        if (!res.ok) return;
        if (!cancelled) setLiveOrder(data);
        if (data.status === "completed" || data.status === "cancelled") window.clearInterval(id);
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
  }, [placed, slug]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 1800);
    return () => window.clearTimeout(id);
  }, [toast]);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      return [
        {
          id: "search",
          name: "Matches",
          items: items.filter((item) => item.name.toLowerCase().includes(q)),
        },
      ];
    }
    if (categoryId !== "all") {
      const category = categories.find((entry) => entry.id === categoryId);
      return [
        {
          id: categoryId,
          name: category?.name ?? "Menu",
          items: items.filter((item) => item.categoryId === categoryId),
        },
      ];
    }
    const grouped = categories
      .map((category) => ({
        id: category.id,
        name: category.name,
        items: items.filter((item) => item.categoryId === category.id),
      }))
      .filter((section) => section.items.length > 0);
    const loose = items.filter((item) => !item.categoryId);
    if (loose.length) grouped.push({ id: "other", name: "Other", items: loose });
    return grouped;
  }, [items, categories, categoryId, query]);

  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = cart.reduce((sum, line) => sum + lineTotal(line), 0);
  const tax = taxInclusive
    ? subtotal - Math.round(subtotal / (1 + taxRateBps / 10000))
    : Math.round((subtotal * taxRateBps) / 10000);
  const deliveryFee = quoteDeliveryFee(subtotal, deliveryQuote, fulfillment);
  const total = subtotal + (taxInclusive ? 0 : tax) + deliveryFee;
  const estimateLabel = (f: Fulfillment) => ordering.estimates[f] ?? "";

  function openItem(item: Item) {
    const initial: Record<string, Modifier[]> = {};
    for (const group of item.modifierGroups) {
      initial[group.id] = group.minSelect > 0 && group.modifiers[0] ? [group.modifiers[0]] : [];
    }
    setPickedMods(initial);
    setModQty(1);
    setModNote("");
    setModError("");
    setModItem(item);
    setView("item");
  }

  function chooseMod(group: ModGroup, modifier: Modifier) {
    setModError("");
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

  function pushCartLine(
    item: Item,
    modifiers: { id?: string; name: string; priceCents: number }[],
    quantity: number,
    lineNote?: string
  ) {
    const variant = item.variants[0];
    if (!variant) return;
    const signature = [
      ...modifiers.map((mod) => `${mod.name}:${mod.priceCents}`).sort(),
      lineNote ?? "",
    ].join("|");
    const key = `${variant.id}::${signature}`;
    setCart((prev) => {
      const existing = prev.find((line) => line.key === key);
      if (existing) {
        return prev.map((line) =>
          line.key === key ? { ...line, quantity: line.quantity + quantity } : line
        );
      }
      return [
        ...prev,
        {
          key,
          variantId: variant.id,
          name: item.name,
          quantity,
          unitPriceCents: variant.priceCents,
          modifiers,
          note: lineNote || undefined,
        },
      ];
    });
    setToast(`Added ${item.name}`);
  }

  function addItem(item: Item) {
    if (item.soldOut) {
      setToast(`${item.name} is sold out`);
      return;
    }
    if (item.modifierGroups.length > 0) {
      openItem(item);
      return;
    }
    pushCartLine(item, [], 1);
  }

  function confirmModifiers() {
    if (!modItem) return;
    for (const group of modItem.modifierGroups) {
      const selected = pickedMods[group.id] ?? [];
      if (selected.length < group.minSelect) {
        setModError(`Choose ${group.name} to continue.`);
        return;
      }
    }
    const modifiers = Object.values(pickedMods)
      .flat()
      .map((mod) => ({ id: mod.id, name: mod.name, priceCents: mod.priceCents }));
    pushCartLine(modItem, modifiers, modQty, modNote.trim());
    setModItem(null);
    setView("menu");
  }

  function setQty(key: string, next: number) {
    setCart((prev) => {
      if (next <= 0) return prev.filter((line) => line.key !== key);
      return prev.map((line) => (line.key === key ? { ...line, quantity: next } : line));
    });
  }

  async function placeOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!ordering.open) {
      setError(`${pausedMessage(ordering)}. Your basket is saved.`);
      return;
    }
    if (!cart.length) {
      setError("Add something from the menu first.");
      setView("cart");
      return;
    }
    if (!name.trim()) {
      setError("Add a name for the order.");
      setView("details");
      return;
    }
    if (fulfillment === "delivery") {
      if (!address.trim()) {
        setError("Add a delivery address.");
        setView("details");
        return;
      }
      if (!phone.trim()) {
        setError("Add a phone number so the driver can reach you.");
        setView("details");
        return;
      }
    }
    const exp = cardExp.match(/^(\d{2})\/(\d{2})$/);
    const expMonth = exp ? Number(exp[1]) : 0;
    if (!cardName.trim() || !cardNumber.trim() || !exp || expMonth < 1 || expMonth > 12 || cardCvc.trim().length < 3) {
      setError("Add the card to charge.");
      setView("pay");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/public/stores/${slug}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: name.trim(),
          customerPhone: phone || undefined,
          fulfillment,
          card: {
            name: cardName.trim(),
            number: cardNumber,
            expMonth,
            expYear: 2000 + Number(exp[2]),
            cvc: cardCvc.trim(),
          },
          deliveryAddress: fulfillment === "delivery" ? address.trim() : undefined,
          deliveryUnit: fulfillment === "delivery" ? unit.trim() || undefined : undefined,
          deliveryInstructions:
            fulfillment === "delivery" ? deliveryInstructions.trim() || undefined : undefined,
          note: note || undefined,
          lines: cart.map((line) => ({
            variantId: line.variantId,
            quantity: line.quantity,
            modifiers: line.modifiers,
            note: line.note,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Order failed");
      const next: PlacedOrder = {
        orderNumber: data.order.orderNumber,
        trackingToken: data.trackingToken,
        createdAt: data.order.createdAt,
        estimate: data.order.estimate,
        totalCents: data.order.totalCents,
        fulfillment,
        customerName: name.trim(),
        deliveryAddress: data.order.deliveryAddress ?? undefined,
        deliveryFeeCents: data.deliveryFeeCents ?? data.order.deliveryFeeCents ?? 0,
        lines: data.order.lines ?? [],
        cardBrand: data.order.cardBrand,
        cardLast4: data.order.cardLast4,
        receiptNumber: data.order.receiptNumber,
      };
      setPlaced(next);
      try {
        localStorage.setItem(`${TRACK_KEY}:${slug}`, JSON.stringify(next));
      } catch {
        /* private mode */
      }
      setLiveOrder(data.order);
      setCart([]);
      setView("menu");
      setNote("");
      setDeliveryInstructions("");
      setCardNumber("");
      setCardCvc("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order failed");
    } finally {
      setBusy(false);
    }
  }

  function resetToMenu() {
    localStorage.removeItem(`${TRACK_KEY}:${slug}`);
    setPlaced(null);
    setLiveOrder(null);
    setError("");
    setView("menu");
  }

  const modExtra = Object.values(pickedMods)
    .flat()
    .reduce((sum, mod) => sum + mod.priceCents, 0);
  const modEach = (modItem?.variants[0]?.priceCents ?? 0) + modExtra;
  const modTotal = modEach * modQty;

  const popular = useMemo(
    () =>
      popularIds
        .map((id) => items.find((item) => item.id === id))
        .filter((item): item is Item => Boolean(item && !item.soldOut)),
    [items, popularIds]
  );

  if (loading) {
    return (
      <div className="loading">
        <div className="pulse-ring" aria-hidden="true" />
        <p className="eyebrow">PurePOS</p>
        <h1>Opening the menu…</h1>
        <p className="muted">Fast, fair, and ready when you are.</p>
      </div>
    );
  }

  if (placed) {
    const status = liveOrder?.status ?? "pending";
    const idx = statusIndex(status);
    const lines = liveOrder?.lines?.length ? liveOrder.lines : placed.lines;
    const stepLabels = ["Received", "Being made", "Ready"];
    return (
      <div className="status-shell">
        <div className="status-card">
          <p className="eyebrow">{store?.name ?? "PurePOS"}</p>
          <h1>{statusTitle(status, placed.fulfillment)}</h1>
          <p className="order-no">{placed.orderNumber}</p>
          <p className="status-note">{statusCopy(status, placed.fulfillment)}</p>
          {(status === "pending" || status === "accepted" || status === "preparing") &&
            readyAround(liveOrder?.createdAt ?? placed.createdAt, liveOrder?.estimate ?? placed.estimate) && (
              <p className="ready-at">
                {placed.fulfillment === "delivery" ? "Arriving around " : "Ready around "}
                <strong>
                  {readyAround(liveOrder?.createdAt ?? placed.createdAt, liveOrder?.estimate ?? placed.estimate)}
                </strong>
              </p>
            )}
          {status !== "cancelled" && (
            <div className="steps" aria-label="Order progress">
              {STATUS_STEPS.map((step, i) => {
                const done = idx > i || status === "completed";
                const active = idx === i;
                return (
                  <div key={step} className={`step${done ? " done" : ""}${active ? " active" : ""}`}>
                    <div className="dot" />
                    {stepLabels[i]}
                  </div>
                );
              })}
            </div>
          )}
          <ul className="status-lines">
            {lines.map((line, index) => {
              const mods = parseMods(line.modifiersJson);
              return (
                <li key={`${line.name}-${index}`}>
                  <span>
                    <strong>
                      {line.quantity} × {line.name}
                    </strong>
                    {mods.label && <small>{mods.label}</small>}
                  </span>
                  <span>{money((line.unitPriceCents + mods.priceCents) * line.quantity)}</span>
                </li>
              );
            })}
          </ul>
          <p className="status-total">{money(liveOrder?.totalCents ?? placed.totalCents)}</p>
          <p className="muted">
            {fulfillmentLabel(placed.fulfillment)} · {placed.customerName}
          </p>
          {placed.fulfillment === "delivery" && placed.deliveryAddress && (
            <p className="muted">{placed.deliveryAddress}</p>
          )}
          {store?.address && <p className="muted">{store.address}</p>}
          {liveOrder?.store?.phone && (
            <p className="muted">
              Questions? Call <a href={`tel:${liveOrder.store.phone.replace(/\s/g, "")}`}>{liveOrder.store.phone}</a>
            </p>
          )}
          <p className="pay-note">
            Paid with {liveOrder?.cardBrand ?? placed.cardBrand ?? "card"}
            {(liveOrder?.cardLast4 ?? placed.cardLast4) ? ` •••• ${liveOrder?.cardLast4 ?? placed.cardLast4}` : ""}
            {(liveOrder?.receiptNumber ?? placed.receiptNumber)
              ? ` · ${liveOrder?.receiptNumber ?? placed.receiptNumber}`
              : ""}
          </p>
          <button type="button" onClick={resetToMenu}>
            {status === "completed" || status === "cancelled" ? "Start a new order" : "Order something else"}
          </button>
          {status !== "completed" && status !== "cancelled" && (
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              You can close this page. Open the menu again on this phone to see your order.
            </p>
          )}
        </div>
      </div>
    );
  }

  const inCheckout = view === "cart" || view === "details" || view === "pay";
  const stepIndex = view === "cart" ? 0 : view === "details" ? 1 : view === "pay" ? 2 : -1;

  return (
    <div className={`shell view-${view}${inCheckout ? " view-checkout" : ""}${cartCount > 0 && view === "menu" ? " has-dock" : ""}`}>
      <div className="menu-col">
        {view === "menu" && (
          <section className="hero" aria-label={store?.name ?? "Store"}>
            <div className="hero-row">
              <div>
                <p className="eyebrow">Order online</p>
                <h1 className="hero-brand">{store?.name ?? "Menu"}</h1>
              </div>
              <button type="button" className="cart-jump hero-cart" onClick={() => setView("cart")}>
                Cart
                {cartCount > 0 && <span>{cartCount}</span>}
              </button>
            </div>
            <p className="hero-address">
              {ordering.open ? "Taking orders now" : pausedMessage(ordering)}
              {store?.address ? ` · ${store.address}` : ""}
            </p>
          </section>
        )}

        {view !== "menu" && (
        <header className="topbar">
          <div>
            <p className="store-mini">{store?.name ?? "Order"}</p>
            <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
              {fulfillmentLabel(fulfillment)} · ~{estimateLabel(fulfillment)}
            </p>
          </div>
          <button type="button" className="cart-jump" onClick={() => setView("cart")}>
            Cart
            {cartCount > 0 && <span>{cartCount}</span>}
          </button>
        </header>
        )}

        {!ordering.open && view === "menu" && (
          <p className="closed-banner" role="status">
            {pausedMessage(ordering)}. You can still look at the menu and fill your basket.
          </p>
        )}

        <div className="header-fulfillment fulfillment" role="group" aria-label="How do you want it">
          {ordering.fulfillments.map((option) => (
            <button
              key={option}
              type="button"
              className={fulfillment === option ? "active" : ""}
              onClick={() => setFulfillment(option)}
            >
              {fulfillmentLabel(option)}
            </button>
          ))}
        </div>

        {view === "item" && modItem ? (
          <section className="customize" aria-label={`Customize ${modItem.name}`}>
            <button type="button" className="back" onClick={() => { setModItem(null); setView("menu"); }}>
              ← Menu
            </button>
            <div className="customize-head">
              <span className="swatch lg" style={{ background: modItem.color || "#2f6b4f" }} />
              <div>
                <h2>{modItem.name}</h2>
                {modItem.description && <p className="muted">{modItem.description}</p>}
                <p className="price-lg">{money(modItem.variants[0]?.priceCents ?? 0)}</p>
              </div>
            </div>
            {modItem.modifierGroups.map((group) => (
              <div key={group.id} className="mod-group">
                <h3>
                  {group.name}
                  <span>{group.minSelect > 0 ? "Required" : "Optional"}{group.maxSelect > 1 ? " · pick any" : ""}</span>
                </h3>
                <div className="mod-options">
                  {group.modifiers.map((option) => {
                    const active = (pickedMods[group.id] ?? []).some((entry) => entry.id === option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={`choice${active ? " active" : ""}`}
                        onClick={() => chooseMod(group, option)}
                      >
                        <span>{option.name}</span>
                        <span>{option.priceCents ? `+${money(option.priceCents)}` : "Included"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <label className="field">
              <span>Special request</span>
              <input
                value={modNote}
                onChange={(e) => setModNote(e.target.value)}
                placeholder="Oat on the side, extra hot…"
              />
            </label>
            <div className="qty-row">
              <span>Quantity</span>
              <div className="qty">
                <button type="button" aria-label="Decrease quantity" onClick={() => setModQty((qty) => Math.max(1, qty - 1))}>
                  −
                </button>
                <strong>{modQty}</strong>
                <button type="button" aria-label="Increase quantity" onClick={() => setModQty((qty) => qty + 1)}>
                  +
                </button>
              </div>
            </div>
            {modError && <p className="error">{modError}</p>}
            <button type="button" className="place-btn" onClick={confirmModifiers}>
              Add to order · {money(modTotal)}
            </button>
          </section>
        ) : (
          <section className="menu" aria-label="Menu">
            <p className="trust">{taxInclusive ? "Prices include VAT" : "VAT is added at checkout"}</p>
            <label className="search">
              <span className="sr">Search the menu</span>
              <input
                type="search"
                value={query}
                placeholder="Search the menu"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {!query && (
              <div className="chips" role="tablist" aria-label="Categories">
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
            )}
            {!query && categoryId === "all" && popular.length > 0 && (
              <div className="popular">
                <div className="popular-head">
                  <h2>Popular right now</h2>
                  <span className="muted">Tap to add</span>
                </div>
                <div className="popular-rail">
                  {popular.map((item) => (
                    <button
                      key={`pop-${item.id}`}
                      type="button"
                      className="popular-card"
                      onClick={() => addItem(item)}
                    >
                      <span className="swatch" style={{ background: item.color || "#0d9488" }} />
                      <strong>{item.name}</strong>
                      <span className="price">{money(item.variants[0]?.priceCents ?? 0)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {menuError && <p className="error">{menuError}</p>}
            {sections.map((section) => (
              <div key={section.id} className="section">
                <h2>{section.name}</h2>
                {section.items.length === 0 && <p className="empty">Nothing matches that search.</p>}
                <div className="dishes">
                  {section.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`dish${item.soldOut ? " is-soldout" : ""}`}
                      disabled={item.soldOut}
                      onClick={() => addItem(item)}
                    >
                      <span className="swatch" style={{ background: item.color || "#0d9488" }} />
                      <span className="dish-copy">
                        <span className="dish-name">{item.name}</span>
                        {item.description && <span className="dish-desc">{item.description}</span>}
                        <span className="dish-hint">
                          {item.soldOut ? (
                            "Sold out"
                          ) : (
                            <>
                              {item.modifierGroups.length > 0 ? "Customise" : "Add to order"}
                              <span className="add-chip" aria-hidden="true">+</span>
                            </>
                          )}
                        </span>
                      </span>
                      <span className="dish-price">{money(item.variants[0]?.priceCents ?? 0)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}
      </div>

      <aside className="cart-panel">
        <Checkout
          step={inCheckout ? view : "cart"}
          stepIndex={Math.max(stepIndex, 0)}
          cart={cart}
          subtotal={subtotal}
          tax={tax}
          deliveryFee={deliveryFee}
          deliveryQuote={deliveryQuote}
          total={total}
          taxInclusive={taxInclusive}
          fulfillments={ordering.fulfillments}
          estimate={estimateLabel(fulfillment)}
          closedMessage={ordering.open ? "" : pausedMessage(ordering)}
          name={name}
          phone={phone}
          fulfillment={fulfillment}
          address={address}
          unit={unit}
          deliveryInstructions={deliveryInstructions}
          note={note}
          busy={busy}
          error={error}
          showBack={inCheckout}
          onBack={() => {
            if (view === "pay") setView("details");
            else if (view === "details") setView("cart");
            else setView("menu");
          }}
          onContinue={() => {
            setError("");
            if (view === "cart") {
              if (!cart.length) {
                setError("Add something from the menu first.");
                return;
              }
              setView("details");
              return;
            }
            if (view === "details") {
              if (!name.trim()) {
                setError("Add a name for the order.");
                return;
              }
              if (fulfillment === "delivery") {
                if (!address.trim()) {
                  setError("Add a delivery address.");
                  return;
                }
                if (!phone.trim()) {
                  setError("Add a phone number so the driver can reach you.");
                  return;
                }
              }
              setView("pay");
            }
          }}
          onName={setName}
          onPhone={setPhone}
          onNote={setNote}
          onAddress={setAddress}
          onUnit={setUnit}
          onDeliveryInstructions={setDeliveryInstructions}
          onFulfillment={setFulfillment}
          onQty={setQty}
          onSubmit={(e) => void placeOrder(e)}
          cardName={cardName}
          cardNumber={cardNumber}
          cardExp={cardExp}
          cardCvc={cardCvc}
          onCardName={setCardName}
          onCardNumber={setCardNumber}
          onCardExp={setCardExp}
          onCardCvc={setCardCvc}
        />
      </aside>

      {toast && <div className="toast" role="status">{toast}</div>}

      {cartCount > 0 && view === "menu" && (
        <div className="dock">
          <div>
            <strong>{money(total)}</strong>
            <span>
              {cartCount} item{cartCount === 1 ? "" : "s"} · {fulfillmentLabel(fulfillment)}
            </span>
          </div>
          <button type="button" onClick={() => setView("cart")}>
            View cart
          </button>
        </div>
      )}
    </div>
  );
}

function Checkout({
  step,
  stepIndex,
  cart,
  subtotal,
  tax,
  deliveryFee,
  deliveryQuote,
  total,
  taxInclusive,
  fulfillments,
  estimate,
  closedMessage,
  name,
  phone,
  fulfillment,
  address,
  unit,
  deliveryInstructions,
  note,
  busy,
  error,
  showBack,
  onBack,
  onContinue,
  onName,
  onPhone,
  onNote,
  onAddress,
  onUnit,
  onDeliveryInstructions,
  onFulfillment,
  onQty,
  onSubmit,
  cardName,
  cardNumber,
  cardExp,
  cardCvc,
  onCardName,
  onCardNumber,
  onCardExp,
  onCardCvc,
}: {
  step: "cart" | "details" | "pay";
  stepIndex: number;
  cart: CartLine[];
  subtotal: number;
  tax: number;
  deliveryFee: number;
  deliveryQuote: DeliveryQuote | null;
  total: number;
  taxInclusive: boolean;
  fulfillments: Fulfillment[];
  estimate: string;
  closedMessage: string;
  name: string;
  phone: string;
  fulfillment: Fulfillment;
  address: string;
  unit: string;
  deliveryInstructions: string;
  note: string;
  busy: boolean;
  error: string;
  showBack: boolean;
  onBack: () => void;
  onContinue: () => void;
  onName: (value: string) => void;
  onPhone: (value: string) => void;
  onNote: (value: string) => void;
  onAddress: (value: string) => void;
  onUnit: (value: string) => void;
  onDeliveryInstructions: (value: string) => void;
  onFulfillment: (value: Fulfillment) => void;
  onQty: (key: string, next: number) => void;
  onSubmit: (e: React.FormEvent) => void;
  cardName: string;
  cardNumber: string;
  cardExp: string;
  cardCvc: string;
  onCardName: (value: string) => void;
  onCardNumber: (value: string) => void;
  onCardExp: (value: string) => void;
  onCardCvc: (value: string) => void;
}) {
  const freeDelivery = Boolean(
    deliveryQuote && fulfillment === "delivery" && subtotal >= deliveryQuote.freeAboveCents
  );
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);
  const steps = ["Cart", "Details", "Pay"] as const;

  return (
    <form className={`checkout step-${step}`} onSubmit={onSubmit}>
      {showBack && (
        <button type="button" className="back mobile-only" onClick={onBack}>
          ← {step === "cart" ? "Menu" : step === "details" ? "Cart" : "Details"}
        </button>
      )}

      <ol className="flow-steps mobile-only" aria-label="Checkout steps">
        {steps.map((label, index) => (
          <li
            key={label}
            className={`flow-step${index < stepIndex ? " done" : ""}${index === stepIndex ? " active" : ""}`}
          >
            <span className="flow-dot">{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      <div className="cart-head">
        <h2 className="mobile-only">
          {step === "cart" ? "Your cart" : step === "details" ? "How & where" : "Pay"}
        </h2>
        <h2 className="desktop-only">Your order</h2>
        <span>{count ? `${count} item${count === 1 ? "" : "s"}` : "Empty"}</span>
      </div>

      <section className={`step-panel${step === "cart" ? " active" : ""}`} data-step="cart">
        <div className="cart-fulfillment fulfillment" role="group" aria-label="How do you want it">
          {fulfillments.map((option) => (
            <button
              key={option}
              type="button"
              className={fulfillment === option ? "active" : ""}
              onClick={() => onFulfillment(option)}
            >
              {fulfillmentLabel(option)}
            </button>
          ))}
        </div>
        <p className="eta">
          About {estimate}
          {fulfillment === "delivery" && deliveryQuote
            ? freeDelivery
              ? " · free delivery"
              : ` · ${money(deliveryQuote.feeCents)} delivery, free over ${money(deliveryQuote.freeAboveCents)}`
            : ""}
        </p>

        {cart.length === 0 && <p className="empty">Your cart is empty. Add something from the menu.</p>}
        {cart.map((line) => (
          <div key={line.key} className="line">
            <div>
              <div className="line-title">{line.name}</div>
              {line.modifiers.length > 0 && (
                <div className="line-mods">{line.modifiers.map((mod) => mod.name).join(", ")}</div>
              )}
              {line.note && <div className="line-mods">{line.note}</div>}
              <div className="qty">
                <button type="button" aria-label={`Decrease ${line.name}`} onClick={() => onQty(line.key, line.quantity - 1)}>
                  −
                </button>
                <strong>{line.quantity}</strong>
                <button type="button" aria-label={`Increase ${line.name}`} onClick={() => onQty(line.key, line.quantity + 1)}>
                  +
                </button>
              </div>
            </div>
            <div className="line-price">{money(lineTotal(line))}</div>
          </div>
        ))}

        <div className="totals">
          <div className="row">
            <span>Subtotal</span>
            <span>{money(subtotal)}</span>
          </div>
          {!taxInclusive && (
            <div className="row">
              <span>VAT</span>
              <span>{money(tax)}</span>
            </div>
          )}
          {fulfillment === "delivery" && (
            <div className="row">
              <span>Delivery</span>
              <span>{freeDelivery ? "Free" : money(deliveryFee)}</span>
            </div>
          )}
          <div className="row grand">
            <span>Total</span>
            <span>{money(total)}</span>
          </div>
          {taxInclusive && tax > 0 && (
            <div className="row vat-note">
              <span>Includes VAT</span>
              <span>{money(tax)}</span>
            </div>
          )}
        </div>

        {step === "cart" && error && <p className="error">{error}</p>}
        <button type="button" className="place-btn mobile-only" disabled={!cart.length} onClick={onContinue}>
          Continue · details
        </button>
      </section>

      <section className={`step-panel${step === "details" ? " active" : ""}`} data-step="details">
        <h3 className="card-title desktop-only">Details</h3>
        <label className="field">
          <span>Name</span>
          <input required value={name} autoComplete="name" placeholder="Name for the order" onChange={(e) => onName(e.target.value)} />
        </label>
        <label className="field">
          <span>Phone{fulfillment === "delivery" ? "" : " · optional"}</span>
          <input
            required={fulfillment === "delivery"}
            value={phone}
            autoComplete="tel"
            inputMode="tel"
            placeholder={fulfillment === "delivery" ? "So the driver can reach you" : "If we need to reach you"}
            onChange={(e) => onPhone(e.target.value)}
          />
        </label>
        {fulfillment === "delivery" && (
          <>
            <label className="field">
              <span>Address</span>
              <input
                required
                value={address}
                autoComplete="street-address"
                placeholder="Street and number"
                onChange={(e) => onAddress(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Apt / unit</span>
              <input value={unit} placeholder="Optional" onChange={(e) => onUnit(e.target.value)} />
            </label>
            <label className="field">
              <span>Delivery notes</span>
              <textarea
                value={deliveryInstructions}
                placeholder="Buzzer, gate code, leave at the door…"
                onChange={(e) => onDeliveryInstructions(e.target.value)}
              />
            </label>
          </>
        )}
        <label className="field">
          <span>Note for the kitchen</span>
          <textarea value={note} placeholder="Allergy, extra napkins…" onChange={(e) => onNote(e.target.value)} />
        </label>
        {step === "details" && error && <p className="error">{error}</p>}
        <button type="button" className="place-btn mobile-only" onClick={onContinue}>
          Continue · pay {money(total)}
        </button>
      </section>

      <section className={`step-panel${step === "pay" ? " active" : ""}`} data-step="pay">
        <div className="pay-summary mobile-only">
          <div>
            <strong>{fulfillmentLabel(fulfillment)}</strong>
            <span className="muted"> · {count} item{count === 1 ? "" : "s"} · {money(total)}</span>
          </div>
          <p className="muted" style={{ marginTop: 6 }}>
            {name || "Guest"}
            {fulfillment === "delivery" && address ? ` · ${address}` : ""}
          </p>
        </div>
        <h3 className="card-title">Card</h3>
        <p className="pay-note">
          Test checkout: no real money is taken. Use <strong>4242 4242 4242 4242</strong>, any future expiry and any
          3-digit code. Your full card number is never stored.
        </p>
        <label className="field">
          <span>Name on card</span>
          <input
            required
            value={cardName}
            autoComplete="cc-name"
            placeholder="Name on card"
            onChange={(e) => onCardName(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Card number</span>
          <input
            required
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="4242 4242 4242 4242"
            value={cardNumber}
            onChange={(e) => onCardNumber(e.target.value.replace(/\D/g, "").slice(0, 19).replace(/(.{4})/g, "$1 ").trim())}
          />
        </label>
        <div className="card-row">
          <label className="field">
            <span>Expiry</span>
            <input
              required
              inputMode="numeric"
              autoComplete="cc-exp"
              placeholder="MM/YY"
              value={cardExp}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
                onCardExp(digits.length < 3 ? digits : `${digits.slice(0, 2)}/${digits.slice(2)}`);
              }}
            />
          </label>
          <label className="field">
            <span>CVC</span>
            <input
              required
              inputMode="numeric"
              autoComplete="cc-csc"
              placeholder="123"
              value={cardCvc}
              onChange={(e) => onCardCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          </label>
        </div>
        {step === "pay" && error && <p className="error">{error}</p>}
        {closedMessage && <p className="error">{closedMessage}.</p>}
        <button className="place-btn" type="submit" disabled={busy || !cart.length || Boolean(closedMessage)}>
          {busy ? "Taking payment…" : cart.length ? `Place order · ${money(total)}` : "Add items to order"}
        </button>
      </section>
    </form>
  );
}
