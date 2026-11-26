import { displayModifierGroupLabel, groupModifierLines } from "@cloudtill/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getToken } from "./api";
import type { SessionStore, SessionUser } from "./App";
import "./kitchen.css";

interface KitchenLine {
  id: string;
  name: string;
  quantity: number;
  modifiersJson: string;
  note: string | null;
}

interface KitchenOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  status: string;
  channel: string;
  fulfillment: string;
  note: string | null;
  deliveryAddress: string | null;
  createdAt: string;
  updatedAt: string;
  lines: KitchenLine[];
}

interface OrderingSettings {
  prepMinutes: number;
  pausedUntil: string;
  paused: boolean;
}

interface KitchenItem {
  id: string;
  name: string;
  soldOut: boolean;
  category: { name: string } | null;
}

type Column = "new" | "making" | "ready";

const COLUMNS: { id: Column; title: string; empty: string }[] = [
  { id: "new", title: "New", empty: "No new orders" },
  { id: "making", title: "Making", empty: "Nothing on the go" },
  { id: "ready", title: "Ready", empty: "Nothing waiting" },
];

const CHANNEL_LABEL: Record<string, string> = {
  web: "Online",
  till: "Till",
  justeat: "Just Eat",
  deliveroo: "Deliveroo",
  ubereats: "Uber Eats",
  hungrypanda: "HungryPanda",
  foodhub: "Foodhub",
  generic: "Delivery app",
};

const DONE_KEY = "purepos.kitchen.done-lines";

function columnOf(status: string): Column {
  if (status === "preparing") return "making";
  if (status === "ready") return "ready";
  return "new";
}

function nextStatus(status: string) {
  if (status === "pending" || status === "accepted") return "preparing";
  if (status === "preparing") return "ready";
  return "completed";
}

function prevStatus(status: string) {
  if (status === "ready") return "preparing";
  if (status === "preparing") return "pending";
  return null;
}

function fulfillmentLabel(f: string) {
  if (f === "delivery") return "Delivery";
  if (f === "dine_in") return "Eat in";
  return "Collect";
}

function actionLabel(order: KitchenOrder) {
  if (order.status === "preparing") return "Ready";
  if (order.status === "ready") return order.fulfillment === "delivery" ? "Sent out" : "Collected";
  return "Start";
}

function parseMods(json: string) {
  try {
    return (JSON.parse(json) as { name?: string; groupName?: string }[])
      .filter((mod) => mod.name)
      .map((mod) => ({ name: mod.name as string, groupName: mod.groupName }));
  } catch {
    return [];
  }
}

