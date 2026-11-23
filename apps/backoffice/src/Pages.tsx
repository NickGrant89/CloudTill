import { useEffect, useState } from "react";
import { api, getToken, money, setToken } from "./api";
import { GiftCardsPage, ModifierEditor, ModifierLibrary, TimeClockPage } from "./MorePages";
import { KitchenPage, PrintersPage } from "./KitchenPrinters";
import { EodPage, ImportPage, LabelsPage, StocktakePage } from "./ExtrasPages";

export type PageId =
  | "dashboard"
  | "catalog"
  | "modifiers"
  | "inventory"
  | "stocktake"
  | "import"
  | "customers"
  | "employees"
  | "stores"
  | "sales"
  | "reports"
  | "shifts"
  | "giftcards"
  | "timeclock"
  | "kitchen"
  | "printers"
  | "labels"
  | "eod"
  | "settings";

export function Pages({ page, onNavigate }: { page: PageId; onNavigate?: (page: PageId) => void }) {
  switch (page) {
    case "dashboard":
      return <Dashboard onNavigate={onNavigate} />;
    case "catalog":
      return <CatalogPage />;
    case "modifiers":
      return <ModifiersPage />;
    case "inventory":
      return <InventoryPage />;
    case "stocktake":
      return <StocktakePage />;
    case "import":
      return <ImportPage />;
    case "customers":
      return <CustomersPage />;
    case "employees":
      return <EmployeesPage />;
    case "stores":
      return <StoresPage />;
    case "sales":
      return <SalesPage />;
    case "reports":
      return <ReportsPage />;
    case "shifts":
      return <ShiftsPage />;
    case "giftcards":
      return <GiftCardsPage />;
    case "timeclock":
      return <TimeClockPage />;
    case "kitchen":
      return <KitchenPage />;
    case "printers":
      return <PrintersPage />;
    case "labels":
      return <LabelsPage />;
    case "eod":
      return <EodPage />;
    case "settings":
      return <SettingsPage />;
  }
}

type DashData = {
  store: { name: string; slug: string; currency: string };
  asOf: string;
  today: {
    receiptCount: number;
    grossSalesCents: number;
    taxCents: number;
    tipCents: number;
    avgTicketCents: number;
  };
  week: { receiptCount: number; grossSalesCents: number; avgTicketCents: number };
  kitchen: {
    counts: { pending: number; preparing: number; ready: number; total: number };
    orders: {
      id: string;
      orderNumber: string;
      customerName: string;
      channel: string;
      status: string;
      fulfillment: string;
      totalCents: number;
      createdAt: string;
      linesPreview: string;
    }[];
  };
  openTickets: number;
  openShifts: number;
  lowStock: { count: number; items: { name: string; sku: string; quantity: number; lowStock: number }[] };
};

function channelLabel(channel: string) {
  const map: Record<string, string> = {
    web: "Web",
    justeat: "Just Eat",
    deliveroo: "Deliveroo",
    ubereats: "Uber Eats",
    hungrypanda: "HungryPanda",
    foodhub: "Foodhub",
    generic: "Delivery",
  };
  return map[channel] ?? channel;
}

