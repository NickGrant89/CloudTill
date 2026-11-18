import { useEffect, useState } from "react";
import { api, getToken, money } from "./api";
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

export function Pages({ page }: { page: PageId }) {
  switch (page) {
    case "dashboard":
      return <Dashboard />;
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

function Dashboard() {
  const [summary, setSummary] = useState<{
    receiptCount: number;
    grossSalesCents: number;
    taxCents: number;
    tipCents: number;
    avgTicketCents: number;
  } | null>(null);
  const [low, setLow] = useState(0);

  useEffect(() => {
    void Promise.all([
      api<typeof summary extends infer T ? NonNullable<T> : never>("/reports/summary"),
      api<{ isLow: boolean }[]>("/inventory/levels?low=1"),
    ]).then(([s, levels]) => {
      setSummary(s);
      setLow(levels.length);
    });
  }, []);

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Dashboard</h2>
          <p>Last 7 days · PurePOS Demo Café</p>
        </div>
      </div>
      <div className="cards">
        <div className="stat">
          <div className="label">Gross sales</div>
          <div className="value">{money(summary?.grossSalesCents ?? 0)}</div>
        </div>
        <div className="stat">
          <div className="label">Receipts</div>
          <div className="value">{summary?.receiptCount ?? 0}</div>
        </div>
        <div className="stat">
          <div className="label">Tax collected</div>
          <div className="value">{money(summary?.taxCents ?? 0)}</div>
        </div>
        <div className="stat">
          <div className="label">Tips</div>
          <div className="value">{money(summary?.tipCents ?? 0)}</div>
        </div>
        <div className="stat">
          <div className="label">Avg ticket</div>
          <div className="value">{money(summary?.avgTicketCents ?? 0)}</div>
        </div>
        <div className="stat">
          <div className="label">Low stock SKUs</div>
          <div className="value">{low}</div>
        </div>
      </div>
      <div className="panel-box">
        <h3>Quick links</h3>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          Use the sidebar for items, inventory receiving, customer loyalty, employee PINs, sales void/refund,
          and PurePOS reports. Open the POS till on port 5173 for register sales.
        </p>
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
    const [its, cats] = await Promise.all([
      api<typeof items>("/catalog/items"),
      api<typeof categories>("/catalog/categories"),
    ]);
    setItems(its);
    setCategories(cats);
  }

  useEffect(() => {
    void load();
  }, []);

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
          <button type="button" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Close" : "Add item"}
          </button>
        </div>
      </div>

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

      {editMods && (
        <ModifierEditor itemId={editMods.id} itemName={editMods.name} onClose={() => { setEditMods(null); void load(); }} />
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Group</th>
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
                <td colSpan={8} style={{ color: "var(--muted)" }}>
                  No items in this group — add an item or choose another group.
                </td>
              </tr>
            )}
            {filtered.map((item) => {
              const v = item.variants[0];
              return (
                <tr key={item.id}>
                  <td>
                    <strong>{item.name}</strong>
                    {item.isComposite && <span className="badge" style={{ marginLeft: 8 }}>Kit</span>}
                  </td>
                  <td>
                    <span className="badge">{groupName(item.categoryId)}</span>
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
                  <td>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setEditMods({ id: item.id, name: item.name })}
                    >
                      Edit modifiers
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

function StoresPage() {
  const [settings, setSettings] = useState<{
    store: { id: string; name: string; address: string | null; currency: string };
    registers: { id: string; name: string }[];
  } | null>(null);
  const [stores, setStores] = useState<{ id: string; name: string; address: string | null; registers: { name: string }[] }[]>([]);
  const [regName, setRegName] = useState("");

  async function load() {
    const [sett, all] = await Promise.all([
      api<NonNullable<typeof settings>>("/settings"),
      api<typeof stores>("/auth/stores"),
    ]);
    setSettings(sett);
    setStores(all);
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
          <p>Multi-store stub · registers for the active store</p>
        </div>
      </div>
      <div className="table-wrap" style={{ marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Store</th>
              <th>Address</th>
              <th>Registers</th>
            </tr>
          </thead>
          <tbody>
            {stores.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.name}
                  {settings?.store.id === s.id && <span className="badge" style={{ marginLeft: 8 }}>Current</span>}
                </td>
                <td>{s.address}</td>
                <td>{s.registers.map((r) => r.name).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

function SettingsPage() {
  const [settings, setSettings] = useState<{
    store: { name: string; address: string | null; currency: string; timezone: string };
    receipt: { header: string; footer: string; showTaxBreakdown: boolean };
    taxes: { id: string; name: string; rateBps: number; enabled: boolean }[];
    paymentTypes: { id: string; name: string; type: string; enabled: boolean; opensDrawer: boolean }[];
  } | null>(null);
  const [billing, setBilling] = useState<{
    planId: string;
    status: string;
    trialEndsAt: string | null;
    plan: { name: string; monthlyGbp: number; highlights: string[]; features: string[] };
  } | null>(null);
  const [receipt, setReceipt] = useState({ header: "", footer: "" });
  const [taxForm, setTaxForm] = useState({ name: "Local tax", rate: "8.25" });
  const [ptForm, setPtForm] = useState({ name: "", type: "other" });
  const [pilotMsg, setPilotMsg] = useState("");

  async function load() {
    const [s, b] = await Promise.all([
      api<NonNullable<typeof settings>>("/settings"),
      api<NonNullable<typeof billing>>("/billing"),
    ]);
    setSettings(s);
    setBilling(b);
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

      <div className="panel-box">
        <h3>Store / currency</h3>
        <p>
          <strong>{settings.store.name}</strong> · {settings.store.currency} · {settings.store.timezone}
        </p>
        <p style={{ color: "var(--muted)" }}>{settings.store.address}</p>
      </div>

      {billing && (
        <div className="panel-box">
          <h3>Billing</h3>
          <p>
            <strong>{billing.plan.name}</strong> · £{billing.plan.monthlyGbp}/mo · {billing.status}
            {billing.trialEndsAt ? ` · trial until ${new Date(billing.trialEndsAt).toLocaleDateString("en-GB")}` : ""}
          </p>
          <ul style={{ color: "var(--muted)", marginTop: 8 }}>
            {billing.plan.highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          <div className="toolbar" style={{ marginTop: 12 }}>
            {(["starter", "pro", "multi"] as const).map((planId) => (
              <button
                key={planId}
                type="button"
                className={billing.planId === planId ? undefined : "secondary"}
                onClick={() =>
                  void api("/billing/plan", { method: "PATCH", body: JSON.stringify({ planId }) }).then(() => load())
                }
              >
                {planId === "starter" ? "Solo" : planId === "pro" ? "Shop" : "Group"}
              </button>
            ))}
            <a className="ghost-link" href="/pricing" target="_blank" rel="noreferrer">
              Pricing / trial signup
            </a>
          </div>
          <form
            style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const licenseKey = String(fd.get("licenseKey") || "");
              void api("/billing/activate-license", {
                method: "POST",
                body: JSON.stringify({ licenseKey }),
              }).then(() => load());
            }}
          >
            <input name="licenseKey" placeholder="PP-PRO-XXXX-XXXX-XXXX" style={{ minWidth: 240 }} />
            <button type="submit" className="secondary">
              Activate license key
            </button>
          </form>
          <p style={{ marginTop: 10, fontSize: "0.88rem", color: "var(--muted)" }}>
            Feature gates: CSV import + online ordering need Shop+ · multi-store transfers need Group.
            Stripe Checkout needs <code>STRIPE_SECRET_KEY</code> + price IDs when you go live.
          </p>
        </div>
      )}

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
