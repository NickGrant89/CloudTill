import { useEffect, useMemo, useState } from "react";
import { api, getToken, money, setToken } from "./api";
import {
  DEFAULT_TEXT_PAY_MESSAGE,
  getPlan,
  renderTextPayMessage,
  sortItemGroups,
  sortTillMenuItems,
  upgradeBillingHint,
} from "@cloudtill/shared";
import { BoEditSheet } from "./BoEditSheet";
import { applyReorder, DragGrip, GiftCardsPage, ModifierEditor, ModifierLibrary, TimeClockPage } from "./MorePages";
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

export function Pages({
  page,
  onNavigate,
  planFeatures = [],
}: {
  page: PageId;
  onNavigate?: (page: PageId) => void;
  planFeatures?: string[];
}) {
  const multiStore = planFeatures.includes("multi_store");
  switch (page) {
    case "dashboard":
      return <Dashboard onNavigate={onNavigate} planFeatures={planFeatures} />;
    case "catalog":
      return <CatalogPage multiStore={multiStore} />;
    case "modifiers":
      return <ModifiersPage />;
    case "inventory":
      return <InventoryPage multiStore={multiStore} />;
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
    entitled?: boolean;
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

function Dashboard({
  onNavigate,
  planFeatures,
}: {
  onNavigate?: (page: PageId) => void;
  planFeatures: string[];
}) {
  const [data, setData] = useState<DashData | null>(null);
  const [err, setErr] = useState("");
  const kitchenNav = planFeatures.includes("kitchen");

  async function load() {
    try {
      setData(await api<DashData>("/reports/dashboard"));
      setErr("");
    } catch (e) {
      setErr(upgradeBillingHint(e instanceof Error ? e.message : "Could not load dashboard"));
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
                {!kitchenNav
                  ? "Complete or Multi unlocks online orders and delivery-app tickets here."
                  : k?.total
                    ? `${k.pending} waiting · ${k.preparing} preparing · ${k.ready} ready`
                    : "Queue clear"}
              </p>
            </div>
            {kitchenNav && (
              <button type="button" className="secondary" onClick={() => go("kitchen")}>
                Open kitchen
              </button>
            )}
          </div>
          {kitchenNav && data?.kitchen.orders.length ? (
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
          ) : kitchenNav ? (
            <p style={{ color: "var(--muted)", margin: "8px 0 0" }}>
              No open kitchen orders. Web and delivery-app orders appear here.
            </p>
          ) : (
            <p style={{ color: "var(--muted)", margin: "8px 0 0" }}>
              Upgrade in <strong>Settings → Billing</strong> for kitchen and delivery tracking.
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

function CatalogPage({ multiStore }: { multiStore: boolean }) {
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
  const [categories, setCategories] = useState<{ id: string; name: string; color?: string; sortOrder?: number }[]>([]);
  const [q, setQ] = useState("");
  const [groupFilter, setGroupFilter] = useState<string | "all" | "none">("all");
  const [showForm, setShowForm] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupMsg, setGroupMsg] = useState("");
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameGroupValue, setRenameGroupValue] = useState("");
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
  const [deleteMoveToId, setDeleteMoveToId] = useState("");
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
  const [itemMsg, setItemMsg] = useState("");
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
    setCategories(sortItemGroups(cats));
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
      setAssignMsg(upgradeBillingHint(err instanceof Error ? err.message : "Could not assign items"));
    } finally {
      setAssignBusy(false);
    }
  }

  const groupName = (categoryId: string | null) =>
    categoryId ? categories.find((c) => c.id === categoryId)?.name ?? "Group" : "Ungrouped";

  const filtered = useMemo(() => {
    const list = items.filter((i) => {
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
    return groupFilter === "all" ? sortTillMenuItems(list, categories) : list;
  }, [items, groupFilter, q, categories]);

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

  async function removeItem(item: (typeof items)[number]) {
    if (
      !window.confirm(
        `Delete ${item.name}? If it has sales history it will be hidden from the till instead of removed permanently.`
      )
    ) {
      return;
    }
    setItemMsg("");
    try {
      const result = await api<{ deactivated?: boolean; deleted?: boolean; message?: string }>(`/catalog/items/${item.id}`, {
        method: "DELETE",
      });
      setEditItem((cur) => (cur?.id === item.id ? null : cur));
      setEditMods((cur) => (cur?.id === item.id ? null : cur));
      setSelectedIds((prev) => prev.filter((id) => id !== item.id));
      setItemMsg(result.message || (result.deactivated ? `${item.name} hidden from till.` : `${item.name} deleted.`));
      await load();
    } catch (err) {
      setItemMsg(err instanceof Error ? err.message : "Could not delete item");
    }
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

  function itemCountInGroup(categoryId: string) {
    return items.filter((i) => i.categoryId === categoryId).length;
  }

  async function renameGroup(categoryId: string, name: string) {
    const cleaned = name.trim();
    if (!cleaned) return;
    setGroupBusy(true);
    setGroupMsg("");
    try {
      await api(`/catalog/categories/${categoryId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: cleaned }),
      });
      setRenamingGroupId(null);
      setRenameGroupValue("");
      setGroupMsg(`Renamed to “${cleaned}”.`);
      await load();
    } catch (err) {
      setGroupMsg(err instanceof Error ? err.message : "Could not rename group");
    } finally {
      setGroupBusy(false);
    }
  }

  async function saveGroupOrder(ordered: { id: string }[]) {
    setGroupBusy(true);
    setGroupMsg("");
    try {
      await api("/catalog/categories/order", {
        method: "POST",
        body: JSON.stringify({ categoryIds: ordered.map((c) => c.id) }),
      });
      setGroupMsg("Group order saved — till chips follow this order.");
      await load();
    } catch (err) {
      setGroupMsg(err instanceof Error ? err.message : "Could not reorder groups");
    } finally {
      setGroupBusy(false);
    }
  }

  async function reorderGroups(from: number, to: number) {
    const next = applyReorder(categories, from, to);
    if (!next) return;
    setCategories(next);
    await saveGroupOrder(next);
  }

  async function deleteGroup(categoryId: string) {
    const count = itemCountInGroup(categoryId);
    const cat = categories.find((c) => c.id === categoryId);
    const label = cat?.name ?? "Group";
    if (count > 0 && !deleteMoveToId && deleteMoveToId !== "__ungrouped__") {
      setGroupMsg(`Pick where to move ${count} item${count === 1 ? "" : "s"} before deleting “${label}”.`);
      return;
    }
  if (
      count > 0 &&
      !window.confirm(
        `Delete “${label}”? ${count} item${count === 1 ? "" : "s"} will move to ${
          deleteMoveToId === "__ungrouped__"
            ? "Ungrouped"
            : categories.find((c) => c.id === deleteMoveToId)?.name ?? "another group"
        }.`
      )
    ) {
      return;
    }
    if (count === 0 && !window.confirm(`Delete empty group “${label}”?`)) return;

    setGroupBusy(true);
    setGroupMsg("");
    try {
      await api(`/catalog/categories/${categoryId}`, {
        method: "DELETE",
        body: JSON.stringify({
          moveToCategoryId: count > 0 ? (deleteMoveToId === "__ungrouped__" ? null : deleteMoveToId) : undefined,
        }),
      });
      setDeleteGroupId(null);
      setDeleteMoveToId("");
      setGroupMsg(`Deleted “${label}”.`);
      await load();
    } catch (err) {
      setGroupMsg(err instanceof Error ? err.message : "Could not delete group");
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
      {itemMsg && <p className="panel-box" style={{ marginBottom: 12 }}>{itemMsg}</p>}

      {showGroups && (
        <form className="panel-box" onSubmit={(e) => void createGroup(e)}>
          <h3>Item groups</h3>
          <p style={{ color: "var(--muted)", marginTop: 0 }}>
            Groups organise the menu (Drinks, Food, Retail…). Drag to reorder — the till uses the same chip order.
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
            <ul
              data-drag-group="item-groups"
              className="item-group-list"
              style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}
            >
              {categories.map((c, groupIndex) => {
                const count = itemCountInGroup(c.id);
                const deleting = deleteGroupId === c.id;
                return (
                  <li
                    key={c.id}
                    data-drag-index={groupIndex}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      padding: "10px 12px",
                      border: "1px solid var(--line)",
                      borderRadius: 10,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {categories.length > 1 && renamingGroupId !== c.id && !deleting && (
                        <DragGrip
                          index={groupIndex}
                          listLength={categories.length}
                          group="item-groups"
                          label={c.name}
                          onDrop={(from, to) => void reorderGroups(from, to)}
                        />
                      )}
                      {renamingGroupId === c.id ? (
                        <>
                          <input
                            value={renameGroupValue}
                            onChange={(e) => setRenameGroupValue(e.target.value)}
                            aria-label="Group name"
                            style={{ flex: 1, minWidth: 140 }}
                          />
                          <button type="button" className="secondary" disabled={groupBusy} onClick={() => void renameGroup(c.id, renameGroupValue)}>
                            Save
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => {
                              setRenamingGroupId(null);
                              setRenameGroupValue("");
                            }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <strong style={{ color: "var(--ink)", flex: 1 }}>{c.name}</strong>
                          <span style={{ color: "var(--muted)", fontSize: "0.88rem" }}>
                            {count} item{count === 1 ? "" : "s"}
                          </span>
                          <button
                            type="button"
                            className="linkish"
                            onClick={() => {
                              setRenamingGroupId(c.id);
                              setRenameGroupValue(c.name);
                            }}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            className="linkish"
                            onClick={() => {
                              setDeleteGroupId(deleting ? null : c.id);
                              setDeleteMoveToId("");
                            }}
                          >
                            {deleting ? "Cancel" : "Delete"}
                          </button>
                        </>
                      )}
                    </div>
                    {deleting && count > 0 && (
                      <div className="field" style={{ margin: 0 }}>
                        <label>Move items to</label>
                        <select value={deleteMoveToId} onChange={(e) => setDeleteMoveToId(e.target.value)}>
                          <option value="">Choose…</option>
                          <option value="__ungrouped__">Ungrouped</option>
                          {categories
                            .filter((other) => other.id !== c.id)
                            .map((other) => (
                              <option key={other.id} value={other.id}>
                                {other.name}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}
                    {deleting && (
                      <button type="button" className="secondary" disabled={groupBusy} onClick={() => void deleteGroup(c.id)}>
                        {count > 0 ? "Move items and delete group" : "Delete empty group"}
                      </button>
                    )}
                  </li>
                );
              })}
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

      <div className="items-group-filters" style={{ marginBottom: 12 }}>
        <div className="items-group-filter-mobile">
          <div className="items-group-filter-quick" role="group" aria-label="Quick filters">
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
          </div>
          <label className="items-group-filter-select-field">
            <span className="items-group-filter-label">Filter group</span>
            <select
              aria-label="Filter by group"
              value={groupFilter === "all" || groupFilter === "none" ? "" : groupFilter}
              onChange={(e) => {
                const next = e.target.value;
                setGroupFilter(next ? next : "all");
              }}
            >
              <option value="">All groups (overview)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="chip-row items-group-filters-chips" role="tablist" aria-label="Filter by group">
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
      </div>

      <BoEditSheet
        open={Boolean(editMods)}
        onClose={() => {
          setEditMods(null);
          void load();
        }}
        title={editMods ? `Modifiers · ${editMods.name}` : ""}
        wide
      >
        {editMods && (
          <ModifierEditor
            embedded
            itemId={editMods.id}
            itemName={editMods.name}
            onClose={() => {
              setEditMods(null);
              void load();
            }}
          />
        )}
      </BoEditSheet>

      <form className="panel-box" onSubmit={(e) => void assignToBranches(e)}>
        <h3>Send items to branches</h3>
        {!multiStore ? (
          <p style={{ color: "var(--muted)", marginTop: 0 }}>
            Assigning items to branches is part of the <strong>Multi</strong> plan. Upgrade in{" "}
            <strong>Settings → Billing</strong>.
          </p>
        ) : (
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          Tick items below, pick branches, then send. Copies the item (and its group) onto those stores by SKU —
          skips if already there. Opening stock on the new branch starts at 0.
        </p>
        )}
        {multiStore && otherStores.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>
            Only one store in this account. Add another branch under <strong>Stores &amp; registers</strong> first.
          </p>
        ) : multiStore ? (
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
        ) : null}
        {assignMsg && <p style={{ color: "var(--muted)" }}>{assignMsg}</p>}
      </form>

      <div className="table-wrap stack-cards">
        <table className="items-table stack-on-phone">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all filtered items"
                  disabled={!multiStore}
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
              <tr className="stack-empty">
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
                  <td data-label="Select" className="stack-select">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => toggleSelected(item.id)}
                      aria-label={`Select ${item.name}`}
                    />
                  </td>
                  <td data-label="Item" className="stack-title">
                    <strong>{item.name}</strong>
                    {item.isComposite && <span className="badge" style={{ marginLeft: 8 }}>Kit</span>}
                  </td>
                  <td data-label="Group">
                    <span className="badge">{groupName(item.categoryId)}</span>
                  </td>
                  <td data-label="Also on" style={{ color: "var(--muted)", fontSize: "0.88rem" }}>
                    {elsewhere.length
                      ? elsewhere.map((s) => s.name).join(", ")
                      : "This store only"}
                  </td>
                  <td data-label="SKU">{v?.sku}</td>
                  <td data-label="Barcode">{v?.barcode ?? "—"}</td>
                  <td data-label="Price">{money(v?.priceCents ?? 0)}</td>
                  <td data-label="Stock">
                    {v?.trackStock ? v.stockQty : <span className="badge">Not tracked</span>}
                  </td>
                  <td data-label="Modifiers">
                    {item.modifierGroups.length
                      ? item.modifierGroups.map((g) => g.name).join(", ")
                      : "—"}
                  </td>
                  <td data-label="" className="stack-actions" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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
                    <button type="button" className="danger" onClick={() => void removeItem(item)}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <BoEditSheet
        open={Boolean(editItem)}
        onClose={() => setEditItem(null)}
        title={editItem ? `Edit · ${editItem.name}` : ""}
      >
        {editItem && (
          <form onSubmit={(e) => void saveEdit(e)}>
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
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
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
              <button type="button" className="danger" onClick={() => void removeItem(editItem)}>
                Delete item
              </button>
            </div>
          </form>
        )}
      </BoEditSheet>
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
          <p>Pick a menu on the left to edit options and items. Search to find one quickly.</p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <ModifierLibrary items={items} onChange={() => void load()} />
    </div>
  );
}

function InventoryPage({ multiStore }: { multiStore: boolean }) {
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

  const [xferMsg, setXferMsg] = useState("");

  async function load() {
    const [lv, hist, xfers, allStores] = await Promise.all([
      api<typeof levels>(`/inventory/levels${lowOnly ? "?low=1" : ""}`),
      api<typeof history>("/inventory/history"),
      multiStore
        ? api<typeof transfers>("/inventory/transfers")
        : Promise.resolve([] as typeof transfers),
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
  }, [lowOnly, multiStore]);

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
    setXferMsg("");
    try {
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
    } catch (err) {
      setXferMsg(upgradeBillingHint(err instanceof Error ? err.message : "Transfer failed"));
    }
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
        {!multiStore ? (
          <p style={{ color: "var(--muted)", marginTop: 0 }}>
            Stock transfers between branches need the <strong>Multi</strong> plan —{" "}
            <strong>Settings → Billing</strong>.
          </p>
        ) : (
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
        )}
        {multiStore && (
          <>
            <button type="submit">Transfer</button>
            {xferMsg && <p className="error">{xferMsg}</p>}
          </>
        )}
      </form>

      {multiStore && (
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
      )}

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
  type Cust = {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    note?: string | null;
    loyaltyPoints: number;
    storeCreditCents: number;
    totalSpentCents: number;
    visitCount: number;
  };
  const [customers, setCustomers] = useState<Cust[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    name: string;
    sales: { receiptNumber: string; totalCents: number; createdAt: string; status: string }[];
  } | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", storeCreditCents: "0" });
  const [editing, setEditing] = useState<Cust | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    phone: "",
    note: "",
    loyaltyPoints: "0",
    storeCreditCents: "0",
  });
  const [msg, setMsg] = useState("");

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
    setMsg("");
    try {
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
      setMsg("Customer added.");
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not add customer");
    }
  }

  function openEdit(c: Cust) {
    setEditing(c);
    setSelected(c.id);
    setEditForm({
      name: c.name,
      email: c.email ?? "",
      phone: c.phone ?? "",
      note: c.note ?? "",
      loyaltyPoints: String(c.loyaltyPoints),
      storeCreditCents: (c.storeCreditCents / 100).toFixed(2),
    });
    setMsg("");
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setMsg("");
    try {
      await api(`/customers/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editForm.name.trim(),
          email: editForm.email.trim() || null,
          phone: editForm.phone.trim() || null,
          note: editForm.note.trim() || null,
          loyaltyPoints: Math.round(parseFloat(editForm.loyaltyPoints || "0")),
          storeCreditCents: Math.round(parseFloat(editForm.storeCreditCents || "0") * 100),
        }),
      });
      setEditing(null);
      setMsg("Customer updated.");
      await load();
      void api<typeof detail>(`/customers/${editing.id}`).then(setDetail);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not update customer");
    }
  }

  async function removeCustomer(c: Cust) {
    if (!window.confirm(`Delete ${c.name}? Only works if they have no sales history.`)) return;
    setMsg("");
    try {
      await api(`/customers/${c.id}`, { method: "DELETE" });
      if (selected === c.id) {
        setSelected(null);
        setDetail(null);
      }
      setEditing((cur) => (cur?.id === c.id ? null : cur));
      setMsg(`${c.name} deleted.`);
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not delete customer");
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Customers</h2>
          <p>Add, edit, or remove · loyalty and store credit</p>
        </div>
      </div>
      {msg && <p className="panel-box" style={{ marginBottom: 12 }}>{msg}</p>}
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
        <button type="submit">Add</button>
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
                <th />
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => setSelected(c.id)}>
                  <td>{c.name}</td>
                  <td>{c.loyaltyPoints}</td>
                  <td>{money(c.storeCreditCents)}</td>
                  <td>{money(c.totalSpentCents)}</td>
                  <td style={{ whiteSpace: "nowrap" }} onClick={(ev) => ev.stopPropagation()}>
                    <button type="button" className="secondary" onClick={() => openEdit(c)}>
                      Edit
                    </button>{" "}
                    <button type="button" className="secondary" onClick={() => void removeCustomer(c)}>
                      Delete
                    </button>
                  </td>
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

      <BoEditSheet
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `Edit · ${editing.name}` : ""}
      >
        {editing && (
          <form onSubmit={(e) => void saveEdit(e)}>
            <div className="grid-2">
              <div className="field">
                <label>Name</label>
                <input required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div className="field">
                <label>Email</label>
                <input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
              </div>
              <div className="field">
                <label>Phone</label>
                <input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
              </div>
              <div className="field">
                <label>Store credit (£)</label>
                <input value={editForm.storeCreditCents} onChange={(e) => setEditForm({ ...editForm, storeCreditCents: e.target.value })} />
              </div>
              <div className="field">
                <label>Loyalty points</label>
                <input value={editForm.loyaltyPoints} onChange={(e) => setEditForm({ ...editForm, loyaltyPoints: e.target.value })} />
              </div>
              <div className="field">
                <label>Note</label>
                <input value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="submit">Save changes</button>
              <button type="button" className="secondary" onClick={() => void removeCustomer(editing)}>
                Delete
              </button>
            </div>
          </form>
        )}
      </BoEditSheet>
    </div>
  );
}

function EmployeesPage() {
  type Emp = { id: string; name: string; email: string; role: string; active: boolean; hasPin?: boolean };
  const [employees, setEmployees] = useState<Emp[]>([]);
  const [form, setForm] = useState({ name: "", email: "", pin: "", role: "cashier" });
  const [editing, setEditing] = useState<Emp | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", pin: "", role: "cashier", active: true });
  const [msg, setMsg] = useState("");

  async function load() {
    setEmployees(await api("/employees"));
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      await api("/employees", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm({ name: "", email: "", pin: "", role: "cashier" });
      setMsg("Employee added. PIN is stored hashed and is not shown again.");
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not add employee");
    }
  }

  function openEdit(emp: Emp) {
    setEditing(emp);
    setEditForm({
      name: emp.name,
      email: emp.email,
      pin: "",
      role: emp.role,
      active: emp.active,
    });
    setMsg("");
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setMsg("");
    try {
      await api(`/employees/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editForm.name.trim(),
          email: editForm.email.trim(),
          role: editForm.role,
          active: editForm.active,
          ...(editForm.pin.trim() ? { pin: editForm.pin.trim() } : {}),
        }),
      });
      setEditing(null);
      setMsg("Employee updated.");
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not update employee");
    }
  }

  async function setActive(emp: Emp, active: boolean) {
    setMsg("");
    try {
      await api(`/employees/${emp.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active }),
      });
      setMsg(active ? `${emp.name} reactivated.` : `${emp.name} deactivated.`);
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not update status");
    }
  }

  async function removeEmp(emp: Emp) {
    if (!window.confirm(`Remove ${emp.name}? If they have sales history they will be deactivated instead.`)) return;
    setMsg("");
    try {
      const result = await api<{ deactivated?: boolean; deleted?: boolean; message?: string }>(`/employees/${emp.id}`, {
        method: "DELETE",
      });
      setEditing((cur) => (cur?.id === emp.id ? null : cur));
      setMsg(result.message || (result.deactivated ? `${emp.name} deactivated.` : `${emp.name} deleted.`));
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not remove employee");
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Employees</h2>
          <p>Back office uses email + PIN. The till needs a unique PIN per person.</p>
        </div>
      </div>
      {msg && <p className="panel-box" style={{ marginBottom: 12 }}>{msg}</p>}
      <form className="panel-box" onSubmit={(e) => void create(e)}>
        <h3>Add employee</h3>
        <div className="grid-2">
          <div className="field">
            <label>Name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Email</label>
            <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field">
            <label>PIN (unique on the till)</label>
            <input
              required
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              minLength={4}
              maxLength={8}
              value={form.pin}
              onChange={(e) => setForm({ ...form, pin: e.target.value })}
            />
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
        <button type="submit">Add</button>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>PIN</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id}>
                <td>{e.name}</td>
                <td>{e.email}</td>
                <td>{e.role}</td>
                <td>
                  <span className="badge">{e.hasPin === false ? "Not set" : "Hidden"}</span>
                </td>
                <td>{e.active ? <span className="badge">Active</span> : <span className="badge danger">Inactive</span>}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button type="button" className="secondary" onClick={() => openEdit(e)}>
                    Edit
                  </button>{" "}
                  {e.active ? (
                    <button type="button" className="secondary" onClick={() => void setActive(e, false)}>
                      Deactivate
                    </button>
                  ) : (
                    <button type="button" className="secondary" onClick={() => void setActive(e, true)}>
                      Reactivate
                    </button>
                  )}{" "}
                  <button type="button" className="secondary" onClick={() => void removeEmp(e)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <BoEditSheet
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `Edit · ${editing.name}` : ""}
      >
        {editing && (
          <form onSubmit={(e) => void saveEdit(e)}>
            <div className="grid-2">
              <div className="field">
                <label>Name</label>
                <input required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div className="field">
                <label>Email</label>
                <input required type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
              </div>
              <div className="field">
                <label>New PIN (leave blank to keep)</label>
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  minLength={4}
                  maxLength={8}
                  value={editForm.pin}
                  onChange={(e) => setEditForm({ ...editForm, pin: e.target.value })}
                  placeholder="••••"
                />
              </div>
              <div className="field">
                <label>Role</label>
                <select value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}>
                  <option value="cashier">Cashier</option>
                  <option value="manager">Manager</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
              <div className="field">
                <label>
                  <input
                    type="checkbox"
                    checked={editForm.active}
                    onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })}
                  />{" "}
                  Active (can sign in)
                </label>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="submit">Save changes</button>
              <button type="button" className="secondary" onClick={() => void removeEmp(editing)}>
                Delete
              </button>
            </div>
          </form>
        )}
      </BoEditSheet>
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