function Dashboard({ onNavigate }: { onNavigate?: (page: PageId) => void }) {
  const [data, setData] = useState<DashData | null>(null);
  const [err, setErr] = useState("");

  async function load() {
    try {
      setData(await api<DashData>("/reports/dashboard"));
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load dashboard");
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, []);

  const go = (page: PageId) => onNavigate?.(page);

  if (!data && !err) return <p>Loading overview…</p>;

  const k = data?.kitchen.counts;
  const todayLabel = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });

  return (
    <div className="dash">
      <div className="page-head">
        <div>
          <h2>Today</h2>
          <p>
            {data?.store.name ?? "Store"} · {todayLabel}
            {data ? ` · updated ${new Date(data.asOf).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}
          </p>
        </div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button type="button" className="secondary" onClick={() => void load()}>
            Refresh
          </button>
          <a className="ghost-link" href="/pos/" target="_blank" rel="noreferrer">
            Open till
          </a>
        </div>
      </div>

      {err && <p className="error">{err}</p>}

      <div className="dash-today">
        <div className="stat stat-hero">
          <div className="label">Sales today</div>
          <div className="value">{money(data?.today.grossSalesCents ?? 0)}</div>
        </div>
        <div className="stat">
          <div className="label">Receipts</div>
          <div className="value">{data?.today.receiptCount ?? 0}</div>
        </div>
        <div className="stat">
          <div className="label">Avg ticket</div>
          <div className="value">{money(data?.today.avgTicketCents ?? 0)}</div>
        </div>
        <div className="stat">
          <div className="label">Tips today</div>
          <div className="value">{money(data?.today.tipCents ?? 0)}</div>
        </div>
      </div>

      <div className="dash-grid">
        <section className="panel-box dash-kitchen">
          <div className="dash-panel-head">
            <div>
              <h3>Kitchen / delivery</h3>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem" }}>
                {k?.total
                  ? `${k.pending} waiting · ${k.preparing} preparing · ${k.ready} ready`
                  : "Queue clear"}
              </p>
            </div>
            <button type="button" className="secondary" onClick={() => go("kitchen")}>
              Open kitchen
            </button>
          </div>
          {data?.kitchen.orders.length ? (
            <ul className="dash-order-list">
              {data.kitchen.orders.map((o) => (
                <li key={o.id}>
                  <div>
                    <strong>{o.orderNumber}</strong>{" "}
                    <span className="badge">{channelLabel(o.channel)}</span>{" "}
                    <span className="badge warn">{o.status}</span>
                    <div style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: 2 }}>
                      {o.customerName} · {o.fulfillment}
                      {o.linesPreview ? ` · ${o.linesPreview}` : ""}
                    </div>
                  </div>
                  <div className="dash-order-right">
                    <span>{money(o.totalCents)}</span>
                    <button
                      type="button"
                      onClick={() =>
                        void api(`/kitchen/orders/${o.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({
                            status:
                              o.status === "pending" || o.status === "accepted"
                                ? "preparing"
                                : o.status === "preparing"
                                  ? "ready"
                                  : "completed",
                          }),
                        }).then(() => load())
                      }
                    >
                      Advance
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: "var(--muted)", margin: "8px 0 0" }}>
              No open kitchen orders. Web and delivery-app orders appear here.
            </p>
          )}
        </section>

        <aside className="dash-side">
          <section className="panel-box">
            <h3>At a glance</h3>
            <ul className="dash-glance">
              <li>
                <span>Open tickets</span>
                <strong>{data?.openTickets ?? 0}</strong>
              </li>
              <li>
                <span>Open shifts</span>
                <strong>{data?.openShifts ?? 0}</strong>
              </li>
              <li>
                <span>Low stock</span>
                <strong className={(data?.lowStock.count ?? 0) > 0 ? "warn-text" : undefined}>
                  {data?.lowStock.count ?? 0}
                </strong>
              </li>
              <li>
                <span>7-day sales</span>
                <strong>{money(data?.week.grossSalesCents ?? 0)}</strong>
              </li>
              <li>
                <span>7-day receipts</span>
                <strong>{data?.week.receiptCount ?? 0}</strong>
              </li>
            </ul>
            {(data?.lowStock.items.length ?? 0) > 0 && (
              <div className="dash-low">
                {data!.lowStock.items.map((i) => (
                  <div key={i.sku}>
                    {i.name}{" "}
                    <span style={{ color: "var(--muted)" }}>
                      {i.quantity} ≤ {i.lowStock}
                    </span>
                  </div>
                ))}
                <button type="button" className="secondary" style={{ marginTop: 10 }} onClick={() => go("inventory")}>
                  Inventory
                </button>
              </div>
            )}
          </section>

          <section className="panel-box">
            <h3>Go to</h3>
            <div className="dash-actions">
              <button type="button" onClick={() => go("sales")}>
                Sales history
              </button>
              <button type="button" className="secondary" onClick={() => go("reports")}>
                Reports
              </button>
              <button type="button" className="secondary" onClick={() => go("catalog")}>
                Items
              </button>
              <button type="button" className="secondary" onClick={() => go("eod")}>
                End of day
              </button>
              <button type="button" className="secondary" onClick={() => go("settings")}>
                Settings
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function CatalogPage() {
  const [items, setItems] = useState<
    {
      id: string;
      name: string;
      color: string;
      isComposite: boolean;
      categoryId: string | null;
      variants: { sku: string; barcode: string | null; priceCents: number; trackStock: boolean; stockQty: number }[];
      modifierGroups: { id: string; name: string; modifiers: { name: string }[] }[];
    }[]
  >([]);
  const [categories, setCategories] = useState<{ id: string; name: string; color?: string }[]>([]);
  const [q, setQ] = useState("");
  const [groupFilter, setGroupFilter] = useState<string | "all" | "none">("all");
  const [showForm, setShowForm] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupMsg, setGroupMsg] = useState("");
  const [editMods, setEditMods] = useState<{ id: string; name: string } | null>(null);
  const [editItem, setEditItem] = useState<(typeof items)[number] | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    categoryId: "",
    price: "0.00",
    sku: "",
    barcode: "",
    trackStock: true,
  });
  const [pizzaMsg, setPizzaMsg] = useState("");
  const [pizzaBusy, setPizzaBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [branchStores, setBranchStores] = useState<{ id: string; name: string; slug?: string }[]>([]);
  const [currentStoreId, setCurrentStoreId] = useState("");
  const [presenceByItem, setPresenceByItem] = useState<
    Record<string, { id: string; name: string }[]>
  >({});
  const [targetStoreIds, setTargetStoreIds] = useState<string[]>([]);
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignMsg, setAssignMsg] = useState("");
  const [form, setForm] = useState({
    name: "",
    categoryId: "",
    price: "5.00",
    sku: "",
    barcode: "",
    stockQty: "20",
    trackStock: true,
  });

  async function load() {
    const [its, cats, presence] = await Promise.all([
      api<typeof items>("/catalog/items"),
      api<typeof categories>("/catalog/categories"),
      api<{
        currentStoreId: string;
        stores: { id: string; name: string; slug?: string }[];
        presence: { itemId: string; stores: { id: string; name: string }[] }[];
      }>("/catalog/items/store-presence").catch(() => null),
    ]);
    setItems(its);
    setCategories(cats);
    if (presence) {
      setCurrentStoreId(presence.currentStoreId);
      setBranchStores(presence.stores);
      setPresenceByItem(
        Object.fromEntries(presence.presence.map((p) => [p.itemId, p.stores]))
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const otherStores = branchStores.filter((s) => s.id !== currentStoreId);

  function toggleSelected(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleAllFiltered() {
    const ids = filtered.map((i) => i.id);
    const allOn = ids.length > 0 && ids.every((id) => selectedIds.includes(id));
    setSelectedIds(allOn ? selectedIds.filter((id) => !ids.includes(id)) : [...new Set([...selectedIds, ...ids])]);
  }

  async function assignToBranches(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedIds.length || !targetStoreIds.length) {
      setAssignMsg("Select at least one item and one branch.");
      return;
    }
    setAssignBusy(true);
    setAssignMsg("");
    try {
      const result = await api<{
        message: string;
        createdCount: number;
        skippedCount: number;
      }>("/catalog/items/assign-stores", {
        method: "POST",
        body: JSON.stringify({ itemIds: selectedIds, storeIds: targetStoreIds, stockQty: 0 }),
      });
      setAssignMsg(
        `${result.message}${result.skippedCount ? ` (${result.skippedCount} already present / skipped)` : ""}`
      );
      setSelectedIds([]);
      await load();
    } catch (err) {
      setAssignMsg(err instanceof Error ? err.message : "Could not assign items");
    } finally {
      setAssignBusy(false);
    }
  }

  const groupName = (categoryId: string | null) =>
    categoryId ? categories.find((c) => c.id === categoryId)?.name ?? "Group" : "Ungrouped";

  const filtered = items.filter((i) => {
    if (groupFilter === "none" && i.categoryId) return false;
    if (groupFilter !== "all" && groupFilter !== "none" && i.categoryId !== groupFilter) return false;
    if (!q) return true;
    const needle = q.toLowerCase();
    return (
      i.name.toLowerCase().includes(needle) ||
      groupName(i.categoryId).toLowerCase().includes(needle) ||
      i.variants.some((v) => v.sku.toLowerCase().includes(needle))
    );
  });

  async function createItem(e: React.FormEvent) {
    e.preventDefault();
    await api("/catalog/items", {
      method: "POST",
      body: JSON.stringify({
        name: form.name,
        categoryId: form.categoryId || null,
        priceCents: Math.round(parseFloat(form.price) * 100),
        sku: form.sku || `SKU-${Date.now()}`,
        barcode: form.barcode || undefined,
        stockQty: parseFloat(form.stockQty || "0"),
        trackStock: form.trackStock,
      }),
    });
    setShowForm(false);
    setForm({ name: "", categoryId: "", price: "5.00", sku: "", barcode: "", stockQty: "20", trackStock: true });
    await load();
  }

  function openEdit(item: (typeof items)[number]) {
    const variant = item.variants[0];
    setEditMods(null);
    setShowForm(false);
    setEditItem(item);
    setEditForm({
      name: item.name,
      categoryId: item.categoryId ?? "",
      price: ((variant?.priceCents ?? 0) / 100).toFixed(2),
      sku: variant?.sku ?? "",
      barcode: variant?.barcode ?? "",
      trackStock: variant?.trackStock ?? true,
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editItem) return;
    await api(`/catalog/items/${editItem.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: editForm.name.trim(),
        categoryId: editForm.categoryId || null,
        priceCents: Math.round(parseFloat(editForm.price) * 100),
        sku: editForm.sku.trim() || undefined,
        barcode: editForm.barcode.trim() || null,
        trackStock: editForm.trackStock,
      }),
    });
    setEditItem(null);
    await load();
  }

  async function addPizzaMenu() {
    setPizzaBusy(true);
    setPizzaMsg("");
    try {
      const result = await api<{ message: string; created: string[]; skipped: string[] }>("/catalog/pizza-menu", {
        method: "POST",
        body: "{}",
      });
      setPizzaMsg(result.message);
      await load();
    } catch (err) {
      setPizzaMsg(err instanceof Error ? err.message : "Could not add pizza menu");
    } finally {
      setPizzaBusy(false);
    }
  }

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    setGroupBusy(true);
    setGroupMsg("");
    try {
      await api("/catalog/categories", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setNewGroupName("");
      setGroupMsg(`Group “${name}” added`);
      await load();
    } catch (err) {
      setGroupMsg(err instanceof Error ? err.message : "Could not add group");
    } finally {
      setGroupBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Items</h2>
          <p>Items in groups — filter by group so staff can see what’s what</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="secondary" onClick={() => setShowGroups((v) => !v)}>
            {showGroups ? "Hide groups" : "Manage groups"}
          </button>
          <button type="button" className="secondary" disabled={pizzaBusy} onClick={() => void addPizzaMenu()}>
            {pizzaBusy ? "Adding pizzas…" : "Add pizza menu"}
          </button>
          <button type="button" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Close" : "Add item"}
          </button>
        </div>
      </div>
      {pizzaMsg && <p style={{ color: "var(--muted)" }}>{pizzaMsg}</p>}

      {showGroups && (
        <form className="panel-box" onSubmit={(e) => void createGroup(e)}>
          <h3>Item groups</h3>
          <p style={{ color: "var(--muted)", marginTop: 0 }}>
            Groups organise the menu (Drinks, Food, Retail…). Same groups appear as chips on the till.
          </p>
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <input
              placeholder="New group name"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              required
            />
            <button type="submit" disabled={groupBusy}>
              {groupBusy ? "Saving…" : "Add group"}
            </button>
          </div>
          {groupMsg && <p style={{ color: "var(--muted)" }}>{groupMsg}</p>}
          {categories.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No groups yet — add one above.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: "1.1rem", color: "var(--muted)" }}>
              {categories.map((c) => (
                <li key={c.id}>
                  <strong style={{ color: "var(--ink)" }}>{c.name}</strong>
                  {" · "}
                  {items.filter((i) => i.categoryId === c.id).length} items
                </li>
              ))}
            </ul>
          )}
        </form>
      )}

      {showForm && (
        <form className="panel-box" onSubmit={(e) => void createItem(e)}>
          <h3>New item</h3>
          <div className="grid-2">
            <div className="field">
              <label>Name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field">
              <label>Group</label>
              <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">Ungrouped</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Price</label>
              <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            </div>
            <div className="field">
              <label>SKU</label>
              <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </div>
            <div className="field">
              <label>Barcode</label>
              <input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
            </div>
            <div className="field">
              <label>Opening stock</label>
              <input value={form.stockQty} onChange={(e) => setForm({ ...form, stockQty: e.target.value })} />
            </div>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={form.trackStock}
              onChange={(e) => setForm({ ...form, trackStock: e.target.checked })}
            />
            Track stock
          </label>
          <button type="submit">Save item</button>
        </form>
      )}

      <div className="toolbar">
        <input placeholder="Search items / SKU / group" value={q} onChange={(e) => setQ(e.target.value)} />
        <span style={{ color: "var(--muted)" }}>{filtered.length} items</span>
      </div>

      <div className="chip-row" role="tablist" aria-label="Filter by group" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className={`chip${groupFilter === "all" ? " active" : ""}`}
          onClick={() => setGroupFilter("all")}
        >
          All
        </button>
        <button
          type="button"
          className={`chip${groupFilter === "none" ? " active" : ""}`}
          onClick={() => setGroupFilter("none")}
        >
          Ungrouped
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`chip${groupFilter === c.id ? " active" : ""}`}
            onClick={() => setGroupFilter(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>

      {editItem && (
        <form className="panel-box" onSubmit={(e) => void saveEdit(e)}>
          <div className="page-head" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Edit · {editItem.name}</h3>
            <button type="button" className="secondary" onClick={() => setEditItem(null)}>
              Close
            </button>
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Name</label>
              <input required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="field">
              <label>Group</label>
              <select value={editForm.categoryId} onChange={(e) => setEditForm({ ...editForm, categoryId: e.target.value })}>
                <option value="">Ungrouped</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Price</label>
              <input value={editForm.price} onChange={(e) => setEditForm({ ...editForm, price: e.target.value })} />
            </div>
            <div className="field">
              <label>SKU</label>
              <input value={editForm.sku} onChange={(e) => setEditForm({ ...editForm, sku: e.target.value })} />
            </div>
            <div className="field">
              <label>Barcode</label>
              <input value={editForm.barcode} onChange={(e) => setEditForm({ ...editForm, barcode: e.target.value })} />
            </div>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={editForm.trackStock}
              onChange={(e) => setEditForm({ ...editForm, trackStock: e.target.checked })}
            />
            Track stock
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="submit">Save item</button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setEditMods({ id: editItem.id, name: editForm.name });
                setEditItem(null);
              }}
            >
              Edit options
            </button>
          </div>
        </form>
      )}

      {editMods && (
        <ModifierEditor itemId={editMods.id} itemName={editMods.name} onClose={() => { setEditMods(null); void load(); }} />
      )}

      <form className="panel-box" onSubmit={(e) => void assignToBranches(e)}>
        <h3>Send items to branches</h3>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          Tick items below, pick branches, then send. Copies the item (and its group) onto those stores by SKU —
          skips if already there. Opening stock on the new branch starts at 0.
        </p>
        {otherStores.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>
            Only one store in this account. Add another branch under <strong>Stores &amp; registers</strong> first.
          </p>
        ) : (
          <>
            <div className="chip-row" style={{ marginBottom: 12 }} aria-label="Destination branches">
              {otherStores.map((s) => {
                const on = targetStoreIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`chip${on ? " active" : ""}`}
                    onClick={() =>
                      setTargetStoreIds((prev) =>
                        on ? prev.filter((id) => id !== s.id) : [...prev, s.id]
                      )
                    }
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
            <div className="toolbar">
              <span style={{ color: "var(--muted)" }}>
                {selectedIds.length} selected · {targetStoreIds.length} branch
                {targetStoreIds.length === 1 ? "" : "es"}
              </span>
              <button type="submit" disabled={assignBusy || !selectedIds.length || !targetStoreIds.length}>
                {assignBusy ? "Sending…" : "Send to branches"}
              </button>
            </div>
          </>
        )}
        {assignMsg && <p style={{ color: "var(--muted)" }}>{assignMsg}</p>}
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all filtered items"
                  checked={filtered.length > 0 && filtered.every((i) => selectedIds.includes(i.id))}
                  onChange={() => toggleAllFiltered()}
                />
              </th>
              <th>Item</th>
              <th>Group</th>
              <th>Also on</th>
              <th>SKU</th>
              <th>Barcode</th>
              <th>Price</th>
              <th>Stock</th>
              <th>Modifiers</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} style={{ color: "var(--muted)" }}>
                  No items in this group — add an item or choose another group.
                </td>
              </tr>
            )}
            {filtered.map((item) => {
              const v = item.variants[0];
              const elsewhere = presenceByItem[item.id] ?? [];
              return (
                <tr key={item.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => toggleSelected(item.id)}
                      aria-label={`Select ${item.name}`}
                    />
                  </td>
                  <td>
                    <strong>{item.name}</strong>
                    {item.isComposite && <span className="badge" style={{ marginLeft: 8 }}>Kit</span>}
                  </td>
                  <td>
                    <span className="badge">{groupName(item.categoryId)}</span>
                  </td>
                  <td style={{ color: "var(--muted)", fontSize: "0.88rem" }}>
                    {elsewhere.length
                      ? elsewhere.map((s) => s.name).join(", ")
                      : "This store only"}
                  </td>
                  <td>{v?.sku}</td>
                  <td>{v?.barcode ?? "—"}</td>
                  <td>{money(v?.priceCents ?? 0)}</td>
                  <td>
                    {v?.trackStock ? v.stockQty : <span className="badge">Not tracked</span>}
                  </td>
                  <td>
                    {item.modifierGroups.length
                      ? item.modifierGroups.map((g) => g.name).join(", ")
                      : "—"}
                  </td>
                  <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" className="secondary" onClick={() => openEdit(item)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setEditMods({ id: item.id, name: item.name })}
                    >
                      Options
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ModifiersPage() {
  const [items, setItems] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState("");

  async function load() {
    const rows = await api<
      {
        id: string;
        name: string;
      }[]
    >("/catalog/items");
    setItems(rows.map((item) => ({ id: item.id, name: item.name })));
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Could not load items"));
  }, []);

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Modifiers</h2>
          <p>Create modifier menus and assign them to items from the left list</p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <ModifierLibrary items={items} onChange={() => void load()} />
    </div>
  );
}

function InventoryPage() {
  const [levels, setLevels] = useState<
    {
      id: string;
      itemName: string;
      sku: string;
      quantity: number;
      lowStock: number;
      isLow: boolean;
      storeName: string;
      storeId: string;
      variantId: string;
      trackStock: boolean;
    }[]
  >([]);
  const [history, setHistory] = useState<{ type: string; quantity: number; note: string | null; createdAt: string; variantId: string }[]>([]);
  const [transfers, setTransfers] = useState<
    {
      id: string;
      fromStoreName: string;
      toStoreName: string;
      itemName: string;
      sku: string;
      quantity: number;
      status: string;
      createdAt: string;
      note: string | null;
    }[]
  >([]);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [lowOnly, setLowOnly] = useState(false);
  const [receive, setReceive] = useState({ variantId: "", quantity: "10", note: "" });
  const [xfer, setXfer] = useState({ fromStoreId: "", toStoreId: "", variantId: "", quantity: "5", note: "" });

  async function load() {
    const [lv, hist, xfers, allStores] = await Promise.all([
      api<typeof levels>(`/inventory/levels${lowOnly ? "?low=1" : ""}`),
      api<typeof history>("/inventory/history"),
      api<typeof transfers>("/inventory/transfers"),
      api<{ id: string; name: string }[]>("/auth/stores"),
    ]);
    setLevels(lv);
    setHistory(hist);
    setTransfers(xfers);
    setStores(allStores);
    if (!receive.variantId && lv[0]) setReceive((r) => ({ ...r, variantId: lv[0].variantId }));
    if (!xfer.fromStoreId && allStores[0]) {
      setXfer((x) => ({
        ...x,
        fromStoreId: allStores[0].id,
        toStoreId: allStores[1]?.id ?? allStores[0].id,
        variantId: lv.find((l) => l.trackStock)?.variantId ?? "",
      }));
    }
  }

  useEffect(() => {
    void load();
  }, [lowOnly]);

  async function doReceive(e: React.FormEvent) {
    e.preventDefault();
    await api("/inventory/receive", {
      method: "POST",
      body: JSON.stringify({
        variantId: receive.variantId,
        quantity: parseFloat(receive.quantity),
        note: receive.note || "Receive stock",
      }),
    });
    await load();
  }

  async function doTransfer(e: React.FormEvent) {
    e.preventDefault();
    await api("/inventory/transfers", {
      method: "POST",
      body: JSON.stringify({
        fromStoreId: xfer.fromStoreId,
        toStoreId: xfer.toStoreId,
        variantId: xfer.variantId,
        quantity: parseFloat(xfer.quantity),
        note: xfer.note || undefined,
      }),
    });
    await load();
  }

  const uniqueVariants = Array.from(
    new Map(levels.filter((l) => l.trackStock).map((l) => [l.variantId, l])).values()
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Inventory</h2>
          <p>Levels, receive, transfers, low stock, history</p>
        </div>
        <button type="button" className="secondary" onClick={() => setLowOnly((v) => !v)}>
          {lowOnly ? "Show all" : "Low stock only"}
        </button>
      </div>

      <form className="panel-box" onSubmit={(e) => void doReceive(e)}>
        <h3>Receive stock</h3>
        <div className="grid-2">
          <div className="field">
            <label>Item</label>
            <select value={receive.variantId} onChange={(e) => setReceive({ ...receive, variantId: e.target.value })}>
              {uniqueVariants.map((l) => (
                <option key={l.variantId} value={l.variantId}>
                  {l.itemName} ({l.sku})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Quantity</label>
            <input value={receive.quantity} onChange={(e) => setReceive({ ...receive, quantity: e.target.value })} />
          </div>
          <div className="field">
            <label>Note</label>
            <input value={receive.note} onChange={(e) => setReceive({ ...receive, note: e.target.value })} />
          </div>
        </div>
        <button type="submit">Receive</button>
      </form>

      <form className="panel-box" onSubmit={(e) => void doTransfer(e)}>
        <h3>Store-to-store transfer</h3>
        <div className="grid-2">
          <div className="field">
            <label>From</label>
            <select value={xfer.fromStoreId} onChange={(e) => setXfer({ ...xfer, fromStoreId: e.target.value })}>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>To</label>
            <select value={xfer.toStoreId} onChange={(e) => setXfer({ ...xfer, toStoreId: e.target.value })}>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Item</label>
            <select value={xfer.variantId} onChange={(e) => setXfer({ ...xfer, variantId: e.target.value })}>
              {uniqueVariants.map((l) => (
                <option key={l.variantId} value={l.variantId}>
                  {l.itemName} ({l.sku})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Quantity</label>
            <input value={xfer.quantity} onChange={(e) => setXfer({ ...xfer, quantity: e.target.value })} />
          </div>
          <div className="field">
            <label>Note</label>
            <input value={xfer.note} onChange={(e) => setXfer({ ...xfer, note: e.target.value })} />
          </div>
        </div>
        <button type="submit">Transfer</button>
      </form>

      <div className="table-wrap" style={{ marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>From → To</th>
              <th>Item</th>
              <th>Qty</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {transfers.map((t) => (
              <tr key={t.id}>
                <td>{new Date(t.createdAt).toLocaleString()}</td>
                <td>
                  {t.fromStoreName} → {t.toStoreName}
                </td>
                <td>
                  {t.itemName} ({t.sku})
                </td>
                <td>{t.quantity}</td>
                <td>
                  <span className="badge">{t.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-wrap" style={{ marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Store</th>
              <th>SKU</th>
              <th>Qty</th>
              <th>Low at</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {levels.map((l) => (
              <tr key={l.id}>
                <td>{l.itemName}</td>
                <td>{l.storeName}</td>
                <td>{l.sku}</td>
                <td>{l.quantity}</td>
                <td>{l.lowStock}</td>
                <td>{l.isLow ? <span className="badge warn">Low</span> : <span className="badge">OK</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="page-head">
        <div>
          <h2 style={{ fontSize: "1.3rem" }}>Movement history</h2>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th>Qty</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {history.slice(0, 40).map((h, i) => (
              <tr key={i}>
                <td>{new Date(h.createdAt).toLocaleString()}</td>
                <td>{h.type}</td>
                <td>{h.quantity}</td>
                <td>{h.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CustomersPage() {
  const [customers, setCustomers] = useState<
    {
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      loyaltyPoints: number;
      storeCreditCents: number;
      totalSpentCents: number;
      visitCount: number;
    }[]
  >([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    name: string;
    sales: { receiptNumber: string; totalCents: number; createdAt: string; status: string }[];
  } | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", storeCreditCents: "0" });

  async function load() {
    setCustomers(await api("/customers"));
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selected) return;
    void api<typeof detail>(`/customers/${selected}`).then(setDetail);
  }, [selected]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    await api("/customers", {
      method: "POST",
      body: JSON.stringify({
        name: form.name,
        email: form.email || undefined,
        phone: form.phone || undefined,
        storeCreditCents: Math.round(parseFloat(form.storeCreditCents || "0") * 100),
      }),
    });
    setForm({ name: "", email: "", phone: "", storeCreditCents: "0" });
    await load();
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Customers</h2>
          <p>Purchase history, loyalty points, store credit</p>
        </div>
      </div>
      <form className="panel-box" onSubmit={(e) => void create(e)}>
        <h3>Add customer</h3>
        <div className="grid-2">
          <div className="field">
            <label>Name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Email</label>
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field">
            <label>Phone</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="field">
            <label>Store credit (£)</label>
            <input value={form.storeCreditCents} onChange={(e) => setForm({ ...form, storeCreditCents: e.target.value })} />
          </div>
        </div>
        <button type="submit">Save</button>
      </form>
      <div className="grid-2">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Points</th>
                <th>Credit</th>
                <th>Spent</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => setSelected(c.id)}>
                  <td>{c.name}</td>
                  <td>{c.loyaltyPoints}</td>
                  <td>{money(c.storeCreditCents)}</td>
                  <td>{money(c.totalSpentCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel-box">
          <h3>{detail?.name ?? "Select a customer"}</h3>
          {detail?.sales?.length ? (
            <table>
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {detail.sales.map((s) => (
                  <tr key={s.receiptNumber}>
                    <td>{s.receiptNumber}</td>
                    <td>{money(s.totalCents)}</td>
                    <td>{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ color: "var(--muted)" }}>No sales yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function EmployeesPage() {
  const [employees, setEmployees] = useState<
    { id: string; name: string; email: string; role: string; active: boolean; pinDisplay: string }[]
  >([]);
  const [form, setForm] = useState({ name: "", email: "", pin: "3333", role: "cashier" });

  async function load() {
    setEmployees(await api("/employees"));
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    await api("/employees", {
      method: "POST",
      body: JSON.stringify(form),
    });
    await load();
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Employees</h2>
          <p>Roles (owner / manager / cashier) and PIN login</p>
        </div>
      </div>
      <form className="panel-box" onSubmit={(e) => void create(e)}>
        <h3>Add employee</h3>
        <div className="grid-2">
          <div className="field">
            <label>Name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Email</label>
            <input required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field">
            <label>PIN</label>
            <input required value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} />
          </div>
          <div className="field">
            <label>Role</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="cashier">Cashier</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </select>
          </div>
        </div>
        <button type="submit">Save</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>PIN (demo)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id}>
                <td>{e.name}</td>
                <td>{e.email}</td>
                <td>{e.role}</td>
                <td>{e.pinDisplay}</td>
                <td>{e.active ? <span className="badge">Active</span> : <span className="badge danger">Inactive</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export async function switchStore(storeId: string) {
  const data = await api<{ token: string }>("/auth/switch-store", {
    method: "POST",
    body: JSON.stringify({ storeId }),
  });
  setToken(data.token);
  window.location.reload();
}

function StoresPage() {
  const [settings, setSettings] = useState<{
    store: { id: string; name: string; address: string | null; currency: string };
    registers: { id: string; name: string }[];
  } | null>(null);
  const [stores, setStores] = useState<{ id: string; name: string; address: string | null; registers: { name: string }[] }[]>([]);
  const [regName, setRegName] = useState("");
  const [branch, setBranch] = useState({ name: "", address: "", phone: "" });
  const [branchMsg, setBranchMsg] = useState("");
  const [role, setRole] = useState("");
  const [hasBranches, setHasBranches] = useState(false);

  async function load() {
    const [sett, all, me, billing] = await Promise.all([
      api<NonNullable<typeof settings>>("/settings"),
      api<typeof stores>("/auth/stores"),
      api<{ user: { role: string } }>("/auth/me"),
      api<{ features: string[] }>("/billing").catch(() => ({ features: [] as string[] })),
    ]);
    setSettings(sett);
    setStores(all);
    setRole(me.user.role);
    setHasBranches(billing.features.includes("multi_store"));
  }

  async function addBranch(e: React.FormEvent) {
    e.preventDefault();
    setBranchMsg("");
    try {
      const created = await api<{ name: string }>("/auth/stores", {
        method: "POST",
        body: JSON.stringify({
          name: branch.name.trim(),
          address: branch.address.trim() || undefined,
          phone: branch.phone.trim() || undefined,
        }),
      });
      setBranch({ name: "", address: "", phone: "" });
      setBranchMsg(`${created.name} added. Switch to it to add staff, or send items from Items → Assign to branches.`);
      await load();
    } catch (err) {
      setBranchMsg(err instanceof Error ? err.message : "Could not add branch");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function addRegister(e: React.FormEvent) {
    e.preventDefault();
    await api("/employees/registers", { method: "POST", body: JSON.stringify({ name: regName }) });
    setRegName("");
    await load();
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Stores & registers</h2>
          <p>Your business’s stores · registers for the active store</p>
        </div>
      </div>
      <div className="table-wrap" style={{ marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Store</th>
              <th>Address</th>
              <th>Registers</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {stores.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.name}
                  {settings?.store.id === s.id && <span className="badge" style={{ marginLeft: 8 }}>Current</span>}
                  <div style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: 4 }}>
                    {s.registers.length ? s.registers.map((r) => r.name).join(", ") : "No register yet"}
                  </div>
                </td>
                <td>{s.address}</td>
                <td>{s.registers.map((r) => r.name).join(", ") || "—"}</td>
                <td>
                  {settings?.store.id !== s.id && (role === "owner" || role === "manager") && (
                    <button type="button" className="secondary" onClick={() => void switchStore(s.id)}>
                      Switch to
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {role === "owner" && (
        <form className="panel-box" onSubmit={(e) => void addBranch(e)}>
          <h3>Add a branch</h3>
          {hasBranches ? (
            <>
              <p style={{ color: "var(--muted)", marginTop: 0 }}>
                A new site for your business. It gets its own till register, VAT and payment types copied from this
                store, and you can move stock and items between branches.
              </p>
              <div className="field">
                <label htmlFor="branch-name">Branch name</label>
                <input
                  id="branch-name"
                  required
                  minLength={2}
                  placeholder="e.g. Salford"
                  value={branch.name}
                  onChange={(e) => setBranch({ ...branch, name: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="branch-address">Address</label>
                <input
                  id="branch-address"
                  value={branch.address}
                  onChange={(e) => setBranch({ ...branch, address: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="branch-phone">Phone</label>
                <input
                  id="branch-phone"
                  type="tel"
                  value={branch.phone}
                  onChange={(e) => setBranch({ ...branch, phone: e.target.value })}
                />
              </div>
              <button type="submit">Add branch</button>
            </>
          ) : (
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              Branches are part of the <strong>Group</strong> plan. Upgrade in Settings → Billing to add more sites.
            </p>
          )}
          {branchMsg && <p style={{ marginBottom: 0 }}>{branchMsg}</p>}
        </form>
      )}
      <form className="panel-box" onSubmit={(e) => void addRegister(e)}>
        <h3>Add register to current store</h3>
        <div className="field">
          <label>Name</label>
          <input required value={regName} onChange={(e) => setRegName(e.target.value)} />
        </div>
        <button type="submit">Add register</button>
      </form>
    </div>
  );
}

function SalesPage() {
  const [sales, setSales] = useState<
    {
      id: string;
      receiptNumber: string;
      employeeName: string;
      customerName: string | null;
      totalCents: number;
      status: string;
      createdAt: string;
      lines: { name: string; quantity: number; totalCents: number }[];
      payments: { paymentTypeName: string; amountCents: number }[];
      taxCents: number;
      tipCents: number;
      discountCents: number;
      subtotalCents: number;
      changeCents: number;
    }[]
  >([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<(typeof sales)[0] | null>(null);

  async function load() {
    setSales(await api(`/sales${q ? `?q=${encodeURIComponent(q)}` : ""}`));
  }

  useEffect(() => {
    void load();
  }, []);

  async function voidSale(id: string) {
    await api(`/sales/${id}/void`, { method: "POST" });
    await load();
    setSelected(null);
  }

  async function refundSale(id: string) {
    await api(`/sales/${id}/refund`, { method: "POST", body: JSON.stringify({ full: true }) });
    await load();
    setSelected(null);
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Sales history</h2>
          <p>Void, refund, reprint receipt</p>
        </div>
      </div>
      <div className="toolbar">
        <input placeholder="Search receipt / customer" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="secondary" onClick={() => void load()}>
          Search
        </button>
      </div>
      <div className="grid-2">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Employee</th>
                <th>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id}>
                  <td>
                    <button type="button" className="secondary" onClick={() => setSelected(s)}>
                      {s.receiptNumber}
                    </button>
                  </td>
                  <td>{s.employeeName}</td>
                  <td>{money(s.totalCents)}</td>
                  <td>
                    <span className={`badge ${s.status !== "completed" ? "warn" : ""}`}>{s.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel-box">
          <h3>{selected ? selected.receiptNumber : "Select a sale"}</h3>
          {selected && (
            <>
              <pre style={{ background: "#f7f8f6", padding: 12, borderRadius: 10, whiteSpace: "pre-wrap" }}>
                {[
                  `Receipt ${selected.receiptNumber}`,
                  `Cashier: ${selected.employeeName}`,
                  selected.customerName ? `Customer: ${selected.customerName}` : null,
                  "---",
                  ...selected.lines.map((l) => `${l.quantity} x ${l.name}  ${money(l.totalCents)}`),
                  "---",
                  `Subtotal ${money(selected.subtotalCents)}`,
                  `Discount ${money(selected.discountCents)}`,
                  `Tax ${money(selected.taxCents)}`,
                  `Tip ${money(selected.tipCents)}`,
                  `TOTAL ${money(selected.totalCents)}`,
                  ...selected.payments.map((p) => `${p.paymentTypeName} ${money(p.amountCents)}`),
                ]
                  .filter(Boolean)
                  .join("\n")}
              </pre>
              <div className="toolbar">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const token = getToken();
                    void fetch(`/api/sales/${selected.id}/receipt?format=html`, {
                      headers: { Authorization: `Bearer ${token}` },
                    })
                      .then((r) => r.text())
                      .then((html) => {
                        const w = window.open("", "_blank");
                        if (w) {
                          w.document.write(html);
                          w.document.close();
                        }
                      });
                  }}
                >
                  Print HTML
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    void api<{ payload: { data: string; textPreview: string } }>(`/sales/${selected.id}/print`, {
                      method: "POST",
                      body: JSON.stringify({ format: "escpos-base64", openDrawer: false }),
                    }).then((r) => {
                      const blob = new Blob([r.payload.textPreview], { type: "text/plain" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = `${selected.receiptNumber}-escpos-preview.txt`;
                      a.click();
                      // Also download raw base64 sidecar for bridges
                      const raw = new Blob([r.payload.data], { type: "text/plain" });
                      const b = document.createElement("a");
                      b.href = URL.createObjectURL(raw);
                      b.download = `${selected.receiptNumber}.escpos.b64`;
                      b.click();
                    })
                  }
                >
                  ESC/POS download
                </button>
                {selected.status === "completed" && (
                  <>
                    <button type="button" className="danger" onClick={() => void voidSale(selected.id)}>
                      Void
                    </button>
                    <button type="button" className="secondary" onClick={() => void refundSale(selected.id)}>
                      Refund
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ReportsPage() {
  const [summary, setSummary] = useState<Record<string, number | string> | null>(null);
  const [byItem, setByItem] = useState<{ name: string; qty: number; salesCents: number }[]>([]);
  const [byCat, setByCat] = useState<{ name: string; qty: number; salesCents: number }[]>([]);
  const [byEmp, setByEmp] = useState<{ name: string; receipts: number; salesCents: number }[]>([]);
  const [payments, setPayments] = useState<{ name: string; count: number; amountCents: number }[]>([]);
  const [taxes, setTaxes] = useState<{ totalTaxCents: number; taxableSalesCents: number } | null>(null);

  useEffect(() => {
    void Promise.all([
      api<Record<string, number | string>>("/reports/summary"),
      api<typeof byItem>("/reports/by-item"),
      api<typeof byCat>("/reports/by-category"),
      api<typeof byEmp>("/reports/by-employee"),
      api<typeof payments>("/reports/payments"),
      api<NonNullable<typeof taxes>>("/reports/taxes"),
    ]).then(([s, i, c, e, p, t]) => {
      setSummary(s);
      setByItem(i);
      setByCat(c);
      setByEmp(e);
      setPayments(p);
      setTaxes(t);
    });
  }, []);

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Reports</h2>
          <p>Sales, by item / category / employee, payments, taxes, shifts</p>
        </div>
      </div>
      <div className="cards">
        <div className="stat">
          <div className="label">Gross</div>
          <div className="value">{money(Number(summary?.grossSalesCents ?? 0))}</div>
        </div>
        <div className="stat">
          <div className="label">Receipts</div>
          <div className="value">{Number(summary?.receiptCount ?? 0)}</div>
        </div>
        <div className="stat">
          <div className="label">Tax</div>
          <div className="value">{money(taxes?.totalTaxCents ?? 0)}</div>
        </div>
        <div className="stat">
          <div className="label">Taxable sales</div>
          <div className="value">{money(taxes?.taxableSalesCents ?? 0)}</div>
        </div>
      </div>

      <div className="grid-2">
        <ReportTable title="By item" rows={byItem.map((r) => [r.name, String(r.qty), money(r.salesCents)])} headers={["Item", "Qty", "Sales"]} />
        <ReportTable title="By category" rows={byCat.map((r) => [r.name, String(r.qty), money(r.salesCents)])} headers={["Category", "Qty", "Sales"]} />
        <ReportTable title="By employee" rows={byEmp.map((r) => [r.name, String(r.receipts), money(r.salesCents)])} headers={["Employee", "Receipts", "Sales"]} />
        <ReportTable title="Payments" rows={payments.map((r) => [r.name, String(r.count), money(r.amountCents)])} headers={["Type", "Count", "Amount"]} />
      </div>
    </div>
  );
}

function ReportTable({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) {
  return (
    <div className="panel-box">
      <h3>{title}</h3>
      <div className="table-wrap" style={{ border: "none" }}>
        <table>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ShiftsPage() {
  const [shifts, setShifts] = useState<
    {
      id: string;
      employeeName: string;
      registerName: string;
      openedAt: string;
      closedAt: string | null;
      openingFloatCents: number;
      closingCashCents: number | null;
      expectedCashCents: number | null;
      differenceCents: number | null;
      status: string;
    }[]
  >([]);

  useEffect(() => {
    void api<typeof shifts>("/shifts").then(setShifts);
  }, []);

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Shifts</h2>
          <p>Cash management history from the register</p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Register</th>
              <th>Opened</th>
              <th>Closed</th>
              <th>Float</th>
              <th>Expected</th>
              <th>Counted</th>
              <th>Diff</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((s) => (
              <tr key={s.id}>
                <td>{s.employeeName}</td>
                <td>{s.registerName}</td>
                <td>{new Date(s.openedAt).toLocaleString()}</td>
                <td>{s.closedAt ? new Date(s.closedAt).toLocaleString() : "—"}</td>
                <td>{money(s.openingFloatCents)}</td>
                <td>{s.expectedCashCents != null ? money(s.expectedCashCents) : "—"}</td>
                <td>{s.closingCashCents != null ? money(s.closingCashCents) : "—"}</td>
                <td>{s.differenceCents != null ? money(s.differenceCents) : "—"}</td>
                <td>
                  <span className={`badge ${s.status === "open" ? "warn" : ""}`}>{s.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type StoreDetails = {
  name: string;
  address: string | null;
  phone: string | null;
  currency: string;
  timezone: string;
  slug: string;
  listedPublicly: boolean;
  customDomain: string | null;
};

function StoreDetailsForm({
  store,
  orderingHost,
  onSaved,
}: {
  store: StoreDetails;
  orderingHost: string;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: store.name,
    address: store.address ?? "",
    phone: store.phone ?? "",
    listedPublicly: store.listedPublicly,
    customDomain: store.customDomain ?? "",
  });
  const [msg, setMsg] = useState("");
  const orderUrl = `${window.location.origin}/order/${store.slug}`;
  const domainPreview = form.customDomain.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/\.$/, "");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      await api("/settings/store", {
        method: "PATCH",
        body: JSON.stringify({
          name: form.name.trim(),
          address: form.address.trim() || null,
          phone: form.phone.trim() || null,
          listedPublicly: form.listedPublicly,
          customDomain: form.customDomain.trim(),
        }),
      });
      setMsg("Saved");
      onSaved();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <form className="panel-box" onSubmit={(e) => void save(e)}>
      <h3>Store details</h3>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        {store.currency} · {store.timezone}
      </p>
      <div className="field">
        <label htmlFor="store-name">Store name</label>
        <input id="store-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="store-address">Address</label>
        <input id="store-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="store-phone">Phone</label>
        <input
          id="store-phone"
          type="tel"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={form.listedPublicly}
          onChange={(e) => setForm({ ...form, listedPublicly: e.target.checked })}
        />
        <span>
          List this store in the public PurePOS store directory (shows name, address and phone). Off by default — your
          ordering link works either way.
        </span>
      </label>
      <p style={{ fontSize: "0.88rem", color: "var(--muted)" }}>
        Ordering link:{" "}
        <a href={orderUrl} target="_blank" rel="noreferrer">
          {orderUrl}
        </a>
      </p>
      <div className="field">
        <label htmlFor="store-domain">Your domain</label>
        <input
          id="store-domain"
          value={form.customDomain}
          placeholder="order.theircafe.co.uk"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setForm({ ...form, customDomain: e.target.value })}
        />
      </div>
      {domainPreview.includes(".") ? (
        <p style={{ fontSize: "0.88rem" }}>
          At your domain registrar, add this DNS record for this store:
          <br />
          <code>
            {domainPreview} CNAME {orderingHost}
          </code>
        </p>
      ) : (
        <p style={{ fontSize: "0.88rem", color: "var(--muted)" }}>
          One domain for this store, such as order.theircafe.co.uk. Leave it blank to use only the PurePOS ordering link.
        </p>
      )}
      <div className="toolbar">
        <button type="submit">Save store details</button>
        {msg && <span style={{ color: "var(--muted)" }}>{msg}</span>}
      </div>
    </form>
  );
}

const BILLING_STATUS_LABEL: Record<string, string> = {
  trialing: "free trial",
  active: "paid",
  past_due: "payment overdue",
  expired: "trial ended",
  canceled: "cancelled",
};

function SettingsPage() {
  const [settings, setSettings] = useState<{
    store: StoreDetails;
    orderingHost: string;
    receipt: { header: string; footer: string; showTaxBreakdown: boolean };
    taxes: { id: string; name: string; rateBps: number; enabled: boolean }[];
    paymentTypes: { id: string; name: string; type: string; enabled: boolean; opensDrawer: boolean }[];
  } | null>(null);
  const [billing, setBilling] = useState<{
    planId: string;
    status: string;
    trialEndsAt: string | null;
    licensedPlanId: string | null;
    canSwitchTo: string[];
    plan: { name: string; monthlyGbp: number; highlights: string[]; features: string[] };
  } | null>(null);
  const [billingMsg, setBillingMsg] = useState("");
  const [receipt, setReceipt] = useState({ header: "", footer: "" });
  const [taxForm, setTaxForm] = useState({ name: "VAT", rate: "20" });
  const [ptForm, setPtForm] = useState({ name: "", type: "other" });
  const [pilotMsg, setPilotMsg] = useState("");
  const [backupMsg, setBackupMsg] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [textPayStatus, setTextPayStatus] = useState<{
    stripe: { configured: boolean; note: string; requiredEnv: string[] };
    twilio: { configured: boolean; note: string; requiredEnv: string[] };
    publicPayBase: string;
  } | null>(null);
  const [textPayForm, setTextPayForm] = useState({ amount: "10.00", phone: "", note: "" });
  const [textPayMsg, setTextPayMsg] = useState("");
  const [textPayBusy, setTextPayBusy] = useState(false);
  const [textPayRecent, setTextPayRecent] = useState<
    { id: string; amountCents: number; status: string; payUrl: string; phone: string | null; createdAt: string }[]
  >([]);

  async function load() {
    const [s, b, tp, links] = await Promise.all([
      api<NonNullable<typeof settings>>("/settings"),
      api<NonNullable<typeof billing>>("/billing"),
      api<NonNullable<typeof textPayStatus>>("/text-pay/status").catch(() => null),
      api<typeof textPayRecent>("/text-pay/links").catch(() => [] as typeof textPayRecent),
    ]);
    setSettings(s);
    setBilling(b);
    setTextPayStatus(tp);
    setTextPayRecent(Array.isArray(links) ? links.slice(0, 8) : []);
    setReceipt({ header: s.receipt.header, footer: s.receipt.footer });
  }

  useEffect(() => {
    void load();
  }, []);

  if (!settings) return <p>Loading…</p>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Settings</h2>
          <p>Taxes, payment types, receipt, currency, billing</p>
        </div>
      </div>

      <StoreDetailsForm store={settings.store} orderingHost={settings.orderingHost} onSaved={() => void load()} />

      {billing && (
        <div className="panel-box">
          <h3>Billing</h3>
          <p>
            <strong>{billing.plan.name}</strong> · £{billing.plan.monthlyGbp}/mo · {BILLING_STATUS_LABEL[billing.status] ?? billing.status}
            {billing.status === "trialing" && billing.trialEndsAt
              ? ` until ${new Date(billing.trialEndsAt).toLocaleDateString("en-GB")}`
              : ""}
          </p>
          {(billing.status === "expired" || billing.status === "canceled") && (
            <p className="billing-alert">
              {billing.status === "expired" ? "Your free trial has ended." : "Your plan has been cancelled."} The till
              and back office keep working, but {billing.plan.name} features (online ordering, kitchen, delivery apps,
              import, reports, branches) are off until you buy a plan or enter a licence key below.
            </p>
          )}
          <ul style={{ color: "var(--muted)", marginTop: 8 }}>
            {billing.plan.highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          {billing.canSwitchTo.length > 1 && (
            <>
              <p style={{ fontSize: "0.88rem", color: "var(--muted)", marginBottom: 6 }}>
                {billing.status === "trialing"
                  ? "Try any plan during your trial:"
                  : "Switch within your licence:"}
              </p>
              <div className="toolbar">
                {(["starter", "pro", "multi"] as const)
                  .filter((planId) => billing.canSwitchTo.includes(planId))
                  .map((planId) => (
                    <button
                      key={planId}
                      type="button"
                      className={billing.planId === planId ? undefined : "secondary"}
                      onClick={() => {
                        setBillingMsg("");
                        void api("/billing/plan", { method: "PATCH", body: JSON.stringify({ planId }) })
                          .then(() => load())
                          .catch((err) => setBillingMsg(err instanceof Error ? err.message : "Could not change plan"));
                      }}
                    >
                      {planId === "starter" ? "Solo" : planId === "pro" ? "Shop" : "Group"}
                    </button>
                  ))}
              </div>
            </>
          )}
          <p style={{ fontSize: "0.88rem", color: "var(--muted)" }}>
            To upgrade beyond {billing.status === "trialing" ? "your trial" : "your licence"}, see the plans on the{" "}
            <a className="ghost-link" href="/#pricing" target="_blank" rel="noreferrer">
              PurePOS home page
            </a>
            . A licence key is entered here.
          </p>
          <form
            style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const licenseKey = String(new FormData(form).get("licenseKey") || "");
              setBillingMsg("");
              void api("/billing/activate-license", {
                method: "POST",
                body: JSON.stringify({ licenseKey }),
              })
                .then(() => {
                  form.reset();
                  setBillingMsg("Licence activated");
                  return load();
                })
                .catch((err) => setBillingMsg(err instanceof Error ? err.message : "Could not activate"));
            }}
          >
            <input name="licenseKey" required placeholder="PP-PRO-XXXX-XXXX-XXXX" style={{ minWidth: 240 }} />
            <button type="submit" className="secondary">
              Activate licence key
            </button>
          </form>
          {billingMsg && <p style={{ marginBottom: 0 }}>{billingMsg}</p>}
          <p style={{ marginTop: 10, fontSize: "0.88rem", color: "var(--muted)" }}>
            Solo: the till, items, live sync and backups. Shop adds online ordering, kitchen screens, delivery
            apps (Just Eat, Deliveroo, Uber Eats), spreadsheet import and fuller reports. Group adds extra
            branches, stock transfers between them and choosing which items each branch sells.
          </p>
        </div>
      )}

      <div className="panel-box">
        <h3>Phone orders · text to pay</h3>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          For <strong>phone orders</strong>: take the order on the till → <strong>Phone order</strong> → send an SMS
          pay link, or copy the link and send it yourself. You can also make a link for any amount here, for example
          a call-in tab.
        </p>
        <ol style={{ color: "var(--muted)", marginTop: 0, paddingLeft: 18, lineHeight: 1.45, fontSize: "0.92rem" }}>
          <li>
            Till: ring items → <strong>Phone order</strong> → mobile → <strong>Send pay link</strong>
          </li>
          <li>Customer opens the link and pays by card</li>
          <li>Till waits and completes the sale when paid</li>
        </ol>
        {textPayStatus && (
          <p style={{ fontSize: "0.88rem", color: "var(--muted)" }}>
            Card payments: {textPayStatus.stripe.configured ? "on" : "test mode (no real money taken)"} · Text
            messages: {textPayStatus.twilio.configured ? "on" : "off, so copy the link and send it yourself"}
          </p>
        )}
        <div className="toolbar" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Amount (£)</label>
            <input
              value={textPayForm.amount}
              onChange={(e) => setTextPayForm({ ...textPayForm, amount: e.target.value })}
              style={{ width: 100 }}
            />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Mobile</label>
            <input
              value={textPayForm.phone}
              placeholder="07…"
              onChange={(e) => setTextPayForm({ ...textPayForm, phone: e.target.value })}
            />
          </div>
          <div className="field" style={{ margin: 0, minWidth: 160 }}>
            <label>Note</label>
            <input
              value={textPayForm.note}
              placeholder="Phone order / caller name"
              onChange={(e) => setTextPayForm({ ...textPayForm, note: e.target.value })}
            />
          </div>
          <button
            type="button"
            disabled={textPayBusy}
            onClick={() => {
              const pounds = parseFloat(textPayForm.amount);
              if (!Number.isFinite(pounds) || pounds <= 0) {
                setTextPayMsg("Enter a valid amount");
                return;
              }
              setTextPayBusy(true);
              setTextPayMsg("");
              void api<{ message: string; link: { payUrl: string } }>("/text-pay/links", {
                method: "POST",
                body: JSON.stringify({
                  amountCents: Math.round(pounds * 100),
                  phone: textPayForm.phone.trim() || undefined,
                  note: textPayForm.note.trim() || "Phone order",
                  sendSms: Boolean(textPayForm.phone.trim()),
                }),
              })
                .then((r) => {
                  setTextPayMsg(`${r.message} · ${r.link.payUrl}`);
                  return load();
                })
                .catch((e) => setTextPayMsg(e instanceof Error ? e.message : "Failed"))
                .finally(() => setTextPayBusy(false));
            }}
          >
            {textPayBusy ? "…" : "Send pay link"}
          </button>
        </div>
        {textPayMsg && <p className="badge" style={{ marginTop: 10 }}>{textPayMsg}</p>}
        {textPayRecent.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {textPayRecent.map((l) => (
                  <tr key={l.id}>
                    <td>{new Date(l.createdAt).toLocaleString("en-GB")}</td>
                    <td>{money(l.amountCents)}</td>
                    <td>
                      <span className="badge">{l.status}</span>
                    </td>
                    <td style={{ fontSize: "0.78rem", wordBreak: "break-all" }}>
                      <a href={l.payUrl} target="_blank" rel="noreferrer">
                        Open
                      </a>
                      {l.phone ? ` · ${l.phone}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel-box">
        <h3>Backup &amp; restore</h3>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          Download a JSON backup of this store’s items, groups, stock levels, taxes, payment types, and settings.
          Restore replaces the catalog on this store (open tickets are cleared). Unsynced till sales: use the till{" "}
          <strong>Export</strong> button while Sync shows a count.
        </p>
        <div className="toolbar">
          <button
            type="button"
            className="secondary"
            disabled={backupBusy}
            onClick={() => {
              setBackupBusy(true);
              setBackupMsg("");
              void api<Record<string, unknown>>("/extras/backup")
                .then((data) => {
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                  const a = document.createElement("a");
                  const slug =
                    typeof (data.store as { slug?: string } | undefined)?.slug === "string"
                      ? (data.store as { slug: string }).slug
                      : "store";
                  a.href = URL.createObjectURL(blob);
                  a.download = `purepos-backup-${slug}-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(a.href);
                  const meta = data.meta as { itemCount?: number; categoryCount?: number } | undefined;
                  setBackupMsg(
                    `Backup downloaded · ${meta?.itemCount ?? "?"} items · ${meta?.categoryCount ?? "?"} groups`
                  );
                })
                .catch((e) => setBackupMsg(e instanceof Error ? e.message : "Backup failed"))
                .finally(() => setBackupBusy(false));
            }}
          >
            {backupBusy ? "Working…" : "Download backup"}
          </button>
          <label className="secondary" style={{ display: "inline-flex", alignItems: "center", minHeight: 40, padding: "0 14px", borderRadius: 10, cursor: "pointer", fontWeight: 700 }}>
            Restore from file…
            <input
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                if (
                  !confirm(
                    "Restore this backup into the current store? Catalog will be replaced and open tickets cleared. Sales history stays."
                  )
                ) {
                  return;
                }
                setBackupBusy(true);
                setBackupMsg("Restoring…");
                const reader = new FileReader();
                reader.onload = () => {
                  try {
                    const backup = JSON.parse(String(reader.result || "{}"));
                    void api<{ message: string }>("/extras/restore", {
                      method: "POST",
                      body: JSON.stringify({ backup, mode: "catalog", confirm: true }),
                    })
                      .then((r) => {
                        setBackupMsg(r.message);
                        return load();
                      })
                      .catch((err) => setBackupMsg(err instanceof Error ? err.message : "Restore failed"))
                      .finally(() => setBackupBusy(false));
                  } catch {
                    setBackupBusy(false);
                    setBackupMsg("That file is not valid JSON");
                  }
                };
                reader.readAsText(file);
              }}
            />
          </label>
        </div>
        {backupMsg && <p className="badge" style={{ marginTop: 10 }}>{backupMsg}</p>}
      </div>

      <div className="panel-box">
        <h3>Pilot tools</h3>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>Reset demo data or check API health.</p>
        <div className="toolbar">
          <button
            type="button"
            className="secondary"
            onClick={() =>
              void api<{ ok: boolean }>("/health")
                .then((h) => setPilotMsg(`Health OK · ${JSON.stringify(h)}`))
                .catch((e) => setPilotMsg(e instanceof Error ? e.message : "Health failed"))
            }
          >
            Check health
          </button>
          <button
            type="button"
            onClick={() => {
              if (!confirm("Wipe and reseed the demo database?")) return;
              void api<{ message: string }>("/extras/demo-reset", { method: "POST", body: "{}" })
                .then((r) => setPilotMsg(r.message))
                .catch((e) => setPilotMsg(e instanceof Error ? e.message : "Reset failed"));
            }}
          >
            Demo reset
          </button>
        </div>
        {pilotMsg && <p className="badge" style={{ marginTop: 10 }}>{pilotMsg}</p>}
      </div>

      <form
        className="panel-box"
        onSubmit={(e) => {
          e.preventDefault();
          void api("/settings/receipt", {
            method: "PATCH",
            body: JSON.stringify(receipt),
          }).then(() => load());
        }}
      >
        <h3>Receipt</h3>
        <div className="field">
          <label>Header</label>
          <input value={receipt.header} onChange={(e) => setReceipt({ ...receipt, header: e.target.value })} />
        </div>
        <div className="field">
          <label>Footer</label>
          <input value={receipt.footer} onChange={(e) => setReceipt({ ...receipt, footer: e.target.value })} />
        </div>
        <button type="submit">Save receipt</button>
      </form>

      <div className="grid-2">
        <div className="panel-box">
          <h3>Taxes</h3>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Rate</th>
                <th>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {settings.taxes.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{(t.rateBps / 100).toFixed(2)}%</td>
                  <td>{t.enabled ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <form
            style={{ marginTop: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              void api("/settings/taxes", {
                method: "POST",
                body: JSON.stringify({
                  name: taxForm.name,
                  rateBps: Math.round(parseFloat(taxForm.rate) * 100),
                }),
              }).then(() => load());
            }}
          >
            <div className="field">
              <label>Name</label>
              <input value={taxForm.name} onChange={(e) => setTaxForm({ ...taxForm, name: e.target.value })} />
            </div>
            <div className="field">
              <label>Rate %</label>
              <input value={taxForm.rate} onChange={(e) => setTaxForm({ ...taxForm, rate: e.target.value })} />
            </div>
            <button type="submit">Add tax</button>
          </form>
        </div>

        <div className="panel-box">
          <h3>Payment types</h3>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Drawer</th>
              </tr>
            </thead>
            <tbody>
              {settings.paymentTypes.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.type}</td>
                  <td>{p.opensDrawer ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <form
            style={{ marginTop: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              void api("/settings/payment-types", {
                method: "POST",
                body: JSON.stringify(ptForm),
              }).then(() => load());
            }}
          >
            <div className="field">
              <label>Name</label>
              <input value={ptForm.name} onChange={(e) => setPtForm({ ...ptForm, name: e.target.value })} required />
            </div>
            <div className="field">
              <label>Type</label>
              <select value={ptForm.type} onChange={(e) => setPtForm({ ...ptForm, type: e.target.value })}>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="other">Other</option>
                <option value="store_credit">Store credit</option>
              </select>
            </div>
            <button type="submit">Add payment type</button>
          </form>
        </div>
      </div>
    </div>
  );
}
