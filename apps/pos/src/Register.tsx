import { groupModifierLines } from "@cloudtill/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getToken, loadCatalogSnapshot, money, OfflineError, saveCatalogSnapshot } from "./api";
import type { SessionRegister, SessionStore, SessionUser } from "./App";
import { nanoid } from "./offline/id";
import type { OfflineStatus } from "./offline/sync";
import {
  exportPendingSalesBackup,
  installUnsyncedLeaveGuard,
  requestPersistentStorage,
} from "./offline/durable";
import { refreshOfflineBadge, startOfflineSync, subscribeOfflineStatus, syncQueuedSales } from "./offline/sync";
import {
  ensureLocalTicket,
  persistLocalTicket,
  queueCompletedLocalSale,
  withTotals,
} from "./offline/ticket";
import { readLocalTicket, type LocalTicket } from "./offline/db";
import { readPinnedTill, registerTone, registerToneIndex, writePinnedTill } from "./pinnedTill";

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
  modifiers: { name: string; priceCents: number; modifierId?: string; groupName?: string }[];
}

/** Keep sale-line modifiers in the same order as modifier groups on the item (BO drag order). */
function sortModsByItemGroups<T extends { groupName?: string }>(mods: T[], groups: { name: string }[]): T[] {
  if (!groups.length || mods.length < 2) return mods;
  const rank = new Map(groups.map((group, index) => [group.name.toLowerCase(), index]));
  return [...mods].sort((a, b) => {
    const ra = rank.get((a.groupName || "").toLowerCase()) ?? 10_000;
    const rb = rank.get((b.groupName || "").toLowerCase()) ?? 10_000;
    if (ra !== rb) return ra - rb;
    return 0;
  });
}

function ModifierList({
  mods,
  groups,
}: {
  mods: { name: string; groupName?: string }[];
  groups?: { name: string }[];
}) {
  const ordered = groups?.length ? sortModsByItemGroups(mods, groups) : mods;
  const blocks = groupModifierLines(ordered);
  if (!blocks.length) return null;
  return (
    <ul className="mod-list">
      {blocks.map((block, index) => (
        <li key={`${block.groupName ?? "mods"}-${index}`}>
          {block.groupName && <div className="mod-group">{block.groupName}</div>}
          {block.names.map((name, nameIndex) => (
            <div key={`${name}-${nameIndex}`} className="mod-name">
              {name}
            </div>
          ))}
        </li>
      ))}
    </ul>
  );
}

interface Ticket {
  id: string;
  name: string;
  status: string;
  registerId?: string | null;
  registerName?: string | null;
  customerId: string | null;
  customer?: {
    id: string;
    name: string;
    loyaltyPoints: number;
    storeCreditCents: number;
    phone?: string | null;
  } | null;
  lines: TicketLine[];
  discountCents: number;
  discountPercent: number;
  tipCents: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  note?: string | null;
  updatedAt?: string;
  createdAt?: string;
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
  onLogout: () => void;
}

type RecentSale = {
  id: string;
  receiptNumber: string;
  employeeName: string;
  customerName: string | null;
  totalCents: number;
  status: string;
  createdAt: string;
  lines: { name: string; quantity: number; totalCents: number; modifiersJson?: string }[];
};

type Modal =
  | null
  | { type: "pay" }
  | { type: "phoneOrder" }
  | { type: "more" }
  | { type: "held" }
  | { type: "customers" }
  | { type: "discount" }
  | { type: "tip" }
  | { type: "receipt"; text: string; changeCents: number; saleId: string; kitchenText?: string }
  | { type: "recentSales" }
  | { type: "shift" }
  | { type: "board" }
  | { type: "kitchen" }
  | { type: "kitchenSend" }
  | { type: "message"; title: string; body: string };

interface BoardTicket {
  id: string;
  name: string;
  status: string;
  source: string;
  kitchenStatus: string | null;
  registerName?: string | null;
  lineCount: number;
  lines: { name: string; quantity: number }[];
  customerName: string | null;
  note: string | null;
  updatedAt?: string;
}

interface KitchenOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  status: string;
  channel?: string;
  fulfillment?: string;
  totalCents: number;
  lines: { name: string; quantity: number }[];
}