type TillDeviceRow = {
  id: string;
  label: string;
  registerId: string | null;
  registerName: string | null;
  lastEmployeeName: string | null;
  lastUserAgent: string | null;
  lastSeenAt: string;
  supportNote: string | null;
  online: boolean;
};

type RegisterRow = {
  id: string;
  name: string;
  createdAt?: string;
  lastSeenAt?: string | null;
  lastEmployeeName?: string | null;
  lastDeviceLabel?: string | null;
  online?: boolean;
};

type OpenTicketRow = {
  id: string;
  name: string;
  status: string;
  registerName: string;
  customerName: string | null;
  lineCount: number;
  lines: { name: string; quantity: number }[];
  updatedAt: string;
};

function formatSeenAt(iso: string | null | undefined) {
  if (!iso) return "Never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London" });
}

function StoresPage() {
  const [settings, setSettings] = useState<{
    store: { id: string; name: string; address: string | null; currency: string };
    registers: { id: string; name: string }[];
  } | null>(null);
  const [stores, setStores] = useState<{ id: string; name: string; address: string | null; registers: { name: string }[] }[]>([]);
  const [registers, setRegisters] = useState<RegisterRow[]>([]);
  const [devices, setDevices] = useState<TillDeviceRow[]>([]);
  const [openTickets, setOpenTickets] = useState<OpenTicketRow[]>([]);
  const [regName, setRegName] = useState("");
  const [editingRegister, setEditingRegister] = useState<RegisterRow | null>(null);
  const [registerFormName, setRegisterFormName] = useState("");
  const [editingDevice, setEditingDevice] = useState<TillDeviceRow | null>(null);
  const [deviceForm, setDeviceForm] = useState({ label: "", supportNote: "" });
  const [tillMsg, setTillMsg] = useState("");
  const [branch, setBranch] = useState({ name: "", address: "", phone: "" });
  const [branchMsg, setBranchMsg] = useState("");
  const [role, setRole] = useState("");
  const [hasBranches, setHasBranches] = useState(false);
  const tillUrl = `${window.location.origin}/pos/`;
  const kitchenUrl = `${window.location.origin}/pos/kitchen`;

  async function load() {
    const [sett, all, me, billing, regs, devs, board] = await Promise.all([
      api<NonNullable<typeof settings>>("/settings"),
      api<typeof stores>("/auth/stores"),
      api<{ user: { role: string } }>("/auth/me"),
      api<{ features: string[] }>("/billing").catch(() => ({ features: [] as string[] })),
      api<RegisterRow[]>("/employees/registers"),
      api<TillDeviceRow[]>("/employees/devices").catch(() => [] as TillDeviceRow[]),
      api<OpenTicketRow[]>("/extras/tickets-board").catch(() => [] as OpenTicketRow[]),
    ]);
    setSettings(sett);
    setStores(all);
    setRole(me.user.role);
    setHasBranches(billing.features.includes("multi_store"));
    setRegisters(Array.isArray(regs) ? regs : []);
    setDevices(Array.isArray(devs) ? devs : []);
    setOpenTickets(Array.isArray(board) ? board : []);
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
    setTillMsg("");
    try {
      await api("/employees/registers", { method: "POST", body: JSON.stringify({ name: regName.trim() }) });
      setRegName("");
      setTillMsg("Till added. Open /pos/ on a device, sign in — it auto-registers here. Use this iPad as… to pin it.");
      await load();
    } catch (err) {
      setTillMsg(err instanceof Error ? err.message : "Could not add till");
    }
  }

  async function saveRegisterName(e: React.FormEvent) {
    e.preventDefault();
    if (!editingRegister) return;
    const name = registerFormName.trim();
    if (!name) return;
    setTillMsg("");
    try {
      await api(`/employees/registers/${editingRegister.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      setEditingRegister(null);
      setRegisterFormName("");
      setTillMsg("Till name saved.");
      await load();
    } catch (err) {
      setTillMsg(err instanceof Error ? err.message : "Could not rename till");
    }
  }

  async function saveDevice(e: React.FormEvent) {
    e.preventDefault();
    if (!editingDevice) return;
    setTillMsg("");
    try {
      await api(`/employees/devices/${editingDevice.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          label: deviceForm.label.trim() || undefined,
          supportNote: deviceForm.supportNote.trim() || null,
        }),
      });
      setEditingDevice(null);
      setTillMsg("Device details saved.");
      await load();
    } catch (err) {
      setTillMsg(err instanceof Error ? err.message : "Could not update device");
    }
  }

  function copySupportPack() {
    const storeName = settings?.store.name ?? "Store";
    const online = devices.filter((d) => d.online).length;
    const lines = [
      `PurePOS till support — ${storeName}`,
      `Till URL: ${tillUrl}`,
      `Kitchen URL: ${kitchenUrl}`,
      `Registers: ${registers.map((r) => r.name).join(", ") || "(none)"}`,
      `Devices seen: ${devices.length} (${online} online now)`,
      ...devices.slice(0, 12).map(
        (d) =>
          `• ${d.label}${d.online ? " [online]" : ""} — ${d.registerName ?? "unpinned"} — ${d.lastEmployeeName ?? "—"} — ${formatSeenAt(d.lastSeenAt)}${d.supportNote ? ` — note: ${d.supportNote}` : ""}`
      ),
    ];
    void navigator.clipboard?.writeText(lines.join("\n")).then(() => setTillMsg("Status pack copied — paste into a ticket or chat"));
  }

  useEffect(() => {
    if (!(role === "owner" || role === "manager")) return;
    const refreshLive = () => {
      void api<TillDeviceRow[]>("/employees/devices")
        .then((devs) => setDevices(Array.isArray(devs) ? devs : []))
        .catch(() => undefined);
      void api<RegisterRow[]>("/employees/registers")
        .then((regs) => setRegisters(Array.isArray(regs) ? regs : []))
        .catch(() => undefined);
      void api<OpenTicketRow[]>("/extras/tickets-board")
        .then((board) => setOpenTickets(Array.isArray(board) ? board : []))
        .catch(() => undefined);
    };
    const timer = window.setInterval(refreshLive, 15_000);
    return () => window.clearInterval(timer);
  }, [role]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Stores & tills</h2>
          <p>Live open tickets, devices, and till registers</p>
        </div>
      </div>

      <div className="panel-box" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ margin: 0, flex: "1 1 auto" }}>Open tickets</h3>
          <button type="button" className="secondary" onClick={() => void load()}>
            Refresh
          </button>
        </div>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          Live sales across tills — same board the till app uses. Updates about every 15 seconds.
        </p>
        {openTickets.length === 0 ? (
          <p style={{ color: "var(--muted)", marginBottom: 12 }}>No open or held tickets right now.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
            {openTickets.map((ticket) => {
              const preview = ticket.lines
                .slice(0, 3)
                .map((line) => `${line.quantity}× ${line.name}`)
                .join(", ");
              const extra = ticket.lineCount > 3 ? ` +${ticket.lineCount - 3} more` : "";
              return (
                <li
                  key={ticket.id}
                  style={{
                    marginBottom: 10,
                    paddingBottom: 10,
                    borderBottom: "1px solid var(--line)",
                  }}
                >
                  <strong>
                    {ticket.name || "Sale"}
                    {ticket.status === "held" ? " · held" : ""}
                  </strong>
                  <div style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: 2 }}>
                    {ticket.registerName}
                    {ticket.customerName ? ` · ${ticket.customerName}` : ""}
                    {" · "}
                    {ticket.lineCount} line{ticket.lineCount === 1 ? "" : "s"}
                    {" · "}
                    {formatSeenAt(ticket.updatedAt)}
                  </div>
                  {(preview || extra) && (
                    <div style={{ fontSize: "0.9rem", marginTop: 4 }}>
                      {preview}
                      {extra}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <a className="secondary" href={tillUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none", padding: "8px 12px", borderRadius: 10 }}>
            Open till
          </a>
          <a className="secondary" href={kitchenUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none", padding: "8px 12px", borderRadius: 10 }}>
            Kitchen
          </a>
          <button
            type="button"
            className="secondary"
            onClick={() => void navigator.clipboard?.writeText(tillUrl).then(() => setTillMsg("Till link copied"))}
          >
            Copy till link
          </button>
          <button type="button" className="secondary" onClick={copySupportPack}>
            Copy status pack
          </button>
        </div>
        {tillMsg && <p style={{ marginBottom: 0 }}>{tillMsg}</p>}
      </div>

      {(role === "owner" || role === "manager") && (
        <div className="panel-box" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Devices signed in</h3>
          <p style={{ color: "var(--muted)", marginTop: 0 }}>
            Every phone or iPad that opens the till. Online = heartbeat in the last 3 minutes. This list is separate
            from <strong>Tills</strong> below (named slots like Front Counter).
          </p>
          {devices.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>
              No devices yet — open the till app on a phone or iPad and sign in with a PIN. It will show up here.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {devices.map((dev) => (
                <li
                  key={dev.id}
                  style={{
                    marginBottom: 12,
                    paddingBottom: 12,
                    borderBottom: "1px solid var(--line)",
                  }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-start" }}>
                      <span
                        title={dev.online ? "Online" : "Offline"}
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          marginTop: 6,
                          background: dev.online ? "#2F6F4E" : "#9aa3ad",
                          flex: "0 0 auto",
                        }}
                      />
                      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                        <strong>{dev.label}</strong>
                        <div style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: 2 }}>
                          {dev.registerName ? `Till: ${dev.registerName}` : "Not pinned to a till yet"}
                          {" · "}
                          {dev.lastEmployeeName ? `Last: ${dev.lastEmployeeName}` : "No staff yet"}
                          {" · "}
                          {formatSeenAt(dev.lastSeenAt)}
                          {dev.online ? " · Online" : ""}
                        </div>
                        {dev.supportNote && (
                          <div style={{ fontSize: "0.9rem", marginTop: 4 }}>{dev.supportNote}</div>
                        )}
                      </div>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setEditingDevice(dev);
                          setDeviceForm({ label: dev.label, supportNote: dev.supportNote ?? "" });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          if (!window.confirm(`Remove ${dev.label} from this list? It will reappear if they open the till again.`)) return;
                          void api(`/employees/devices/${dev.id}`, { method: "DELETE" })
                            .then(() => {
                              setTillMsg(`${dev.label} removed.`);
                              return load();
                            })
                            .catch((err) => setTillMsg(err instanceof Error ? err.message : "Could not remove device"));
                        }}
                      >
                        Remove
                      </button>
                    </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="panel-box" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Tills on {settings?.store.name ?? "this store"}</h3>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          Tills are named slots (Front Counter, Patio…). Phones and iPads appear under the till they are pinned to —
          add another till below if the phone should be its own station.
        </p>
        {registers.length === 0 && (
          <p style={{ color: "var(--muted)" }}>
            No tills yet — the first till login creates Front Counter, or add one below.
          </p>
        )}
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
          {registers.map((reg) => {
            const onTill = devices.filter((dev) => dev.registerId === reg.id);
            return (
            <li
              key={reg.id}
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "flex-start",
                marginBottom: 10,
                paddingBottom: 10,
                borderBottom: "1px solid var(--line)",
              }}
            >
              <>
                  <span
                    title={reg.online ? "Online" : "Offline"}
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      marginTop: 6,
                      background: reg.online ? "#2F6F4E" : "#9aa3ad",
                      flex: "0 0 auto",
                    }}
                  />
                  <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                    <strong>{reg.name}</strong>
                    <div style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: 2 }}>
                      {reg.lastSeenAt
                        ? `${formatSeenAt(reg.lastSeenAt)}${reg.lastEmployeeName ? ` · ${reg.lastEmployeeName}` : ""}`
                        : "No device signed in yet"}
                    </div>
                    {onTill.length > 0 ? (
                      <div style={{ fontSize: "0.9rem", marginTop: 6 }}>
                        {onTill.map((dev) => (
                          <span key={dev.id} style={{ display: "inline-block", marginRight: 12, marginBottom: 4 }}>
                            <span
                              title={dev.online ? "Online" : "Offline"}
                              style={{
                                display: "inline-block",
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                marginRight: 6,
                                background: dev.online ? "#2F6F4E" : "#9aa3ad",
                              }}
                            />
                            {dev.label}
                            {!dev.online ? ` · ${formatSeenAt(dev.lastSeenAt)}` : " · online"}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: 4 }}>
                        No phones or iPads pinned here yet
                      </div>
                    )}
                  </div>
                  {(role === "owner" || role === "manager") && (
                    <>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setEditingRegister(reg);
                          setRegisterFormName(reg.name);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          if (!window.confirm(`Delete till ${reg.name}? Only works if it has no sales history.`)) return;
                          void api(`/employees/registers/${reg.id}`, { method: "DELETE" })
                            .then(() => {
                              setTillMsg(`${reg.name} deleted.`);
                              return load();
                            })
                            .catch((err) => setTillMsg(err instanceof Error ? err.message : "Could not delete till"));
                        }}
                      >
                        Delete
                      </button>
                    </>
                  )}
              </>
            </li>
            );
          })}
        </ul>
        {(role === "owner" || role === "manager") && (
          <form onSubmit={(e) => void addRegister(e)}>
            <div className="field">
              <label htmlFor="new-till-name">Add a till / kiosk</label>
              <input
                id="new-till-name"
                required
                placeholder="e.g. Patio Kiosk or Drive-thru"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
              />
            </div>
            <button type="submit">Add till</button>
          </form>
        )}
      </div>

      <div className="table-wrap" style={{ marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Store</th>
              <th>Address</th>
              <th>Tills</th>
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
                    {s.registers.length ? s.registers.map((r) => r.name).join(", ") : "No till yet"}
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
              Branches are part of the <strong>Multi</strong> plan. Upgrade in Settings → Billing to add more sites.
            </p>
          )}
          {branchMsg && <p style={{ marginBottom: 0 }}>{branchMsg}</p>}
        </form>
      )}

      <BoEditSheet
        open={Boolean(editingRegister)}
        onClose={() => setEditingRegister(null)}
        title={editingRegister ? `Edit till · ${editingRegister.name}` : ""}
      >
        {editingRegister && (
          <form onSubmit={(e) => void saveRegisterName(e)}>
            <div className="field">
              <label htmlFor="till-edit-name">Till name</label>
              <input
                id="till-edit-name"
                required
                value={registerFormName}
                onChange={(e) => setRegisterFormName(e.target.value)}
              />
            </div>
            <button type="submit">Save till</button>
          </form>
        )}
      </BoEditSheet>

      <BoEditSheet
        open={Boolean(editingDevice)}
        onClose={() => setEditingDevice(null)}
        title={editingDevice ? `Edit device · ${editingDevice.label}` : ""}
      >
        {editingDevice && (
          <form onSubmit={(e) => void saveDevice(e)}>
            <div className="field">
              <label htmlFor="dev-edit-label">Device name</label>
              <input
                id="dev-edit-label"
                value={deviceForm.label}
                onChange={(e) => setDeviceForm({ ...deviceForm, label: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="dev-edit-note">Support note</label>
              <input
                id="dev-edit-note"
                placeholder="e.g. Patio iPad — Guided Access on"
                value={deviceForm.supportNote}
                onChange={(e) => setDeviceForm({ ...deviceForm, supportNote: e.target.value })}
              />
            </div>
            <button type="submit">Save device</button>
          </form>
        )}
      </BoEditSheet>
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
  const [advancedBlocked, setAdvancedBlocked] = useState("");

  async function loadAdvanced<T>(path: string): Promise<T | null> {
    try {
      return await api<T>(path);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Blocked";
      if (/Richer reports|Complete or Multi|402/i.test(msg)) {
        setAdvancedBlocked(upgradeBillingHint(msg));
      }
      return null;
    }
  }

  useEffect(() => {
    void (async () => {
      setAdvancedBlocked("");
      const s = await api<Record<string, number | string>>("/reports/summary").catch(() => null);
      if (s) setSummary(s);
      const [i, c, e, p, t] = await Promise.all([
        loadAdvanced<typeof byItem>("/reports/by-item"),
        loadAdvanced<typeof byCat>("/reports/by-category"),
        loadAdvanced<typeof byEmp>("/reports/by-employee"),
        loadAdvanced<typeof payments>("/reports/payments"),
        loadAdvanced<NonNullable<typeof taxes>>("/reports/taxes"),
      ]);
      if (i) setByItem(i);
      if (c) setByCat(c);
      if (e) setByEmp(e);
      if (p) setPayments(p);
      if (t) setTaxes(t);
    })();
  }, []);

  return (
    <div className="reports-page">
      <div className="page-head">
        <div>
          <h2>Reports</h2>
          <p>Sales, by item / category / employee, payments, taxes</p>
        </div>
      </div>
      {advancedBlocked && <p className="error">{advancedBlocked}</p>}
      <div className="cards reports-cards">
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

      <div className="reports-grid">
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
    <div className="panel-box reports-panel">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="reports-empty">Nothing yet.</p>
      ) : (
        <div className="table-wrap reports-table-wrap">
          <table className="reports-table">
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
                    <td key={j} title={c}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
    receipt: { header: string; footer: string; showTaxBreakdown: boolean; printCustomer: boolean };
    taxes: { id: string; name: string; rateBps: number; enabled: boolean; inclusive: boolean }[];
    paymentTypes: { id: string; name: string; type: string; enabled: boolean; opensDrawer: boolean }[];
    currencySymbol: string;
    textPay: { message: string };
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
  const [receipt, setReceipt] = useState({ header: "", footer: "", printCustomer: true });
  const [editingTax, setEditingTax] = useState<
    { id: string; name: string; rateBps: number; enabled: boolean; inclusive: boolean } | "new" | null
  >(null);
  const [taxEditForm, setTaxEditForm] = useState({
    name: "VAT",
    rate: "20",
    inclusive: false,
    enabled: true,
  });
  const [editingPay, setEditingPay] = useState<
    { id: string; name: string; type: string; enabled: boolean; opensDrawer: boolean } | "new" | null
  >(null);
  const [payEditForm, setPayEditForm] = useState({
    name: "",
    type: "other",
    enabled: true,
    opensDrawer: false,
  });
  const [settingsMsg, setSettingsMsg] = useState("");
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
  const [textPayMessage, setTextPayMessage] = useState(DEFAULT_TEXT_PAY_MESSAGE);
  const [textPayMessageMsg, setTextPayMessageMsg] = useState("");

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
    setReceipt({
      header: s.receipt.header,
      footer: s.receipt.footer,
      printCustomer: s.receipt.printCustomer !== false,
    });
    setTextPayMessage(s.textPay?.message?.trim() || DEFAULT_TEXT_PAY_MESSAGE);
  }

  useEffect(() => {
    void load();
  }, []);

  function openTaxEdit(t: NonNullable<typeof settings>["taxes"][number]) {
    setEditingTax(t);
    setTaxEditForm({
      name: t.name,
      rate: (t.rateBps / 100).toFixed(2),
      inclusive: t.inclusive,
      enabled: t.enabled,
    });
  }

  function openTaxAdd() {
    setEditingTax("new");
    setTaxEditForm({ name: "VAT", rate: "20", inclusive: false, enabled: true });
  }

  async function saveTaxEdit(e: React.FormEvent) {
    e.preventDefault();
    setSettingsMsg("");
    const rateBps = Math.round(parseFloat(taxEditForm.rate) * 100);
    if (!taxEditForm.name.trim() || !Number.isFinite(rateBps)) {
      setSettingsMsg("Tax name and rate are required.");
      return;
    }
    try {
      const payload = {
        name: taxEditForm.name.trim(),
        rateBps,
        inclusive: taxEditForm.inclusive,
        enabled: taxEditForm.enabled,
      };
      if (editingTax === "new") {
        await api("/settings/taxes", { method: "POST", body: JSON.stringify(payload) });
      } else if (editingTax) {
        await api(`/settings/taxes/${editingTax.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      }
      setEditingTax(null);
      await load();
    } catch (err) {
      setSettingsMsg(err instanceof Error ? err.message : "Could not save tax");
    }
  }

  async function deleteTax() {
    if (!editingTax || editingTax === "new") return;
    if (!window.confirm(`Delete tax ${editingTax.name}?`)) return;
    setSettingsMsg("");
    try {
      await api(`/settings/taxes/${editingTax.id}`, { method: "DELETE" });
      setEditingTax(null);
      await load();
    } catch (err) {
      setSettingsMsg(err instanceof Error ? err.message : "Could not delete tax");
    }
  }

  function openPayEdit(p: NonNullable<typeof settings>["paymentTypes"][number]) {
    setEditingPay(p);
    setPayEditForm({
      name: p.name,
      type: p.type,
      enabled: p.enabled,
      opensDrawer: p.opensDrawer,
    });
  }

  function openPayAdd() {
    setEditingPay("new");
    setPayEditForm({ name: "", type: "other", enabled: true, opensDrawer: false });
  }

  async function savePayEdit(e: React.FormEvent) {
    e.preventDefault();
    setSettingsMsg("");
    if (!payEditForm.name.trim()) {
      setSettingsMsg("Payment method name is required.");
      return;
    }
    try {
      if (editingPay === "new") {
        const type = payEditForm.type === "store_credit" || payEditForm.type === "gift_card" ? payEditForm.type : "other";
        await api("/settings/payment-types", {
          method: "POST",
          body: JSON.stringify({
            name: payEditForm.name.trim(),
            type,
            enabled: payEditForm.enabled,
            opensDrawer: payEditForm.opensDrawer,
          }),
        });
      } else if (editingPay) {
        await api(`/settings/payment-types/${editingPay.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: payEditForm.name.trim(),
            enabled: payEditForm.enabled,
            opensDrawer: payEditForm.opensDrawer,
          }),
        });
      }
      setEditingPay(null);
      await load();
    } catch (err) {
      setSettingsMsg(err instanceof Error ? err.message : "Could not save payment method");
    }
  }

  async function setPayEnabled(p: NonNullable<typeof settings>["paymentTypes"][number], enabled: boolean) {
    setSettingsMsg("");
    try {
      await api(`/settings/payment-types/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      await load();
    } catch (err) {
      setSettingsMsg(err instanceof Error ? err.message : "Could not update payment method");
    }
  }

  async function deletePay() {
    if (!editingPay || editingPay === "new") return;
    if (editingPay.type === "cash" || editingPay.type === "card") return;
    if (!window.confirm(`Delete ${editingPay.name}? Past sales keep the name they were paid with.`)) return;
    setSettingsMsg("");
    try {
      await api(`/settings/payment-types/${editingPay.id}`, { method: "DELETE" });
      setEditingPay(null);
      await load();
    } catch (err) {
      setSettingsMsg(err instanceof Error ? err.message : "Could not delete payment method");
    }
  }

  if (!settings) return <p>Loading…</p>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Settings</h2>
          <p>Taxes, payment methods, receipt, currency, billing</p>
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
                      {getPlan(planId).name}
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
            Essential: the till, items, live sync and backups. Complete adds online ordering, kitchen screens, delivery
            apps (Just Eat, Deliveroo, Uber Eats), spreadsheet import and fuller reports. Multi adds extra
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
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const message = textPayMessage.trim();
            if (!message) {
              setTextPayMessageMsg("Write the text the customer is sent.");
              return;
            }
            setTextPayMessageMsg("");
            void api("/settings/text-pay", { method: "PATCH", body: JSON.stringify({ message }) })
              .then(() => {
                setTextPayMessage(message);
                setTextPayMessageMsg("Saved");
                return load();
              })
              .catch((err) =>
                setTextPayMessageMsg(err instanceof Error ? err.message : "Could not save the text")
              );
          }}
        >
          <div className="field">
            <label htmlFor="text-pay-message">Text the customer is sent</label>
            <textarea
              id="text-pay-message"
              rows={3}
              maxLength={320}
              autoComplete="off"
              value={textPayMessage}
              onChange={(e) => {
                setTextPayMessage(e.target.value);
                setTextPayMessageMsg("");
              }}
            />
          </div>
          <p style={{ color: "var(--muted)", fontSize: "0.88rem", marginTop: 0 }}>
            Saved for this business and used when a pay link is texted. {"{store}"}, {"{amount}"}, {"{name}"} and{" "}
            {"{link}"} are filled in for each customer. The pay link is included even if {"{link}"} is left out. Card
            payments and texting stay set up for the shop — nothing to paste here.
          </p>
          <p style={{ fontSize: "0.88rem", whiteSpace: "pre-wrap" }}>
            <strong>Example. </strong>
            {renderTextPayMessage(textPayMessage, {
              store: settings.store.name,
              amount: `${settings.currencySymbol || "£"}10.00`,
              link: `${textPayStatus?.publicPayBase ?? "https://purepos.co.uk/pay"}/example`,
              name: "Alex",
            })}
          </p>
          <div className="toolbar">
            <button type="submit">Save text</button>
            <button type="button" className="secondary" onClick={() => setTextPayMessage(DEFAULT_TEXT_PAY_MESSAGE)}>
              Use standard text
            </button>
            {textPayMessageMsg && <span style={{ color: "var(--muted)" }}>{textPayMessageMsg}</span>}
          </div>
        </form>
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
        <label style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={receipt.printCustomer}
            onChange={(e) => setReceipt({ ...receipt, printCustomer: e.target.checked })}
          />
          Show and print customer receipt after payment
        </label>
        <p style={{ color: "var(--muted)", marginTop: 0, fontSize: "0.9rem" }}>
          Turn off to skip the customer receipt on the till. Kitchen tickets still print. You can reprint a sale from
          Receipts anytime.
        </p>
        <button type="submit">Save receipt</button>
      </form>

      {settingsMsg && (
        <p className="panel-box" style={{ marginBottom: 12, color: "var(--muted)" }}>
          {settingsMsg}
        </p>
      )}

      <div className="grid-2">
        <div className="panel-box">
          <div className="page-head" style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Taxes</h3>
            <button type="button" onClick={openTaxAdd}>
              Add tax
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Rate</th>
                <th>Enabled</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {settings.taxes.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.name}
                    {t.inclusive && <span className="badge" style={{ marginLeft: 6 }}>Inclusive</span>}
                  </td>
                  <td>{(t.rateBps / 100).toFixed(2)}%</td>
                  <td>{t.enabled ? "Yes" : "No"}</td>
                  <td>
                    <button type="button" className="secondary" onClick={() => openTaxEdit(t)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel-box">
          <div className="page-head" style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Payment methods</h3>
            <button type="button" onClick={openPayAdd}>
              Add payment method
            </button>
          </div>
          <p style={{ color: "var(--muted)", marginTop: 0, fontSize: "0.9rem" }}>
            These show on the till Charge screen. Add your own, rename them, or turn one off. Cash and Card stay in the
            list so existing sales keep working.
          </p>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>On till</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {settings.paymentTypes.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name}
                    {(p.type === "cash" || p.type === "card") && (
                      <span className="badge" style={{ marginLeft: 6 }}>Built-in</span>
                    )}
                  </td>
                  <td>
                    <label className="check-row" style={{ margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={p.enabled}
                        aria-label={`${p.enabled ? "Turn off" : "Turn on"} ${p.name}`}
                        onChange={(e) => void setPayEnabled(p, e.target.checked)}
                      />
                      <span>{p.enabled ? "On" : "Off"}</span>
                    </label>
                  </td>
                  <td>
                    <button type="button" className="secondary" onClick={() => openPayEdit(p)}>
                      Rename
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <BoEditSheet
        open={editingTax !== null}
        onClose={() => setEditingTax(null)}
        title={editingTax === "new" ? "Add tax" : editingTax ? `Edit · ${editingTax.name}` : ""}
      >
        {editingTax !== null && (
          <form onSubmit={(e) => void saveTaxEdit(e)}>
            <div className="field">
              <label>Name</label>
              <input
                required
                value={taxEditForm.name}
                onChange={(e) => setTaxEditForm({ ...taxEditForm, name: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Rate %</label>
              <input
                required
                value={taxEditForm.rate}
                onChange={(e) => setTaxEditForm({ ...taxEditForm, rate: e.target.value })}
              />
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={taxEditForm.inclusive}
                onChange={(e) => setTaxEditForm({ ...taxEditForm, inclusive: e.target.checked })}
              />
              Prices include this tax (inclusive)
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
              <input
                type="checkbox"
                checked={taxEditForm.enabled}
                onChange={(e) => setTaxEditForm({ ...taxEditForm, enabled: e.target.checked })}
              />
              Enabled on till
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="submit">{editingTax === "new" ? "Add tax" : "Save tax"}</button>
              {editingTax !== "new" && (
                <button type="button" className="danger" onClick={() => void deleteTax()}>
                  Delete
                </button>
              )}
            </div>
          </form>
        )}
      </BoEditSheet>

      <BoEditSheet
        open={editingPay !== null}
        onClose={() => setEditingPay(null)}
        title={editingPay === "new" ? "Add payment method" : editingPay ? `Rename · ${editingPay.name}` : ""}
      >
        {editingPay !== null && (
          <form onSubmit={(e) => void savePayEdit(e)}>
            <div className="field">
              <label htmlFor="pay-method-name">Name</label>
              <input
                id="pay-method-name"
                required
                maxLength={40}
                value={payEditForm.name}
                onChange={(e) => setPayEditForm({ ...payEditForm, name: e.target.value })}
              />
            </div>
            {editingPay === "new" ? (
              <div className="field">
                <label htmlFor="pay-method-behaviour">Behaviour</label>
                <select
                  id="pay-method-behaviour"
                  value={payEditForm.type === "gift_card" || payEditForm.type === "store_credit" ? payEditForm.type : "other"}
                  onChange={(e) => setPayEditForm({ ...payEditForm, type: e.target.value })}
                >
                  <option value="other">Normal payment</option>
                  <option value="store_credit">Store credit</option>
                  <option value="gift_card">Gift card</option>
                </select>
              </div>
            ) : (
              <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                {payEditForm.type === "cash" || payEditForm.type === "card"
                  ? "Built-in tender. Rename it or turn it off. It is not deleted, so older sales stay intact."
                  : payEditForm.type === "gift_card"
                    ? "The till asks for a gift card code when this is used."
                    : payEditForm.type === "store_credit"
                      ? "Uses the customer’s store credit."
                      : "Shows on the till Charge screen while it is on."}
              </p>
            )}
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={payEditForm.opensDrawer}
                onChange={(e) => setPayEditForm({ ...payEditForm, opensDrawer: e.target.checked })}
              />
              Opens cash drawer when used
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
              <input
                type="checkbox"
                checked={payEditForm.enabled}
                onChange={(e) => setPayEditForm({ ...payEditForm, enabled: e.target.checked })}
              />
              On the till
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="submit">{editingPay === "new" ? "Add payment method" : "Save"}</button>
              {editingPay !== "new" && editingPay.type !== "cash" && editingPay.type !== "card" && (
                <button type="button" className="danger" onClick={() => void deletePay()}>
                  Delete
                </button>
              )}
            </div>
          </form>
        )}
      </BoEditSheet>
    </div>
  );
}