function elapsed(fromIso: string, nowMs: number) {
  const secs = Math.max(0, Math.floor((nowMs - Date.parse(fromIso)) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return { minutes: m, label: m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${String(s).padStart(2, "0")}` };
}

function clock(ms: number) {
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** Two-tone chime; needs a tap first because browsers block sound until the page is touched. */
function chime(ctx: AudioContext | null) {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const [i, freq] of [880, 1175].entries()) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.0001, t + i * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.35, t + i * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t + i * 0.18);
    osc.stop(t + i * 0.18 + 0.55);
  }
}

function loadDone(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(DONE_KEY) || "{}") as Record<string, string[]>;
  } catch {
    return {};
  }
}

export function KitchenScreen({
  user,
  store,
  onLogout,
}: {
  user: SessionUser;
  store: SessionStore;
  onLogout: () => void;
}) {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [recent, setRecent] = useState<KitchenOrder[]>([]);
  const [settings, setSettings] = useState<OrderingSettings | null>(null);
  const [items, setItems] = useState<KitchenItem[]>([]);
  const [drawer, setDrawer] = useState<null | "pause" | "soldout" | "recent">(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [skewMs, setSkewMs] = useState(0);
  const [started, setStarted] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Record<string, string[]>>(loadDone);
  const [mobileCol, setMobileCol] = useState<Column>("new");
  const [busyId, setBusyId] = useState("");
  const [itemQuery, setItemQuery] = useState("");
  const seen = useRef<Set<string> | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/kitchen/orders", { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      if (res.status === 401) return onLogout();
      if (!res.ok) throw new Error("Could not load orders");
      const serverTime = res.headers.get("X-Server-Time");
      if (serverTime) setSkewMs(Date.parse(serverTime) - Date.now());
      const list = (await res.json()) as KitchenOrder[];
      setOrders(list);
      setOffline(false);
      const ids = new Set(list.map((o) => o.id));
      if (seen.current) {
        const arrived = list.filter((o) => !seen.current!.has(o.id) && columnOf(o.status) === "new");
        if (arrived.length) {
          if (soundRef.current) chime(audio.current);
          setFresh((prev) => new Set([...prev, ...arrived.map((o) => o.id)]));
          window.setTimeout(
            () => setFresh((prev) => new Set([...prev].filter((id) => !arrived.some((o) => o.id === id)))),
            12000
          );
        }
      }
      seen.current = ids;
    } catch {
      setOffline(true);
    }
  }, [onLogout]);

  const loadSettings = useCallback(async () => {
    try {
      setSettings(await api<OrderingSettings>("/kitchen/settings"));
    } catch {
      /* keep last */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadSettings();
    const poll = window.setInterval(() => void load(), 4000);
    const slow = window.setInterval(() => void loadSettings(), 30000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(slow);
      window.clearInterval(tick);
    };
  }, [load, loadSettings]);

  useEffect(() => {
    const live = new Set(orders.map((o) => o.id));
    const pruned = Object.fromEntries(Object.entries(done).filter(([id]) => live.has(id)));
    localStorage.setItem(DONE_KEY, JSON.stringify(pruned));
  }, [done, orders]);

  useEffect(() => {
    if (!started) return;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    async function lock() {
      try {
        wakeLock.current = (await nav.wakeLock?.request("screen")) ?? null;
      } catch {
        /* unsupported or denied */
      }
    }
    void lock();
    const onVisible = () => document.visibilityState === "visible" && void lock();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void wakeLock.current?.release().catch(() => undefined);
    };
  }, [started]);

  function start() {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audio.current = new Ctx();
      chime(audio.current);
    } catch {
      audio.current = null;
    }
    setStarted(true);
  }

  async function move(order: KitchenOrder, status: string) {
    setBusyId(order.id);
    setError("");
    try {
      await api(`/kitchen/orders/${order.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setOrders((prev) =>
        status === "completed" || status === "cancelled"
          ? prev.filter((o) => o.id !== order.id)
          : prev.map((o) => (o.id === order.id ? { ...o, status, updatedAt: new Date().toISOString() } : o))
      );
      setFresh((prev) => new Set([...prev].filter((id) => id !== order.id)));
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the order");
    } finally {
      setBusyId("");
    }
  }

  function toggleLine(orderId: string, lineId: string) {
    setDone((prev) => {
      const current = new Set(prev[orderId] ?? []);
      if (current.has(lineId)) current.delete(lineId);
      else current.add(lineId);
      return { ...prev, [orderId]: [...current] };
    });
  }

  async function saveSettings(patch: Partial<OrderingSettings>) {
    setError("");
    try {
      setSettings(await api<OrderingSettings>("/kitchen/settings", { method: "PATCH", body: JSON.stringify(patch) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    }
  }

  async function openSoldOut() {
    setDrawer("soldout");
    setItemQuery("");
    try {
      setItems(await api<KitchenItem[]>("/kitchen/items"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load items");
    }
  }

  async function setSoldOut(item: KitchenItem, soldOut: boolean) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, soldOut } : i)));
    try {
      await api(`/kitchen/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ soldOut }) });
    } catch (e) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, soldOut: !soldOut } : i)));
      setError(e instanceof Error ? e.message : "Could not update item");
    }
  }

  async function openRecent() {
    setDrawer("recent");
    try {
      setRecent(await api<KitchenOrder[]>("/kitchen/orders?recent=1"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load recent orders");
    }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }

  const serverNow = now + skewMs;
  const prep = settings?.prepMinutes ?? 15;
  const grouped = useMemo(() => {
    const g: Record<Column, KitchenOrder[]> = { new: [], making: [], ready: [] };
    for (const o of orders) g[columnOf(o.status)].push(o);
    return g;
  }, [orders]);
  const soldOutCount = items.filter((i) => i.soldOut).length;
  const pausedLabel = settings?.paused
    ? settings.pausedUntil === "off"
      ? "Online orders paused"
      : `Online orders paused until ${clock(Date.parse(settings.pausedUntil))}`
    : "";
  const tillHref = `${import.meta.env.BASE_URL}`;

  if (!started) {
    return (
      <div className="kds kds-start">
        <div className="kds-start-card">
          <p className="kds-eyebrow">{store.name}</p>
          <h1>Kitchen screen</h1>
          <p>
            New orders from the till, your website and delivery apps appear here and chime. Tap a button to move each
            order along. The screen stays on while this page is open.
          </p>
          <button type="button" className="kds-primary big" onClick={start}>
            Start kitchen screen
          </button>
          <p className="kds-muted">
            Signed in as {user.name}. <a href={tillHref}>Back to the till</a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="kds">
      <header className="kds-bar">
        <div className="kds-title">
          <strong>{store.name}</strong>
          <span className="kds-clock">{clock(serverNow)}</span>
        </div>
        <div className="kds-counts" role="tablist" aria-label="Columns">
          {COLUMNS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={mobileCol === c.id}
              className={`kds-count kds-count-${c.id}${mobileCol === c.id ? " active" : ""}`}
              onClick={() => setMobileCol(c.id)}
            >
              {c.title} <b>{grouped[c.id].length}</b>
            </button>
          ))}
        </div>
        <div className="kds-tools">
          <button
            type="button"
            className={settings?.paused ? "kds-warn" : ""}
            onClick={() => setDrawer(drawer === "pause" ? null : "pause")}
          >
            {settings?.paused ? "Paused" : `Prep ${prep} min`}
          </button>
          <button type="button" onClick={() => void (drawer === "soldout" ? setDrawer(null) : openSoldOut())}>
            Sold out{soldOutCount ? ` · ${soldOutCount}` : ""}
          </button>
          <button type="button" onClick={() => void (drawer === "recent" ? setDrawer(null) : openRecent())}>
            Done
          </button>
          <button type="button" aria-pressed={soundOn} onClick={() => setSoundOn((v) => !v)}>
            {soundOn ? "Sound on" : "Sound off"}
          </button>
          <button type="button" className="kds-hide-sm" onClick={toggleFullscreen}>
            Full screen
          </button>
          <a className="kds-link" href={tillHref}>
            Till
          </a>
        </div>
      </header>

      {(offline || pausedLabel || error) && (
        <div className="kds-banners">
          {offline && <p className="kds-banner danger">Connection lost. Trying again… orders may be out of date.</p>}
          {pausedLabel && (
            <p className="kds-banner warn">
              {pausedLabel}. Customers can't order online.
              <button type="button" onClick={() => void saveSettings({ pausedUntil: "" })}>
                Resume now
              </button>
            </p>
          )}
          {error && (
            <p className="kds-banner danger">
              {error}
              <button type="button" onClick={() => setError("")}>
                Dismiss
              </button>
            </p>
          )}
        </div>
      )}

      {drawer && (
        <aside className="kds-drawer" aria-label="Kitchen options">
          {drawer === "pause" && settings && (
            <>
              <h2>Busy?</h2>
              <p className="kds-muted">Customers see this wait time online. Pausing stops new online orders; the till is not affected.</p>
              <div className="kds-stepper">
                <button type="button" aria-label="Less prep time" onClick={() => void saveSettings({ prepMinutes: Math.max(5, prep - 5) })}>
                  −5
                </button>
                <span>
                  <b>{prep}</b> min prep
                </span>
                <button type="button" aria-label="More prep time" onClick={() => void saveSettings({ prepMinutes: Math.min(120, prep + 5) })}>
                  +5
                </button>
              </div>
              <div className="kds-pause-row">
                {[15, 30, 60].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => void saveSettings({ pausedUntil: new Date(serverNow + m * 60000).toISOString() })}
                  >
                    Pause {m} min
                  </button>
                ))}
                <button type="button" onClick={() => void saveSettings({ pausedUntil: "off" })}>
                  Pause until I resume
                </button>
                {settings.paused && (
                  <button type="button" className="kds-primary" onClick={() => void saveSettings({ pausedUntil: "" })}>
                    Resume online orders
                  </button>
                )}
              </div>
            </>
          )}
          {drawer === "soldout" && (
            <>
              <h2>Sold out</h2>
              <p className="kds-muted">Sold-out items can't be ordered online until you switch them back on.</p>
              <input
                className="kds-search"
                type="search"
                placeholder="Find an item"
                value={itemQuery}
                onChange={(e) => setItemQuery(e.target.value)}
              />
              <ul className="kds-items">
                {items
                  .filter((i) => i.name.toLowerCase().includes(itemQuery.trim().toLowerCase()))
                  .map((i) => (
                    <li key={i.id}>
                      <span>
                        {i.name}
                        {i.category && <small>{i.category.name}</small>}
                      </span>
                      <button
                        type="button"
                        className={i.soldOut ? "kds-warn" : ""}
                        aria-pressed={i.soldOut}
                        onClick={() => void setSoldOut(i, !i.soldOut)}
                      >
                        {i.soldOut ? "Sold out" : "Available"}
                      </button>
                    </li>
                  ))}
              </ul>
            </>
          )}
          {drawer === "recent" && (
            <>
              <h2>Done in the last 3 hours</h2>
              {recent.length === 0 && <p className="kds-muted">Nothing finished yet.</p>}
              <ul className="kds-items">
                {recent.map((o) => (
                  <li key={o.id}>
                    <span>
                      {o.orderNumber} · {o.customerName}
                      <small>
                        {o.status === "cancelled" ? "Cancelled" : "Done"} at {clock(Date.parse(o.updatedAt))}
                      </small>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void move(o, "ready").then(() => setRecent((prev) => prev.filter((r) => r.id !== o.id)))
                      }
                    >
                      Bring back
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <button type="button" className="kds-close" onClick={() => setDrawer(null)}>
            Close
          </button>
        </aside>
      )}

      <main className="kds-board">
        {COLUMNS.map((col) => (
          <section key={col.id} className={`kds-col kds-col-${col.id}${mobileCol === col.id ? " is-current" : ""}`}>
            <h2>
              {col.title} <span>{grouped[col.id].length}</span>
            </h2>
            {grouped[col.id].length === 0 && <p className="kds-empty">{col.empty}</p>}
            {grouped[col.id].map((o) => {
              const age = elapsed(o.createdAt, serverNow);
              const late = col.id !== "ready" && age.minutes >= prep + 10;
              const due = col.id !== "ready" && !late && age.minutes >= prep;
              const struck = new Set(done[o.id] ?? []);
              const back = prevStatus(o.status);
              return (
                <article
                  key={o.id}
                  className={`kds-card${fresh.has(o.id) ? " is-new" : ""}${late ? " is-late" : due ? " is-due" : ""}`}
                >
                  <header>
                    <div>
                      <strong className="kds-num">{o.orderNumber}</strong>
                      <span className="kds-name">{o.customerName}</span>
                    </div>
                    <span className="kds-age" title={`Ordered at ${clock(Date.parse(o.createdAt))}`}>
                      {age.label}
                    </span>
                  </header>
                  <div className="kds-tags">
                    <span className={`kds-tag ch-${o.channel}`}>{CHANNEL_LABEL[o.channel] ?? o.channel}</span>
                    <span className={`kds-tag f-${o.fulfillment}`}>{fulfillmentLabel(o.fulfillment)}</span>
                  </div>
                  {o.note && <p className="kds-note">{o.note}</p>}
                  <ul className="kds-lines">
                    {o.lines.map((l) => {
                      const mods = parseMods(l.modifiersJson);
                      return (
                        <li key={l.id}>
                          <button
                            type="button"
                            className={struck.has(l.id) ? "is-done" : ""}
                            aria-pressed={struck.has(l.id)}
                            onClick={() => toggleLine(o.id, l.id)}
                          >
                            <b>{l.quantity}×</b>
                            <span>
                              {l.name}
                              {mods.length > 0 && (
                                <span className="kds-mods">
                                  {groupModifierLines(mods).map((block, index) => (
                                    <span key={`${block.groupName ?? "mods"}-${index}`}>
                                      {block.groupName && (
                                        <span className="kds-mod-group">
                                          {displayModifierGroupLabel(l.name, block.groupName) ?? block.groupName}
                                        </span>
                                      )}
                                      {block.names.map((name, nameIndex) => (
                                        <span key={`${name}-${nameIndex}`} className="kds-mod-name">
                                          {name}
                                        </span>
                                      ))}
                                    </span>
                                  ))}
                                </span>
                              )}
                              {l.note && <em>{l.note}</em>}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {o.fulfillment === "delivery" && o.deliveryAddress && <p className="kds-addr">{o.deliveryAddress}</p>}
                  <footer>
                    {back && (
                      <button type="button" className="kds-ghost" disabled={busyId === o.id} onClick={() => void move(o, back)}>
                        Back
                      </button>
                    )}
                    {col.id === "new" && (
                      <button
                        type="button"
                        className="kds-ghost"
                        disabled={busyId === o.id}
                        onClick={() => {
                          if (confirm(`Cancel ${o.orderNumber} for ${o.customerName}? Online orders are not refunded automatically.`)) {
                            void move(o, "cancelled");
                          }
                        }}
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="button"
                      className={`kds-primary${col.id === "ready" ? " done" : ""}`}
                      disabled={busyId === o.id}
                      onClick={() => void move(o, nextStatus(o.status))}
                    >
                      {actionLabel(o)}
                    </button>
                  </footer>
                </article>
              );
            })}
          </section>
        ))}
      </main>
    </div>
  );
}