export function Register({ user, store, registers, registerId, onLogout }: Props) {
  const [pinnedId, setPinnedId] = useState(() => readPinnedTill(store.id)?.registerId ?? "");
  const [fullScreen, setFullScreen] = useState(false);
  useEffect(() => {
    const sync = () => setFullScreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
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
  const [customerQuery, setCustomerQuery] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [customerFormMsg, setCustomerFormMsg] = useState("");
  const [callerMatches, setCallerMatches] = useState<Customer[]>([]);
  const [held, setHeld] = useState<Ticket[]>([]);
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [recentSaleQuery, setRecentSaleQuery] = useState("");
  const [selectedRecentSale, setSelectedRecentSale] = useState<RecentSale | null>(null);
  const [recentSaleMsg, setRecentSaleMsg] = useState("");
  const [openTickets, setOpenTickets] = useState<Ticket[]>([]);
  const [liveSyncLabel, setLiveSyncLabel] = useState("");
  const [payAmounts, setPayAmounts] = useState<Record<string, number>>({});
  const [giftCardCode, setGiftCardCode] = useState("GC-DEMO50");
  const [textPayPhone, setTextPayPhone] = useState("");
  const [textPayName, setTextPayName] = useState("");
  const [textPayMsg, setTextPayMsg] = useState("");
  const [textPayLink, setTextPayLink] = useState<{
    id: string;
    payUrl: string;
    status: string;
    hostedPayUrl?: string;
  } | null>(null);
  const [selectedMods, setSelectedMods] = useState<Record<string, Modifier[]>>({});
  const [busy, setBusy] = useState(false);
  const [clockedIn, setClockedIn] = useState(false);
  const [favorites, setFavorites] = useState<Item[]>([]);
  const [showFavorites, setShowFavorites] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [menuReady, setMenuReady] = useState(false);
  const [payText, setPayText] = useState<Record<string, string>>({});
  const ticketRef = useRef<Ticket | null>(null);
  const creatingRef = useRef<Promise<Ticket> | null>(null);
  const queueRef = useRef(Promise.resolve());
  const [board, setBoard] = useState<BoardTicket[]>([]);
  const [kitchenOrders, setKitchenOrders] = useState<KitchenOrder[]>([]);
  const [sentToKitchen, setSentToKitchen] = useState<Record<string, Record<string, number>>>({});
  const [kitchenForm, setKitchenForm] = useState({ name: "", fulfillment: "dine_in" as "dine_in" | "pickup", note: "" });
  const [tipSuggestions, setTipSuggestions] = useState<
    { label: string; tipCents: number; percent: number | null }[]
  >([]);
  const [mobilePane, setMobilePane] = useState<"items" | "ticket">("items");
  const [modifierItem, setModifierItem] = useState<Item | null>(null);
  const [editingLineKey, setEditingLineKey] = useState<string | null>(null);
  const [modifierGroupId, setModifierGroupId] = useState("");
  const [offline, setOffline] = useState<OfflineStatus>({
    online: true,
    pendingSales: 0,
    syncing: false,
    lastSyncAt: null,
    lastError: null,
  });
  const offlineRef = useRef<OfflineStatus>(offline);
  offlineRef.current = offline;
  const [taxRateBps, setTaxRateBps] = useState(825);

  function setCurrentTicket(next: Ticket | null) {
    ticketRef.current = next;
    setTicket(next);
  }

  function isLocalTicket(t: Ticket | null | undefined): boolean {
    return Boolean(t?.id.startsWith("local-"));
  }

  function localToTicket(local: LocalTicket): Ticket {
    const totaled = withTotals(local, taxRateBps);
    return {
      id: totaled.id,
      name: totaled.name,
      status: totaled.status,
      customerId: totaled.customerId,
      customer: totaled.customer ?? null,
      lines: totaled.lines,
      discountCents: totaled.discountCents,
      discountPercent: totaled.discountPercent,
      tipCents: totaled.tipCents,
      subtotalCents: totaled.subtotalCents,
      taxCents: totaled.taxCents,
      totalCents: totaled.totalCents,
    };
  }

  function fail(title: string, error: unknown) {
    setModal({
      type: "message",
      title,
      body: error instanceof Error ? error.message : "Something went wrong",
    });
  }

  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = queueRef.current.then(job, job);
    queueRef.current = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  const loadCatalog = useCallback(async () => {
    const [cats, its, pts, sett, curShift, clock, favs] = await Promise.allSettled([
      api<Category[]>("/catalog/categories"),
      api<Item[]>("/catalog/items"),
      api<PaymentType[]>("/pos/payment-types"),
      api<{
        receipt: { header: string; footer: string };
        tipPresetsPercent: number[];
        taxes?: { rateBps: number; enabled: boolean; inclusive: boolean }[];
      }>("/settings"),
      api<{ id: string; openingFloatCents: number } | null>(`/shifts/current?registerId=${registerId}`),
      api<{ clockedIn: boolean }>("/time-clock/status"),
      api<Item[]>("/extras/favorites"),
    ]);
    if (cats.status === "fulfilled") setCategories(cats.value);
    if (its.status === "fulfilled") setItems(its.value);
    if (pts.status === "fulfilled") setPaymentTypes(pts.value);
    if (sett.status === "fulfilled") {
      setSettings(sett.value);
      const tax = sett.value.taxes?.find((t) => t.enabled) ?? sett.value.taxes?.[0];
      if (tax) setTaxRateBps(tax.rateBps);
    }
    if (curShift.status === "fulfilled") setShift(curShift.value);
    if (clock.status === "fulfilled") setClockedIn(clock.value.clockedIn);
    if (favs.status === "fulfilled") setFavorites(favs.value);

    const catalogOk = cats.status === "fulfilled" && its.status === "fulfilled" && pts.status === "fulfilled";
    if (catalogOk) {
      // Server wins catalog when online — refresh IndexedDB snapshot for offline use.
      await saveCatalogSnapshot({
        categories: cats.status === "fulfilled" ? cats.value : [],
        items: its.status === "fulfilled" ? its.value : [],
        paymentTypes: pts.status === "fulfilled" ? pts.value : [],
        settings: sett.status === "fulfilled" ? sett.value : null,
        favorites: favs.status === "fulfilled" ? favs.value : [],
      });
      setCatalogError("");
    } else {
      const cached = await loadCatalogSnapshot();
      if (cached) {
        setCategories(cached.categories as Category[]);
        setItems(cached.items as Item[]);
        setPaymentTypes(cached.paymentTypes as PaymentType[]);
        if (cached.settings) setSettings(cached.settings as typeof settings);
        if (cached.favorites) setFavorites(cached.favorites as Item[]);
        setCatalogError("Offline · using cached items (server wins when back online)");
      } else {
        const broken = [cats, its, pts].find((result) => result.status === "rejected");
        setCatalogError(
          broken?.status === "rejected"
            ? broken.reason instanceof Error
              ? broken.reason.message
              : "Could not load the register"
            : ""
        );
      }
    }
    setMenuReady(true);
  }, [registerId]);

  const ensureTicket = useCallback(async () => {
    if (ticketRef.current) return ticketRef.current;
    if (creatingRef.current) return creatingRef.current;
    const pending = (async () => {
      try {
        const created = await api<Ticket>("/pos/tickets", {
          method: "POST",
          body: JSON.stringify({ registerId, name: "Sale" }),
        });
        ticketRef.current = created;
        setTicket(created);
        return created;
      } catch (error) {
        if (!(error instanceof OfflineError)) throw error;
        const local = await ensureLocalTicket(registerId);
        const created = localToTicket(local);
        ticketRef.current = created;
        setTicket(created);
        return created;
      }
    })().finally(() => {
      creatingRef.current = null;
    });
    creatingRef.current = pending;
    return pending;
  }, [registerId, taxRateBps]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    const stop = startOfflineSync();
    const unsub = subscribeOfflineStatus(setOffline);
    void requestPersistentStorage();
    const stopGuard = installUnsyncedLeaveGuard(() => offlineRef.current?.pendingSales ?? 0);
    return () => {
      stop();
      unsub();
      stopGuard();
    };
  }, []);

  const refreshOpenTickets = useCallback(async () => {
    if (!offlineRef.current.online) return;
    try {
      const list = await api<Ticket[]>("/pos/tickets?status=open");
      setOpenTickets(Array.isArray(list) ? list : []);
      const current = ticketRef.current;
      if (!current || isLocalTicket(current)) return;
      const remote = list.find((t) => t.id === current.id);
      if (remote) {
        const localUpdated = current.updatedAt || "";
        const remoteUpdated = remote.updatedAt || "";
        if (remoteUpdated && remoteUpdated > localUpdated) {
          setCurrentTicket(remote);
          setLiveSyncLabel("Updated from another till");
        }
        return;
      }
      try {
        const fresh = await api<Ticket>(`/pos/tickets/${current.id}`);
        if (fresh.status === "open" || fresh.status === "held") {
          if ((fresh.updatedAt || "") > (current.updatedAt || "")) {
            setCurrentTicket(fresh);
            setLiveSyncLabel("Updated from another till");
          }
        } else {
          setCurrentTicket(null);
          setLiveSyncLabel("Ticket closed on another till");
        }
      } catch {
        /* keep local view if fetch fails */
      }
    } catch {
      setOpenTickets([]);
    }
  }, []);

  useEffect(() => {
    if (!offline.online) return;
    void refreshOpenTickets();
    const id = window.setInterval(() => void refreshOpenTickets(), 2500);
    return () => window.clearInterval(id);
  }, [offline.online, registerId, refreshOpenTickets]);

  useEffect(() => {
    if (!liveSyncLabel) return;
    const id = window.setTimeout(() => setLiveSyncLabel(""), 2200);
    return () => window.clearTimeout(id);
  }, [liveSyncLabel]);

  useEffect(() => {
    setCurrentTicket(null);
    creatingRef.current = null;
    setOpenTickets([]);
    void (async () => {
      try {
        const local = await readLocalTicket(registerId);
        if (local?.lines.length) setCurrentTicket(localToTicket(local));
      } catch {
        /* ignore */
      }
    })();
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

  function openModifierMenu(item: Item) {
    const initial: Record<string, Modifier[]> = {};
    for (const group of item.modifierGroups) {
      initial[group.id] = group.minSelect > 0 && group.modifiers[0] ? [group.modifiers[0]] : [];
    }
    setEditingLineKey(null);
    setSelectedMods(initial);
    setModifierGroupId(item.modifierGroups[0]?.id ?? "");
    setModifierItem(item);
    setMobilePane("items");
  }

  function chooseModifier(group: ModGroup, modifier: Modifier) {
    setSelectedMods((prev) => {
      const current = prev[group.id] ?? [];
      if (group.maxSelect <= 1) return { ...prev, [group.id]: [modifier] };
      if (current.some((option) => option.id === modifier.id)) {
        return { ...prev, [group.id]: current.filter((option) => option.id !== modifier.id) };
      }
      if (current.length >= group.maxSelect) return prev;
      return { ...prev, [group.id]: [...current, modifier] };
    });
    if (group.maxSelect <= 1 && modifierItem) {
      const index = modifierItem.modifierGroups.findIndex((entry) => entry.id === group.id);
      const next = modifierItem.modifierGroups[index + 1];
      if (next) setModifierGroupId(next.id);
    }
  }

  async function addItem(item: Item) {
    if (item.modifierGroups.length > 0) {
      openModifierMenu(item);
      return;
    }
    await addVariant(item, []);
  }

  async function addVariant(
    item: Item,
    modifiers: { modifierId?: string; name: string; priceCents: number; groupName?: string }[]
  ) {
    const variant = item.variants[0];
    if (!variant) {
      fail("Item", new Error(`${item.name} has no price`));
      return false;
    }
    try {
      await enqueue(async () => {
        const t = await ensureTicket();
        if (isLocalTicket(t) || !offline.online) {
          const local = await ensureLocalTicket(registerId);
          const existing = local.lines.find(
            (line) =>
              line.variantId === variant.id &&
              JSON.stringify(line.modifiers) === JSON.stringify(modifiers)
          );
          if (existing) existing.quantity += 1;
          else {
            local.lines.push({
              key: `L-${nanoid(8)}`,
              variantId: variant.id,
              name: item.name,
              quantity: 1,
              unitPriceCents: variant.priceCents,
              discountCents: 0,
              modifiers,
            });
          }
          const saved = await persistLocalTicket(local);
          setCurrentTicket(localToTicket(saved));
          setModal(null);
          return;
        }
        const updated = await api<Ticket>(`/pos/tickets/${t.id}/lines`, {
          method: "POST",
          body: JSON.stringify({ variantId: variant.id, quantity: 1, modifiers }),
        });
        setCurrentTicket(updated);
        setModal(null);
      });
      return true;
    } catch (error) {
      if (error instanceof OfflineError) {
        try {
          const local = await ensureLocalTicket(registerId);
          local.lines.push({
            key: `L-${nanoid(8)}`,
            variantId: variant.id,
            name: item.name,
            quantity: 1,
            unitPriceCents: variant.priceCents,
            discountCents: 0,
            modifiers,
          });
          const saved = await persistLocalTicket(local);
          setCurrentTicket(localToTicket(saved));
          setModal(null);
          return true;
        } catch (inner) {
          fail("Could not add item", inner);
          return false;
        }
      }
      fail("Could not add item", error);
      return false;
    }
  }

  function openLineEditor(line: TicketLine) {
    const item = items.find((entry) => entry.variants.some((variant) => variant.id === line.variantId));
    if (!item || item.modifierGroups.length === 0) {
      fail(line.name, new Error("This item has no options to edit"));
      return;
    }
    const initial: Record<string, Modifier[]> = {};
    for (const group of item.modifierGroups) {
      initial[group.id] = group.modifiers.filter((option) =>
        line.modifiers.some(
          (picked) =>
            (picked.modifierId && picked.modifierId === option.id) ||
            (!picked.modifierId && picked.name === option.name)
        )
      );
    }
    setEditingLineKey(line.key);
    setSelectedMods(initial);
    setModifierGroupId(item.modifierGroups[0]?.id ?? "");
    setModifierItem(item);
    setMobilePane("items");
  }

  function closeModifierPicker() {
    setModifierItem(null);
    setEditingLineKey(null);
    setSelectedMods({});
    setModifierGroupId("");
  }

  async function saveLineModifiers(
    lineKey: string,
    mods: { modifierId?: string; name: string; priceCents: number; groupName?: string }[]
  ) {
    try {
      await enqueue(async () => {
        const t = await ensureTicket();
        if (isLocalTicket(t) || !offline.online) {
          const local = await ensureLocalTicket(registerId);
          const line = local.lines.find((entry) => entry.key === lineKey);
          if (!line) throw new Error("Line not found");
          line.modifiers = mods;
          const saved = await persistLocalTicket(local);
          setCurrentTicket(localToTicket(saved));
          closeModifierPicker();
          setMobilePane("ticket");
          return;
        }
        const updated = await api<Ticket>(`/pos/tickets/${t.id}/lines/${lineKey}`, {
          method: "PATCH",
          body: JSON.stringify({ modifiers: mods }),
        });
        setCurrentTicket(updated);
        closeModifierPicker();
        setMobilePane("ticket");
      });
      return true;
    } catch (error) {
      if (error instanceof OfflineError) {
        try {
          const local = await ensureLocalTicket(registerId);
          const line = local.lines.find((entry) => entry.key === lineKey);
          if (!line) throw new Error("Line not found");
          line.modifiers = mods;
          const saved = await persistLocalTicket(local);
          setCurrentTicket(localToTicket(saved));
          closeModifierPicker();
          setMobilePane("ticket");
          return true;
        } catch (inner) {
          fail("Could not update item", inner);
          return false;
        }
      }
      fail("Could not update item", error);
      return false;
    }
  }

  async function confirmModifiers() {
    if (!modifierItem) return;
    for (const group of modifierItem.modifierGroups) {
      const picked = selectedMods[group.id] ?? [];
      if (picked.length < group.minSelect) {
        setModifierGroupId(group.id);
        fail(
          modifierItem.name,
          new Error(group.minSelect > 1 ? `Choose at least ${group.minSelect} for ${group.name}` : `Choose ${group.name}`)
        );
        return;
      }
    }
    const mods = sortModsByItemGroups(
      modifierItem.modifierGroups.flatMap((group) =>
        (selectedMods[group.id] ?? []).map((option) => ({
          modifierId: option.id,
          name: option.name,
          priceCents: option.priceCents,
          groupName: group.name,
        }))
      ),
      modifierItem.modifierGroups
    );
    if (editingLineKey) {
      await saveLineModifiers(editingLineKey, mods);
      return;
    }
    if (await addVariant(modifierItem, mods)) {
      setModifierItem(null);
      setEditingLineKey(null);
    }
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
    if (!ticketRef.current) return;
    await enqueue(async () => {
      const current = ticketRef.current;
      if (!current) return;
      if (isLocalTicket(current) || !offline.online) {
        const local = await ensureLocalTicket(registerId);
        if (quantity <= 0) local.lines = local.lines.filter((entry) => entry.key !== line.key);
        else {
          const target = local.lines.find((entry) => entry.key === line.key);
          if (target) target.quantity = quantity;
        }
        const saved = await persistLocalTicket(local);
        setCurrentTicket(local.lines.length ? localToTicket(saved) : null);
        return;
      }
      const updated =
        quantity <= 0
          ? await api<Ticket>(`/pos/tickets/${current.id}/lines/${line.key}`, { method: "DELETE" })
          : await api<Ticket>(`/pos/tickets/${current.id}/lines/${line.key}`, {
              method: "PATCH",
              body: JSON.stringify({ quantity }),
            });
      setCurrentTicket(updated);
    }).catch((error) => fail("Could not update quantity", error));
  }

  async function holdTicket() {
    if (!ticket || ticket.lines.length === 0) return;
    if (isLocalTicket(ticket) || !offline.online) {
      fail("Hold", new Error("Hold needs the cloud — ticket stays on this till until you are online."));
      return;
    }
    try {
      await api(`/pos/tickets/${ticket.id}/hold`, { method: "POST" });
      setCurrentTicket(null);
      setMobilePane("items");
      void refreshOpenTickets();
    } catch (error) {
      fail("Could not hold ticket", error);
    }
  }

  async function clearTicket() {
    if (!ticket) return;
    try {
      if (isLocalTicket(ticket) || !offline.online) {
        const { clearLocalTicket } = await import("./offline/db");
        await clearLocalTicket(ticket.id);
        setCurrentTicket(null);
        setMobilePane("items");
        return;
      }
      await api(`/pos/tickets/${ticket.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "voided" }),
      });
      setCurrentTicket(null);
      setMobilePane("items");
      void refreshOpenTickets();
    } catch (error) {
      fail("Could not clear ticket", error);
    }
  }

  async function openHeld() {
    try {
      const list = await api<Ticket[]>("/pos/tickets?status=held");
      setHeld(Array.isArray(list) ? list : []);
      setModal({ type: "held" });
    } catch (error) {
      setHeld([]);
      fail("Held tickets", error);
    }
  }

  async function openRecentSales() {
    setRecentSaleMsg("");
    setSelectedRecentSale(null);
    setRecentSaleQuery("");
    try {
      const list = await api<RecentSale[]>("/sales?limit=40");
      setRecentSales(Array.isArray(list) ? list : []);
      setModal({ type: "recentSales" });
    } catch (error) {
      fail("Receipts", error);
    }
  }

  async function searchRecentSales(q: string) {
    setRecentSaleQuery(q);
    try {
      const list = await api<RecentSale[]>(
        `/sales?limit=40${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`
      );
      setRecentSales(Array.isArray(list) ? list : []);
    } catch (error) {
      fail("Receipts", error);
    }
  }

  async function reopenRecentSale(sale: RecentSale) {
    if (!offline.online) {
      setRecentSaleMsg("Go online to open a paid sale on the till");
      return;
    }
    if (ticket?.lines.length) {
      const ok = window.confirm(
        "Replace the current sale with this receipt’s items? The paid receipt stays as-is — this opens a new editable ticket."
      );
      if (!ok) return;
    }
    setBusy(true);
    setRecentSaleMsg("");
    try {
      const opened = await api<Ticket & { sourceReceiptNumber?: string; skippedLines?: number }>(
        `/sales/${sale.id}/reopen`,
        {
          method: "POST",
          body: JSON.stringify({ registerId }),
        }
      );
      setCurrentTicket(opened);
      setMobilePane("ticket");
      setModal(null);
      void refreshOpenTickets();
      if (opened.skippedLines) {
        setModal({
          type: "message",
          title: `Opened ${opened.sourceReceiptNumber || sale.receiptNumber}`,
          body: `Some lines could not be copied (${opened.skippedLines}). Edit the ticket before charging again.`,
        });
      }
    } catch (error) {
      setRecentSaleMsg(error instanceof Error ? error.message : "Could not open sale");
      fail("Could not open sale", error);
    } finally {
      setBusy(false);
    }
  }

  async function reprintRecentSale(sale: RecentSale, kind: "billing" | "kitchen") {
    setRecentSaleMsg("");
    try {
      if (kind === "billing") {
        await api("/printers/print-receipt", {
          method: "POST",
          body: JSON.stringify({ saleId: sale.id }),
        });
        setRecentSaleMsg(`Billing receipt ${sale.receiptNumber} sent`);
      } else {
        await api<{ preview?: string }>("/printers/print-kitchen", {
          method: "POST",
          body: JSON.stringify({ saleId: sale.id }),
        });
        setRecentSaleMsg(`Kitchen ticket ${sale.receiptNumber} sent`);
      }
    } catch (error) {
      setRecentSaleMsg(error instanceof Error ? error.message : "Print failed");
      fail(kind === "billing" ? "Billing receipt" : "Kitchen ticket", error);
    }
  }

  async function voidOrRefundRecentSale(sale: RecentSale, action: "void" | "refund") {
    if (user.role !== "owner" && user.role !== "manager") {
      setRecentSaleMsg("Only an owner or manager can void or refund");
      return;
    }
    const label = action === "void" ? "Void" : "Refund";
    if (!window.confirm(`${label} ${sale.receiptNumber}? This cannot be undone from the till.`)) return;
    setBusy(true);
    setRecentSaleMsg("");
    try {
      await api(`/sales/${sale.id}/${action}`, {
        method: "POST",
        body: action === "refund" ? JSON.stringify({ full: true }) : undefined,
      });
      await searchRecentSales(recentSaleQuery);
      setSelectedRecentSale(null);
      setRecentSaleMsg(`${label}ed ${sale.receiptNumber}`);
    } catch (error) {
      setRecentSaleMsg(error instanceof Error ? error.message : `${label} failed`);
      fail(label, error);
    } finally {
      setBusy(false);
    }
  }

  async function recall(id: string) {
    try {
      const t = await api<Ticket>(`/pos/tickets/${id}/recall`, { method: "POST" });
      setCurrentTicket(t);
      setModal(null);
      setMobilePane("ticket");
      void refreshOpenTickets();
    } catch (error) {
      fail("Could not recall ticket", error);
    }
  }

  /** Live-sync: open a store ticket on this till (any register). */
  async function adoptTicket(id: string) {
    try {
      const t = await api<Ticket>(`/pos/tickets/${id}/claim`, {
        method: "POST",
        body: JSON.stringify({ registerId }),
      });
      setCurrentTicket(t);
      setModal(null);
      setMobilePane("ticket");
      setLiveSyncLabel(`Opened from ${t.registerName || "store"}`);
      void refreshOpenTickets();
    } catch (error) {
      fail("Could not open ticket on this till", error);
    }
  }

  async function openTicketsBoard() {
    try {
      const b = await api<BoardTicket[]>("/extras/tickets-board");
      setBoard(Array.isArray(b) ? b : []);
      setModal({ type: "board" });
    } catch (error) {
      setBoard([]);
      fail("Tickets", error);
    }
  }

  async function openKitchenBoard() {
    try {
      const k = await api<KitchenOrder[]>("/kitchen/orders");
      setKitchenOrders(Array.isArray(k) ? k : []);
      setModal({ type: "kitchen" });
    } catch (error) {
      setKitchenOrders([]);
      fail("Kitchen", error);
    }
  }

  async function openCustomers() {
    try {
      const list = await api<Customer[]>("/customers");
      setCustomers(list);
      setCustomerQuery("");
      setNewCustomerName("");
      setNewCustomerPhone(textPayPhone.trim());
      setCustomerFormMsg("");
      setModal({ type: "customers" });
    } catch (error) {
      fail("Customers", error);
    }
  }

  async function searchCustomers(q: string) {
    setCustomerQuery(q);
    try {
      const list = await api<Customer[]>(`/customers${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
      setCustomers(list);
    } catch (error) {
      fail("Customers", error);
    }
  }

  async function attachCustomer(c: Customer, opts?: { closeModal?: boolean }) {
    try {
      const t = ticketRef.current ?? (await ensureTicket());
      if (isLocalTicket(t) || !offline.online) {
        fail("Customer", new Error("Attach a customer when the till is online"));
        return false;
      }
      const updated = await api<Ticket>(`/pos/tickets/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ customerId: c.id }),
      });
      setCurrentTicket(updated);
      setTextPayName(c.name);
      if (c.phone) setTextPayPhone(c.phone);
      if (opts?.closeModal !== false) setModal(null);
      return true;
    } catch (error) {
      fail("Could not attach customer", error);
      return false;
    }
  }

  async function createCustomerFromTill(opts?: { name?: string; phone?: string; closeModal?: boolean }) {
    const name = (opts?.name ?? newCustomerName).trim();
    const phone = (opts?.phone ?? newCustomerPhone).trim();
    if (!name) {
      setCustomerFormMsg("Enter a name");
      return null;
    }
    if (!offline.online) {
      setCustomerFormMsg("Go online to add a customer");
      return null;
    }
    setCustomerFormMsg("");
    try {
      const created = await api<Customer>("/customers", {
        method: "POST",
        body: JSON.stringify({ name, phone: phone || undefined }),
      });
      setCustomers((prev) => [created, ...prev.filter((row) => row.id !== created.id)]);
      await attachCustomer(created, { closeModal: opts?.closeModal !== false });
      setNewCustomerName("");
      setNewCustomerPhone("");
      return created;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not add customer";
      setCustomerFormMsg(message);
      fail("Could not add customer", error);
      return null;
    }
  }

  async function lookupCallerId(phone: string) {
    const q = phone.trim();
    if (q.replace(/\D/g, "").length < 7) {
      setCallerMatches([]);
      return;
    }
    try {
      const list = await api<Customer[]>(`/customers?q=${encodeURIComponent(q)}`);
      const digits = q.replace(/\D/g, "");
      setCallerMatches(
        list.filter((row) => (row.phone || "").replace(/\D/g, "").includes(digits) || digits.includes((row.phone || "").replace(/\D/g, "")))
      );
    } catch {
      setCallerMatches([]);
    }
  }

  async function saveCallerAsCustomer() {
    const phone = textPayPhone.trim();
    const name = textPayName.trim() || phone || "Caller";
    if (!phone && !textPayName.trim()) {
      setTextPayMsg("Enter a caller ID (phone) or name first");
      return;
    }
    const existing = callerMatches[0];
    if (existing) {
      if (await attachCustomer(existing, { closeModal: false })) {
        setTextPayMsg(`Attached ${existing.name}`);
      }
      return;
    }
    const created = await createCustomerFromTill({ name, phone, closeModal: false });
    if (created) {
      setTextPayMsg(`Saved ${created.name} and attached to this sale`);
    }
  }

  async function ensureCallerCustomerOnTicket(current: Ticket) {
    if (current.customerId || isLocalTicket(current) || !offline.online) return current;
    const phone = textPayPhone.trim();
    const name = textPayName.trim();
    if (!phone && !name) return current;
    try {
      if (phone) {
        const list = await api<Customer[]>(`/customers?q=${encodeURIComponent(phone)}`);
        const digits = phone.replace(/\D/g, "");
        const match = list.find((row) => {
          const rowDigits = (row.phone || "").replace(/\D/g, "");
          return rowDigits && digits && (rowDigits.includes(digits) || digits.includes(rowDigits));
        });
        if (match) {
          const updated = await api<Ticket>(`/pos/tickets/${current.id}`, {
            method: "PATCH",
            body: JSON.stringify({ customerId: match.id }),
          });
          setCurrentTicket(updated);
          return updated;
        }
      }
      if (name && phone) {
        const created = await api<Customer>("/customers", {
          method: "POST",
          body: JSON.stringify({ name, phone }),
        });
        const updated = await api<Ticket>(`/pos/tickets/${current.id}`, {
          method: "PATCH",
          body: JSON.stringify({ customerId: created.id }),
        });
        setCurrentTicket(updated);
        return updated;
      }
    } catch {
      /* pay link can still go without a saved customer */
    }
    return current;
  }

  async function applyDiscount(discountCents: number, discountPercent: number) {
    if (!ticket) return;
    try {
      const updated = await api<Ticket>(`/pos/tickets/${ticket.id}`, {
        method: "PATCH",
        body: JSON.stringify({ discountCents, discountPercent }),
      });
      setCurrentTicket(updated);
      setModal(null);
    } catch (error) {
      fail("Could not apply discount", error);
    }
  }

  async function applyTip(tipCents: number) {
    if (!ticket) return;
    try {
      const updated = await api<Ticket>(`/pos/tickets/${ticket.id}`, {
        method: "PATCH",
        body: JSON.stringify({ tipCents }),
      });
      setCurrentTicket(updated);
      setModal(null);
    } catch (error) {
      fail("Could not apply tip", error);
    }
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

  function setTender(id: string, cents: number) {
    const safe = Math.max(0, cents);
    setPayAmounts((prev) => ({ ...prev, [id]: safe }));
    setPayText((prev) => ({ ...prev, [id]: (safe / 100).toFixed(2) }));
  }

  function openPay() {
    if (!ticket || ticket.lines.length === 0) return;
    const cash = paymentTypes.find((p) => p.type === "cash");
    const amounts: Record<string, number> = {};
    const text: Record<string, string> = {};
    for (const type of paymentTypes) {
      const cents = cash && type.id === cash.id ? ticket.totalCents : 0;
      amounts[type.id] = cents;
      text[type.id] = (cents / 100).toFixed(2);
    }
    setPayAmounts(amounts);
    setPayText(text);
    setTextPayPhone(ticket.customer?.phone ?? textPayPhone);
    setTextPayName(ticket.customer?.name ?? textPayName);
    setTextPayMsg("");
    setTextPayLink(null);
    setMobilePane("ticket");
    setModal({ type: "pay" });
  }

  /** Phone orders: ring items → send SMS/pay link (no cash/card tender UI). */
  async function openPhoneOrder() {
    setTextPayMsg("");
    setTextPayLink(null);
    setCallerMatches([]);
    // Don't create an empty Sale ticket just for opening the sheet — that filled Tickets with 0-line junk.
    const t = ticketRef.current;
    if (t) {
      setTextPayPhone(textPayPhone || t.customer?.phone || "");
      setTextPayName(textPayName || t.customer?.name || "");
      if (t.customer?.phone || textPayPhone) void lookupCallerId(t.customer?.phone || textPayPhone);
    }
    setMobilePane("ticket");
    setModal({ type: "phoneOrder" });
  }

  async function sendTextToPay() {
    if (!ticket || isLocalTicket(ticket)) {
      setTextPayMsg("Phone order pay link needs an online cloud ticket");
      return;
    }
    if (!ticket.lines.length) {
      setTextPayMsg("Add items to the phone order first");
      return;
    }
    setBusy(true);
    setTextPayMsg("");
    try {
      let current = await ensureCallerCustomerOnTicket(ticket);
      const label = textPayName.trim()
        ? `Phone · ${textPayName.trim()}`
        : current.name.startsWith("Phone")
          ? current.name
          : "Phone order";
      if (current.name !== label || current.note !== "Phone order") {
        current = await api<Ticket>(`/pos/tickets/${current.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: label, note: "Phone order" }),
        });
        setCurrentTicket(current);
      }
      const result = await api<{
        message: string;
        link: { id: string; payUrl: string; status: string };
        hostedPayUrl: string;
        smsError?: string | null;
      }>("/text-pay/links", {
        method: "POST",
        body: JSON.stringify({
          ticketId: current.id,
          phone: textPayPhone.trim() || undefined,
          customerName: textPayName.trim() || undefined,
          note: "Phone order",
          sendSms: Boolean(textPayPhone.trim()),
        }),
      });
      setTextPayLink({
        id: result.link.id,
        payUrl: result.link.payUrl,
        status: result.link.status,
        hostedPayUrl: result.hostedPayUrl,
      });
      setTextPayMsg(result.message);
    } catch (e) {
      setTextPayMsg(e instanceof Error ? e.message : "Could not create pay link");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!textPayLink || textPayLink.status === "paid") return;
    const t = setInterval(() => {
      void api<{ status: string; saleId?: string | null }>(`/text-pay/links/${textPayLink.id}`)
        .then((link) => {
          if (link.status === "paid") {
            setTextPayLink((prev) => (prev ? { ...prev, status: "paid" } : prev));
            setCurrentTicket(null);
            setMobilePane("items");
            setModal({
              type: "message",
              title: "Phone order · paid",
              body: "Customer paid the link. Sale is complete.",
            });
            void loadCatalog();
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(t);
  }, [textPayLink]);

  async function toggleClock() {
    try {
      if (clockedIn) await api("/time-clock/clock-out", { method: "POST", body: "{}" });
      else await api("/time-clock/clock-in", { method: "POST", body: "{}" });
      const status = await api<{ clockedIn: boolean }>("/time-clock/status");
      setClockedIn(status.clockedIn);
      setModal({
        type: "message",
        title: "Time clock",
        body: status.clockedIn ? "Clocked in." : "Clocked out.",
      });
    } catch (e) {
      setModal({ type: "message", title: "Time clock", body: e instanceof Error ? e.message : "Failed" });
    }
  }

  async function completePay() {
    if (!ticket) return;
    let remaining = ticket.totalCents;
    const ranked = Object.entries(payAmounts)
      .filter(([, amount]) => amount > 0)
      .sort((a, b) => {
        const aCash = paymentTypes.find((p) => p.id === a[0])?.type === "cash" ? 1 : 0;
        const bCash = paymentTypes.find((p) => p.id === b[0])?.type === "cash" ? 1 : 0;
        return aCash - bCash;
      });
    type PayLine = {
      paymentTypeId: string;
      amountCents: number;
      tenderedCents?: number;
      giftCardCode?: string;
    };
    const payments: PayLine[] = [];
    for (const [paymentTypeId, amountCents] of ranked) {
      const pt = paymentTypes.find((p) => p.id === paymentTypeId);
      if (pt?.type === "cash") {
        const tendered = amountCents;
        remaining -= Math.min(tendered, Math.max(remaining, 0));
        payments.push({ paymentTypeId, amountCents: tendered, tenderedCents: tendered });
        continue;
      }
      const applied = Math.min(amountCents, Math.max(remaining, 0));
      if (applied <= 0) continue;
      remaining -= applied;
      payments.push({
        paymentTypeId,
        amountCents: applied,
        giftCardCode: pt?.type === "gift_card" ? giftCardCode : undefined,
      });
    }
    if (!payments.length) return;
    setBusy(true);
    try {
      if (isLocalTicket(ticket) || !offline.online) {
        const local = await ensureLocalTicket(registerId);
        local.tipCents = ticket.tipCents;
        local.discountCents = ticket.discountCents;
        const queued = await queueCompletedLocalSale({
          ticket: local,
          payments,
          taxRateBps,
        });
        setCurrentTicket(null);
        setModal({
          type: "receipt",
          text: queued.text,
          changeCents: queued.changeCents,
          saleId: queued.clientSaleId,
        });
        await refreshOfflineBadge();
        return;
      }
      const result = await api<{
        sale: {
          id: string;
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
        kitchenTicket?: { preview: string; orderId: string | null; printJobId: string };
        changeCents: number;
        drawerOpened: boolean;
      }>(`/pos/tickets/${ticket.id}/pay`, {
        method: "POST",
        body: JSON.stringify({ payments, tipCents: ticket.tipCents }),
      });
      const s = result.sale;
      const lines = s.lines
        .map((l, index) => {
          const head = `${l.quantity} x ${l.name}`.padEnd(28) + money(l.totalCents);
          const blocks = groupModifierLines(ticket.lines[index]?.modifiers ?? []);
          const modLines = blocks.flatMap((block) => [
            ...(block.groupName ? [`  ${block.groupName}`] : []),
            ...block.names.map((name) => `  + ${name}`),
          ]);
          return [head, ...modLines].join("\n");
        })
        .join("\n");
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
      const kitchenText = result.kitchenTicket?.preview;
      setCurrentTicket(null);
      setMobilePane("items");
      setModal({
        type: "receipt",
        text,
        changeCents: result.changeCents,
        saleId: s.id,
        kitchenText,
      });
      void api("/printers/print-receipt", {
        method: "POST",
        body: JSON.stringify({ saleId: s.id, openDrawer: result.drawerOpened }),
      }).catch(() => undefined);
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
  const lineCount = (ticket?.lines ?? []).reduce((n, line) => n + line.quantity, 0);
  const hasLines = lineCount > 0;
  const kitchenSent = ticket ? sentToKitchen[ticket.id] ?? {} : {};
  const unsentLines = (ticket?.lines ?? [])
    .map((line) => ({ line, quantity: line.quantity - (kitchenSent[line.key] ?? 0) }))
    .filter((entry) => entry.quantity > 0);
  const unsentCount = unsentLines.reduce((n, entry) => n + entry.quantity, 0);
  const sentBefore = Object.keys(kitchenSent).length > 0;

  function openKitchenSend() {
    if (!ticket || !unsentCount) return;
    setKitchenForm({
      name: ticket.customer?.name || (/^Ticket\b/i.test(ticket.name) ? "" : ticket.name),
      fulfillment: "dine_in",
      note: "",
    });
    setModal({ type: "kitchenSend" });
  }

  async function sendToKitchen() {
    if (!ticket || !unsentLines.length) return;
    const name = kitchenForm.name.trim() || ticket.name || "Till order";
    setBusy(true);
    try {
      await api("/kitchen/orders", {
        method: "POST",
        body: JSON.stringify({
          name,
          fulfillment: kitchenForm.fulfillment,
          note: kitchenForm.note.trim() || undefined,
          ticketId: ticket.id,
          lines: unsentLines.map(({ line, quantity }) => ({
            variantId: line.variantId,
            name: line.name,
            quantity,
            unitPriceCents: line.unitPriceCents,
            modifiersJson: JSON.stringify(
              line.modifiers.map((m) => ({
                name: m.name,
                priceCents: m.priceCents,
                ...(m.modifierId ? { modifierId: m.modifierId } : {}),
                ...(m.groupName ? { groupName: m.groupName } : {}),
              }))
            ),
          })),
        }),
      });
      setSentToKitchen((prev) => ({
        ...prev,
        [ticket.id]: Object.fromEntries(ticket.lines.map((line) => [line.key, line.quantity])),
      }));
      setModal(null);
    } catch (error) {
      fail("Send to kitchen", error);
    } finally {
      setBusy(false);
    }
  }
  const visibleItems = showFavorites && favorites.length ? favorites : filtered;
  const activeModGroup =
    modifierItem?.modifierGroups.find((group) => group.id === modifierGroupId) ?? modifierItem?.modifierGroups[0];
  const modifierExtra = Object.values(selectedMods)
    .flat()
    .reduce((sum, option) => sum + option.priceCents, 0);
  const modifierTotal = (modifierItem?.variants[0]?.priceCents ?? 0) + modifierExtra;
  const modifierPreview = modifierItem
    ? sortModsByItemGroups(
        modifierItem.modifierGroups.flatMap((group) =>
          (selectedMods[group.id] ?? []).map((option) => ({ name: option.name, groupName: group.name }))
        ),
        modifierItem.modifierGroups
      )
    : [];
  const tillPhase: "sale" | "options" | "pay" | "done" = modifierItem
    ? "options"
    : modal?.type === "pay"
      ? "pay"
      : modal?.type === "receipt"
        ? "done"
        : "sale";
  const currentRegister = registers.find((register) => register.id === registerId);

  function pinThisIpad() {
    if (!currentRegister) return;
    writePinnedTill({
      storeId: store.id,
      registerId: currentRegister.id,
      registerName: currentRegister.name,
      toneIndex: registerToneIndex(currentRegister.id, registers),
    });
    setPinnedId(currentRegister.id);
  }

  useEffect(() => {
    if (!currentRegister || pinnedId === currentRegister.id) return;
    pinThisIpad();
  }, [currentRegister?.id, pinnedId]);

  function groupsForLine(line: TicketLine) {
    return items.find((entry) => entry.variants.some((variant) => variant.id === line.variantId))?.modifierGroups;
  }

  async function toggleFullScreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await document.documentElement.requestFullscreen();
    } catch {
      // iPad Safari often refuses this. Guided Access is the way to pin the device.
    }
  }

  return (
    <div className={`app-shell till-${tillPhase}`}>
      <div className="toolbar-dark">
        <div className="toolbar-identity">
          <strong className="store-name">{store.name}</strong>
          <span className="who">{user.name}</span>
          {currentRegister && (
            <span
              className="register-badge"
              data-register-name={currentRegister.name}
              style={{ background: registerTone(currentRegister.id, registers).bg, color: registerTone(currentRegister.id, registers).ink }}
            >
              {currentRegister.name}
            </span>
          )}
          <button type="button" className="lock-btn" onClick={onLogout}>
            Lock
          </button>
        </div>
        <button
          type="button"
          className={`offline-badge${!offline.online ? " is-offline" : ""}${offline.pendingSales ? " has-queue" : ""}`}
          title={
            offline.online
              ? offline.pendingSales
                ? `${offline.pendingSales} sale(s) waiting to sync — click to sync, or Export backup`
                : "Online · items follow server · storage persistence requested"
              : "Offline · sales queue locally; items from cache"
          }
          onClick={() => {
            if (offline.online && offline.pendingSales) void syncQueuedSales();
            else void refreshOfflineBadge();
          }}
        >
          {!offline.online ? "Offline" : offline.syncing ? "Syncing…" : offline.pendingSales ? `Sync ${offline.pendingSales}` : "Online"}
        </button>
        {offline.pendingSales > 0 ? (
          <button
            type="button"
            className="offline-export"
            title="Download unsynced sales JSON in case this device is wiped before sync"
            onClick={() => {
              void exportPendingSalesBackup().then((result) => {
                if (result) setCatalogError(`Saved backup of ${result.count} unsynced sale(s) — keep that file until Sync clears`);
              });
            }}
          >
            Export
          </button>
        ) : null}
        <div className={`toolbar-actions${tillPhase === "options" || tillPhase === "pay" || tillPhase === "done" ? " is-quiet" : ""}`}>
        <button type="button" className="toolbar-keep" onClick={() => void openTicketsBoard()}>
          Tickets{openTickets.length ? ` · ${openTickets.length}` : ""}
        </button>
        <button type="button" className="toolbar-desk" onClick={() => void openRecentSales()}>
          Receipts
        </button>
        <button type="button" className="toolbar-desk" onClick={() => void openKitchenBoard()}>
          Kitchen
        </button>
        <button type="button" className={`toolbar-desk${clockedIn ? " is-live" : ""}`} onClick={() => void toggleClock()}>
          {clockedIn ? "Clock out" : "Clock in"}
        </button>
        <button type="button" className={`toolbar-desk${shift ? " is-live" : ""}`} onClick={() => setModal({ type: "shift" })}>
          {shift ? "Close shift" : "Open shift"}
        </button>
        <button type="button" className="toolbar-desk" onClick={() => void openDrawer()}>
          Drawer
        </button>
        <button type="button" className="toolbar-phone-more" onClick={() => setModal({ type: "more" })}>
          More
        </button>
        </div>
      </div>
      <p className={`guided-note${pinnedId !== registerId && currentRegister ? " is-pinning" : ""}`}>
        {pinnedId !== registerId && currentRegister && (
          <button type="button" className="pin-till-btn" onClick={pinThisIpad}>
            Use this iPad as {currentRegister.name}
          </button>
        )}
        <button type="button" className="fullscreen-btn" onClick={() => void toggleFullScreen()}>
          {fullScreen ? "Exit full screen" : "Full screen"}
        </button>
        <span>
          {pinnedId !== registerId && currentRegister
            ? `Tap Use this iPad as ${currentRegister.name} to pin this device. Change till from Lock → Change till. Guided Access keeps Safari on this page.`
            : "Full screen only fills this window. To keep an iPad on this till, use Guided Access: Settings, Accessibility, Guided Access, then triple-click the side button."}
        </span>
      </p>

      <div className={`register pane-${mobilePane}`}>
        <section className="panel catalog-panel">
          <div className="topbar">
            {modifierItem ? (
              <>
                <button type="button" className="chip" onClick={() => closeModifierPicker()}>
                  ← {editingLineKey ? "Sale" : "Menu"}
                </button>
                <div className="brand-mini">{editingLineKey ? `Edit · ${modifierItem.name}` : modifierItem.name}</div>
              </>
            ) : (
              <>
                <div className="brand-mini">PurePOS</div>
                <input
                  className="search"
                  placeholder="Search or scan barcode / SKU"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => void onSearchKey(e)}
                />
              </>
            )}
          </div>
          <div className="chip-row" role="tablist" aria-label={modifierItem ? "Modifier options" : "Item groups"}>
            {modifierItem ? (
              modifierItem.modifierGroups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  className={`chip ${activeModGroup?.id === group.id ? "active" : ""}`}
                  onClick={() => setModifierGroupId(group.id)}
                >
                  {group.name}
                  {group.minSelect > 0 ? " *" : ""}
                </button>
              ))
            ) : (
              <>
                <button
                  type="button"
                  className={`chip ${showFavorites ? "active" : ""}`}
                  onClick={() => {
                    setShowFavorites(true);
                    setCategoryId("all");
                  }}
                >
                  ★ Quick keys
                </button>
                <button
                  type="button"
                  className={`chip ${!showFavorites && categoryId === "all" ? "active" : ""}`}
                  onClick={() => {
                    setShowFavorites(false);
                    setCategoryId("all");
                  }}
                >
                  All groups
                </button>
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`chip ${!showFavorites && categoryId === c.id ? "active" : ""}`}
                    onClick={() => {
                      setShowFavorites(false);
                      setCategoryId(c.id);
                    }}
                  >
                    {c.name}
                  </button>
                ))}
              </>
            )}
          </div>
          {catalogError && <p className="banner">{catalogError}</p>}
          <div className="grid">
            {modifierItem && activeModGroup ? (
              activeModGroup.modifiers.map((option) => {
                const selected = (selectedMods[activeModGroup.id] ?? []).some((picked) => picked.id === option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`item-tile ${selected ? "is-selected" : ""}`}
                    style={{ backgroundColor: modifierItem.color }}
                    onClick={() => chooseModifier(activeModGroup, option)}
                  >
                    <span className="name">{option.name}</span>
                    <span className="price">{option.priceCents ? `+${money(option.priceCents)}` : "Included"}</span>
                  </button>
                );
              })
            ) : (
              <>
                {!menuReady && <p className="empty">Loading menu…</p>}
                {menuReady && visibleItems.length === 0 && <p className="empty">Nothing in this group.</p>}
                {visibleItems.map((item) => (
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
              </>
            )}
          </div>
          {modifierItem && (
            <div className="modifier-bar">
              <div>
                <p className="step-kicker">{editingLineKey ? "Edit options" : "Step 2 · Options"}</p>
                <strong>{modifierItem.name}</strong>
                {modifierPreview.length > 0 ? (
                  <ModifierList mods={modifierPreview} groups={modifierItem?.modifierGroups} />
                ) : (
                  <div className="meta">Choose options</div>
                )}
              </div>
              <button type="button" className="pay-btn" onClick={() => void confirmModifiers()}>
                {editingLineKey ? "Update" : "Add"} {money(modifierTotal)}
              </button>
            </div>
          )}
        </section>

        <section className="panel ticket-panel">
          <div className="ticket-head">
            {liveSyncLabel ? <p className="live-sync-toast" role="status">{liveSyncLabel}</p> : null}
            <button type="button" className="mobile-only back-items" onClick={() => setMobilePane("items")}>
              Items
            </button>
            <div>
              <h2>{ticket?.name ?? "New sale"}</h2>
              <div className="ticket-sub" style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                {ticket?.customer ? `${ticket.customer.name} · ${ticket.customer.loyaltyPoints} pts` : "Walk-in"}
                {offline.online ? " · live sync" : ""}
              </div>
            </div>
            <button type="button" className="btn ghost" onClick={() => void openCustomers()}>
              Customer
            </button>
          </div>

          <div className="open-tickets-rail" aria-label="Open tickets across tills">
            <div className="open-tickets-label">
              <span>Open tills{offline.online ? " · live" : ""}</span>
              <button type="button" className="linkish" onClick={() => void refreshOpenTickets()}>
                Refresh
              </button>
            </div>
            {openTickets.length === 0 ? (
              <p className="open-tickets-empty">No open tickets on any till — start a sale anytime.</p>
            ) : (
              <div className="open-tickets-chips">
                {openTickets.map((t) => {
                  const active = ticket?.id === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={`open-ticket-chip${active ? " active" : ""}`}
                      onClick={() => {
                        if (active) return;
                        void adoptTicket(t.id);
                      }}
                    >
                      <strong>{t.name}</strong>
                      <span>
                        {t.registerName || "Till"} · {t.lines.length} item{t.lines.length === 1 ? "" : "s"} ·{" "}
                        {money(t.totalCents)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="ticket-lines">
            {(ticket?.lines ?? []).map((line) => {
              const modSum = line.modifiers.reduce((s, m) => s + m.priceCents, 0);
              const lineTotal = Math.round((line.unitPriceCents + modSum) * line.quantity) - line.discountCents;
              const canEditOptions = items.some(
                (entry) =>
                  entry.variants.some((variant) => variant.id === line.variantId) &&
                  entry.modifierGroups.length > 0
              );
              return (
                <div key={line.key} className={`line${canEditOptions ? " line-editable" : ""}`}>
                  <div>
                    {canEditOptions ? (
                      <button type="button" className="line-edit-hit" onClick={() => openLineEditor(line)}>
                        <span className="line-edit-name">{line.name}</span>
                        {line.modifiers.length > 0 && (
                          <ModifierList mods={line.modifiers} groups={groupsForLine(line)} />
                        )}
                        <span className="line-edit-hint">Edit options</span>
                      </button>
                    ) : (
                      <>
                        <div style={{ fontWeight: 600 }}>{line.name}</div>
                        {line.modifiers.length > 0 && (
                          <ModifierList mods={line.modifiers} groups={groupsForLine(line)} />
                        )}
                      </>
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
              <p className="empty-ticket">
                {openTickets.length
                  ? "Tap an open ticket above to continue it here, or add an item for a new sale."
                  : "No open orders — tap an item to start a new sale."}
              </p>
            )}
          </div>

          <div className="totals">
            <div className="row">
              <span>Subtotal</span>
              <span>{money(ticket?.subtotalCents ?? 0)}</span>
            </div>
            {(ticket?.discountCents ?? 0) > 0 && (
              <div className="row">
                <span>Discount</span>
                <span>{money(-(ticket?.discountCents ?? 0))}</span>
              </div>
            )}
            <div className="row">
              <span>VAT</span>
              <span>{money(ticket?.taxCents ?? 0)}</span>
            </div>
            {(ticket?.tipCents ?? 0) > 0 && (
              <div className="row">
                <span>Tip</span>
                <span>{money(ticket?.tipCents ?? 0)}</span>
              </div>
            )}
            <div className="row grand">
              <span>Total</span>
              <span>{money(ticket?.totalCents ?? 0)}</span>
            </div>
          </div>

          <div className="actions">
            <button type="button" disabled={!hasLines} onClick={() => void holdTicket()}>
              Hold
            </button>
            <button type="button" onClick={() => void openHeld()}>
              Recall
            </button>
            <button type="button" className="action-secondary" onClick={() => void openRecentSales()}>
              Receipts
            </button>
            <button type="button" className="action-secondary" disabled={!hasLines} onClick={() => ticket && setModal({ type: "discount" })}>
              Discount
            </button>
            <button
              type="button"
              className="action-secondary"
              disabled={!hasLines}
              onClick={() =>
                void api<{ suggestions: { label: string; tipCents: number; percent: number | null }[] }>(
                  `/extras/tip-suggestions?subtotalCents=${ticket?.subtotalCents ?? 0}`
                )
                  .then((r) => {
                    setTipSuggestions(r.suggestions);
                    setModal({ type: "tip" });
                  })
                  .catch((error) => fail("Tip", error))
              }
            >
              Tip
            </button>
            <button type="button" disabled={!ticket} onClick={() => void clearTicket()}>
              Clear
            </button>
            <button type="button" onClick={() => void openCustomers()}>
              Customer
            </button>
            <button type="button" className="action-secondary" disabled={!ticket} onClick={() => void openPhoneOrder()}>
              Phone order
            </button>
            <button type="button" disabled={!unsentCount || !offline.online} onClick={openKitchenSend}>
              {sentBefore && unsentCount ? `Kitchen · ${unsentCount} new` : sentBefore && hasLines ? "Sent to kitchen" : "Send to kitchen"}
            </button>
            <button type="button" className="pay-btn" disabled={!hasLines} onClick={openPay}>
              Charge {money(ticket?.totalCents ?? 0)}
            </button>
          </div>
        </section>
      </div>

      <div className={`mobile-dock${modifierItem ? " is-hidden" : ""}`}>
        {mobilePane === "ticket" ? (
          <button type="button" className="dock-ticket" onClick={() => setMobilePane("items")}>
            <span>← Items</span>
            <strong>{lineCount === 0 ? "Empty" : `${lineCount} ${lineCount === 1 ? "item" : "items"}`}</strong>
          </button>
        ) : (
          <button type="button" className="dock-ticket" onClick={() => setMobilePane("ticket")}>
            <span>{lineCount === 0 ? "Ticket empty" : `${lineCount} ${lineCount === 1 ? "item" : "items"}`}</span>
            <strong>{money(ticket?.totalCents ?? 0)}</strong>
          </button>
        )}
        <button type="button" className="dock-pay" onClick={openPay} disabled={lineCount === 0}>
          Charge{lineCount > 0 ? ` ${money(ticket?.totalCents ?? 0)}` : ""}
        </button>
      </div>

      {modal?.type === "more" && (
        <div className="modal-backdrop till-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p className="step-kicker">Till</p>
            <h3>More</h3>
            <div className="more-sheet">
              <button
                type="button"
                onClick={() => {
                  setModal(null);
                  void openRecentSales();
                }}
              >
                Receipts
              </button>
              <button
                type="button"
                onClick={() => {
                  setModal(null);
                  void openKitchenBoard();
                }}
              >
                Kitchen
              </button>
              <button
                type="button"
                className={clockedIn ? "is-live" : ""}
                onClick={() => {
                  setModal(null);
                  void toggleClock();
                }}
              >
                {clockedIn ? "Clock out" : "Clock in"}
              </button>
              <button
                type="button"
                className={shift ? "is-live" : ""}
                onClick={() => setModal({ type: "shift" })}
              >
                {shift ? "Close shift" : "Open shift"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setModal(null);
                  void openDrawer();
                }}
              >
                Drawer
              </button>
              <button
                type="button"
                disabled={!ticket}
                onClick={() => void openPhoneOrder()}
              >
                Phone order
              </button>
              <button
                type="button"
                disabled={!hasLines}
                onClick={() => {
                  setModal(null);
                  if (ticket) setModal({ type: "discount" });
                }}
              >
                Discount
              </button>
              <button
                type="button"
                disabled={!hasLines}
                onClick={() => {
                  void api<{ suggestions: { label: string; tipCents: number; percent: number | null }[] }>(
                    `/extras/tip-suggestions?subtotalCents=${ticket?.subtotalCents ?? 0}`
                  )
                    .then((r) => {
                      setTipSuggestions(r.suggestions);
                      setModal({ type: "tip" });
                    })
                    .catch((error) => fail("Tip", error));
                }}
              >
                Tip
              </button>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setModal(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "phoneOrder" && (
        <div className="modal-backdrop till-overlay" onClick={() => setModal(null)}>
          <div className="modal tender-modal" onClick={(e) => e.stopPropagation()}>
            <p className="step-kicker">Phone order</p>
            <h3>Take order → send pay link</h3>
            <ol className="hint" style={{ margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.45 }}>
              <li>Enter caller ID (their number) and optional name</li>
              <li>Ring their items on the till</li>
              <li>
                <strong>Send pay link</strong> — SMS when set up; otherwise copy the link
              </li>
            </ol>
            <p className="pay-summary">
              <span>
                Due <strong>{money(ticket?.totalCents ?? 0)}</strong>
              </span>
              <span>
                {ticket?.customer
                  ? ticket.customer.name
                  : ticket?.name || "Phone order"}
              </span>
            </p>
            {!ticket?.lines.length && (
              <p className="hint">Add items first, then send the link. This ticket is marked as a phone order.</p>
            )}
            <div className="field">
              <label>Caller ID (phone)</label>
              <input
                inputMode="tel"
                autoComplete="tel"
                placeholder="07… — the number calling in"
                value={textPayPhone}
                onChange={(e) => {
                  setTextPayPhone(e.target.value);
                  void lookupCallerId(e.target.value);
                }}
              />
            </div>
            <div className="field">
              <label>Caller name (optional)</label>
              <input
                placeholder="Name on order"
                value={textPayName}
                onChange={(e) => setTextPayName(e.target.value)}
              />
            </div>
            {callerMatches.length > 0 && (
              <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
                {callerMatches.slice(0, 4).map((match) => (
                  <button
                    key={match.id}
                    type="button"
                    className="list-btn"
                    onClick={() => void attachCustomer(match, { closeModal: false })}
                  >
                    <strong>{match.name}</strong>
                    <div style={{ color: "var(--muted)" }}>
                      {match.phone || "No number"} · tap to attach
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="tender-row" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn secondary"
                disabled={busy || (!textPayPhone.trim() && !textPayName.trim())}
                onClick={() => void saveCallerAsCustomer()}
              >
                {callerMatches[0] ? "Attach caller" : "Save caller as customer"}
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy || !ticket?.lines.length}
                onClick={() => void sendTextToPay()}
              >
                {busy ? "…" : textPayPhone.trim() ? "Send pay link" : "Create pay link"}
              </button>
              {textPayLink?.payUrl && (
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => void navigator.clipboard?.writeText(textPayLink.payUrl)}
                >
                  Copy link
                </button>
              )}
            </div>
            {textPayLink && (
              <p className="hint" style={{ marginTop: 10, wordBreak: "break-all" }}>
                {textPayLink.status === "paid" ? "Paid" : "Waiting for customer…"} · {textPayLink.payUrl}
              </p>
            )}
            {textPayMsg && <p className="hint">{textPayMsg}</p>}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setModal(null)}>
                {ticket?.lines.length ? "Keep ringing" : "Close"}
              </button>
              {!!ticket?.lines.length && (
                <button type="button" className="btn secondary" onClick={openPay}>
                  Cash / card instead
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {modal?.type === "pay" && ticket && (
        <div className="modal-backdrop till-overlay" onClick={() => setModal(null)}>
          <div className="modal tender-modal" onClick={(e) => e.stopPropagation()}>
            <p className="step-kicker">Step 3 · Pay</p>
            <h3>Take payment</h3>
            <p className="pay-summary">
              <span>
                Due <strong>{money(ticket.totalCents)}</strong>
              </span>
              <span>{paidSum > ticket.totalCents ? `Change ${money(paidSum - ticket.totalCents)}` : `Tendered ${money(paidSum)}`}</span>
            </p>
            {!shift && <p className="hint">Open a shift if you are taking cash. Card sales still go through.</p>}
            {paymentTypes.map((pt) => (
              <div key={pt.id} className="field">
                <label>
                  {pt.name}
                  {pt.type === "store_credit" && ticket.customer
                    ? ` · ${money(ticket.customer.storeCreditCents)} available`
                    : ""}
                </label>
                <div className="tender-row">
                  <input
                    inputMode="decimal"
                    value={payText[pt.id] ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setPayText((prev) => ({ ...prev, [pt.id]: raw }));
                      const parsed = parseFloat(raw);
                      setPayAmounts((prev) => ({
                        ...prev,
                        [pt.id]: Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0,
                      }));
                    }}
                  />
                  <button type="button" className="btn ghost" onClick={() => setTender(pt.id, ticket.totalCents)}>
                    Exact
                  </button>
                </div>
                {pt.type === "cash" && (
                  <div className="quick-amounts">
                    {[500, 1000, 2000, 5000].map((cents) => (
                      <button key={cents} type="button" onClick={() => setTender(pt.id, cents)}>
                        {money(cents)}
                      </button>
                    ))}
                  </div>
                )}
                {pt.type === "gift_card" && (payAmounts[pt.id] ?? 0) > 0 && (
                  <input
                    style={{ marginTop: 8 }}
                    placeholder="Gift card code"
                    value={giftCardCode}
                    onChange={(e) => setGiftCardCode(e.target.value.toUpperCase())}
                  />
                )}
              </div>
            ))}
            <div className="field pay-text-to-pay" style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line, #dce5e1)" }}>
              <label>Phone order · text to pay</label>
              <p className="hint" style={{ marginTop: 0 }}>
                For phone orders: send an SMS pay link (Twilio) or copy the link. Prefer{" "}
                <strong>Phone order</strong> on the ticket pane for the guided flow.
              </p>
              <input
                inputMode="tel"
                placeholder="07… mobile (optional — copy link if blank)"
                value={textPayPhone}
                onChange={(e) => setTextPayPhone(e.target.value)}
              />
              <div className="tender-row" style={{ marginTop: 8 }}>
                <button type="button" className="btn secondary" disabled={busy} onClick={() => void sendTextToPay()}>
                  {busy ? "…" : "Send pay link"}
                </button>
                {textPayLink?.payUrl && (
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => void navigator.clipboard?.writeText(textPayLink.payUrl)}
                  >
                    Copy link
                  </button>
                )}
              </div>
              {textPayLink && (
                <p className="hint" style={{ marginTop: 8, wordBreak: "break-all" }}>
                  {textPayLink.status === "paid" ? "Paid" : "Waiting for customer…"} · {textPayLink.payUrl}
                </p>
              )}
              {textPayMsg && <p className="hint">{textPayMsg}</p>}
            </div>
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

      {modal?.type === "recentSales" && (
        <div className="modal-backdrop till-overlay" onClick={() => setModal(null)}>
          <div className="modal tender-modal" onClick={(e) => e.stopPropagation()}>
            <p className="step-kicker">Paid sales</p>
            <h3>Receipts</h3>
            <p className="hint" style={{ marginTop: 0 }}>
              Open again copies items onto a new till ticket. The original payment stays unless you void or refund.
            </p>
            <div className="field">
              <label>Search</label>
              <input
                placeholder="Receipt or customer"
                value={recentSaleQuery}
                onChange={(e) => void searchRecentSales(e.target.value)}
              />
            </div>
            {recentSaleMsg && <p className="hint">{recentSaleMsg}</p>}
            {selectedRecentSale ? (
              <div style={{ display: "grid", gap: 10 }}>
                <button type="button" className="btn ghost" onClick={() => setSelectedRecentSale(null)}>
                  ← All receipts
                </button>
                <div>
                  <strong>{selectedRecentSale.receiptNumber}</strong>
                  <div style={{ color: "var(--muted)" }}>
                    {money(selectedRecentSale.totalCents)} · {selectedRecentSale.status} ·{" "}
                    {new Date(selectedRecentSale.createdAt).toLocaleString("en-GB", {
                      timeZone: "Europe/London",
                    })}
                  </div>
                  {selectedRecentSale.customerName && (
                    <div style={{ color: "var(--muted)" }}>{selectedRecentSale.customerName}</div>
                  )}
                </div>
                <ul className="kitchen-send-list">
                  {selectedRecentSale.lines.map((line, index) => (
                    <li key={`${selectedRecentSale.id}-${index}`}>
                      <strong>{line.quantity}×</strong> {line.name}
                    </li>
                  ))}
                </ul>
                <div className="tender-row">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy || selectedRecentSale.status !== "completed"}
                    onClick={() => void reopenRecentSale(selectedRecentSale)}
                  >
                    Open on till
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={busy}
                    onClick={() => void reprintRecentSale(selectedRecentSale, "billing")}
                  >
                    Reprint billing
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={busy}
                    onClick={() => void reprintRecentSale(selectedRecentSale, "kitchen")}
                  >
                    Reprint kitchen
                  </button>
                </div>
                {(user.role === "owner" || user.role === "manager") &&
                  selectedRecentSale.status === "completed" && (
                    <div className="tender-row">
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busy}
                        onClick={() => void voidOrRefundRecentSale(selectedRecentSale, "refund")}
                      >
                        Refund
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        disabled={busy}
                        onClick={() => void voidOrRefundRecentSale(selectedRecentSale, "void")}
                      >
                        Void
                      </button>
                    </div>
                  )}
              </div>
            ) : (
              <>
                {recentSales.length === 0 && (
                  <p style={{ color: "var(--muted)" }}>No receipts found.</p>
                )}
                {recentSales.map((sale) => (
                  <button
                    key={sale.id}
                    type="button"
                    className="list-btn"
                    onClick={() => {
                      setRecentSaleMsg("");
                      setSelectedRecentSale(sale);
                    }}
                  >
                    <strong>
                      {sale.receiptNumber}
                      {sale.status !== "completed" ? ` · ${sale.status}` : ""}
                    </strong>
                    <div style={{ color: "var(--muted)" }}>
                      {money(sale.totalCents)}
                      {sale.customerName ? ` · ${sale.customerName}` : ""} ·{" "}
                      {new Date(sale.createdAt).toLocaleTimeString("en-GB", {
                        timeZone: "Europe/London",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </button>
                ))}
              </>
            )}
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
            <div className="field">
              <label>Search</label>
              <input
                placeholder="Name or phone"
                value={customerQuery}
                onChange={(e) => void searchCustomers(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Add new customer</label>
              <input
                placeholder="Name"
                value={newCustomerName}
                onChange={(e) => setNewCustomerName(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Phone / caller ID (optional)</label>
              <input
                inputMode="tel"
                placeholder="07…"
                value={newCustomerPhone}
                onChange={(e) => setNewCustomerPhone(e.target.value)}
              />
            </div>
            <div className="tender-row" style={{ marginBottom: 10 }}>
              <button
                type="button"
                className="btn primary"
                disabled={busy || !newCustomerName.trim()}
                onClick={() => void createCustomerFromTill()}
              >
                Add &amp; attach to sale
              </button>
            </div>
            {customerFormMsg && <p className="hint">{customerFormMsg}</p>}
            {customers.length === 0 && <p style={{ color: "var(--muted)" }}>No customers yet — add one above.</p>}
            {customers.map((c) => (
              <button key={c.id} type="button" className="list-btn" onClick={() => void attachCustomer(c)}>
                <strong>{c.name}</strong>
                <div style={{ color: "var(--muted)" }}>
                  {c.phone ? `${c.phone} · ` : ""}
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

      {modal?.type === "kitchenSend" && ticket && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void sendToKitchen();
            }}
          >
            <h3>{sentBefore ? "Send the new items to the kitchen" : "Send to kitchen"}</h3>
            <ul className="kitchen-send-list">
              {unsentLines.map(({ line, quantity }) => (
                <li key={line.key}>
                  <strong>{quantity}×</strong> {line.name}
                  {line.modifiers.length > 0 && (
                    <ModifierList mods={line.modifiers} groups={groupsForLine(line)} />
                  )}
                </li>
              ))}
            </ul>
            <label className="field">
              <span>Name or table</span>
              <input
                autoFocus
                value={kitchenForm.name}
                placeholder="e.g. Table 4 or Sam"
                onChange={(e) => setKitchenForm({ ...kitchenForm, name: e.target.value })}
              />
            </label>
            <div className="seg" role="group" aria-label="Eat in or take away">
              {(["dine_in", "pickup"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={kitchenForm.fulfillment === f ? "active" : ""}
                  onClick={() => setKitchenForm({ ...kitchenForm, fulfillment: f })}
                >
                  {f === "dine_in" ? "Eat in" : "Take away"}
                </button>
              ))}
            </div>
            <label className="field">
              <span>Note for the kitchen</span>
              <input
                value={kitchenForm.note}
                placeholder="Allergies, timing…"
                onChange={(e) => setKitchenForm({ ...kitchenForm, note: e.target.value })}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
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
          suggestions={tipSuggestions}
          onClose={() => setModal(null)}
          onApply={(cents) => void applyTip(cents)}
        />
      )}

      {modal?.type === "board" && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h3>Open tickets · all tills</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              Live across the store. Tap any ticket to continue it on this till.
            </p>
            {board.length === 0 && (
              <p style={{ color: "var(--muted)" }}>No open or held tickets — tills are clear.</p>
            )}
            {board.map((t) => (
              <button
                key={t.id}
                type="button"
                className="list-btn"
                onClick={() => void adoptTicket(t.id)}
              >
                <strong>
                  {t.name} · {t.status}
                </strong>
                <div style={{ color: "var(--muted)" }}>
                  {t.registerName ? `${t.registerName} · ` : ""}
                  {t.source}
                  {t.kitchenStatus ? ` · kitchen ${t.kitchenStatus}` : ""} · {t.lineCount} lines
                  {t.customerName ? ` · ${t.customerName}` : ""}
                </div>
                <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                  {t.lines.map((l) => `${l.quantity}×${l.name}`).join(", ")}
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

      {modal?.type === "kitchen" && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head-row">
              <h3>Kitchen / delivery orders</h3>
              <a className="btn ghost" href={`${import.meta.env.BASE_URL}kitchen`} target="_blank" rel="noreferrer">
                Open kitchen screen
              </a>
            </div>
            {kitchenOrders.length === 0 && <p style={{ color: "var(--muted)" }}>Queue empty.</p>}
            {kitchenOrders.map((o) => (
              <div key={o.id} className="list-btn" style={{ cursor: "default" }}>
                <strong>
                  {o.orderNumber} · {o.customerName}
                </strong>
                <div style={{ color: "var(--muted)" }}>
                  {(o.channel && o.channel !== "web" ? o.channel : "web")}
                  {o.fulfillment ? ` · ${o.fulfillment}` : ""} · {o.status} · {money(o.totalCents)} ·{" "}
                  {o.lines.map((l) => `${l.quantity}×${l.name}`).join(", ")}
                </div>
                <button
                  type="button"
                  className="btn primary"
                  style={{ marginTop: 8 }}
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
                    }).then(() =>
                      api<KitchenOrder[]>("/kitchen/orders").then((k) => setKitchenOrders(k))
                    )
                  }
                >
                  Advance status
                </button>
              </div>
            ))}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setModal(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "receipt" && (
        <div className="modal-backdrop till-overlay" onClick={() => setModal(null)}>
          <div className="modal receipt-modal" onClick={(e) => e.stopPropagation()}>
            <p className="step-kicker">Step 4 · Done</p>
            <h3>Sale complete</h3>
            {modal.changeCents > 0 && <p className="change-due">Change due: {money(modal.changeCents)}</p>}
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              Billing receipt and kitchen ticket both include the modifiers from this sale.
            </p>
            <p className="step-kicker">Billing receipt</p>
            <pre className="receipt">{modal.text}</pre>
            {modal.kitchenText && (
              <>
                <p className="step-kicker">Kitchen ticket</p>
                <pre className="receipt">{modal.kitchenText}</pre>
              </>
            )}
            <div className="modal-actions">
              <button type="button" className="btn primary" onClick={() => setModal(null)}>
                New sale
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() =>
                  void reopenRecentSale({
                    id: modal.saleId,
                    receiptNumber: "this sale",
                    employeeName: "",
                    customerName: null,
                    totalCents: 0,
                    status: "completed",
                    createdAt: new Date().toISOString(),
                    lines: [],
                  })
                }
              >
                Open again on till
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() =>
                  void api("/printers/print-receipt", {
                    method: "POST",
                    body: JSON.stringify({ saleId: modal.saleId }),
                  }).catch((error) => fail("Billing receipt", error))
                }
              >
                Reprint billing
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() =>
                  void api<{ preview: string }>("/printers/print-kitchen", {
                    method: "POST",
                    body: JSON.stringify({ saleId: modal.saleId }),
                  })
                    .then((r) => setModal({ ...modal, kitchenText: r.preview }))
                    .catch((error) => fail("Kitchen ticket", error))
                }
              >
                Reprint kitchen
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  void fetch(`/api/sales/${modal.saleId}/receipt?format=html`, {
                    headers: { Authorization: `Bearer ${getToken()}` },
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
                className="btn ghost"
                onClick={() =>
                  void api<{ payload: { data: string; textPreview: string } }>(`/sales/${modal.saleId}/print`, {
                    method: "POST",
                    body: JSON.stringify({ format: "escpos-base64" }),
                  }).then((r) => {
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(new Blob([r.payload.data], { type: "text/plain" }));
                    a.download = `receipt.escpos.b64`;
                    a.click();
                  })
                }
              >
                ESC/POS
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
  suggestions,
  onClose,
  onApply,
}: {
  total: number;
  presets: number[];
  suggestions: { label: string; tipCents: number; percent: number | null }[];
  onClose: () => void;
  onApply: (cents: number) => void;
}) {
  const [custom, setCustom] = useState("");
  const buttons =
    suggestions.length > 0
      ? suggestions
      : [
          ...presets.map((p) => ({
            label: `${p}%`,
            tipCents: Math.round((total * p) / 100),
            percent: p,
          })),
          { label: "No tip", tipCents: 0, percent: 0 },
        ];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Tip suggestions</h3>
        <div className="pay-grid">
          {buttons.map((s) => (
            <button key={s.label} type="button" onClick={() => onApply(s.tipCents)}>
              {s.label}
              {s.tipCents ? ` (${money(s.tipCents)})` : ""}
            </button>
          ))}
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
