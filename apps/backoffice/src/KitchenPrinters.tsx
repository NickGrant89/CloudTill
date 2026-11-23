import { useEffect, useState } from "react";
import { api, money } from "./api";

type DeliveryChannelId = "justeat" | "deliveroo" | "ubereats" | "hungrypanda" | "foodhub" | "generic";

type DeliveryConfig = {
  store: { id: string; slug: string; name: string };
  enabledChannels: DeliveryChannelId[];
  channels: {
    id: DeliveryChannelId;
    label: string;
    enabled: boolean;
    webhookUrl: string;
    partnerRestaurantId: string;
    hasClientSecret: boolean;
  }[];
  normalizedIngestUrl: string;
  webhookSecretSet: boolean;
  credentialsNeeded: Record<string, string[]>;
};

export function KitchenPage() {
  const [orders, setOrders] = useState<
    {
      id: string;
      orderNumber: string;
      customerName: string;
      fulfillment: string;
      status: string;
      channel?: string;
      totalCents: number;
      note: string | null;
      deliveryAddress?: string | null;
      lines: { name: string; quantity: number }[];
      createdAt: string;
    }[]
  >([]);
  const [delivery, setDelivery] = useState<DeliveryConfig | null>(null);
  const [secretDraft, setSecretDraft] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [simChannel, setSimChannel] = useState<DeliveryChannelId>("deliveroo");

  async function loadOrders() {
    setOrders(await api("/kitchen/orders"));
  }

  async function loadDelivery() {
    try {
      setDelivery(await api<DeliveryConfig>("/delivery/config"));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not load delivery config");
    }
  }

  useEffect(() => {
    void loadOrders();
    void loadDelivery();
    const t = setInterval(() => void loadOrders(), 8000);
    return () => clearInterval(t);
  }, []);

  async function advance(id: string, status: string) {
    const next =
      status === "pending" || status === "accepted"
        ? "preparing"
        : status === "preparing"
          ? "ready"
          : "completed";
    await api(`/kitchen/orders/${id}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
    await loadOrders();
  }

  function channelLabel(channel?: string) {
    if (!channel || channel === "web") return "Web";
    const hit = delivery?.channels.find((c) => c.id === channel);
    return hit?.label ?? channel;
  }

  async function saveDelivery(partial: {
    enabledChannels?: DeliveryChannelId[];
    webhookSecret?: string | null;
    restaurantIds?: Record<string, string>;
    clientSecrets?: Record<string, string>;
  }) {
    setBusy(true);
    setMsg("");
    try {
      await api("/delivery/config", { method: "PUT", body: JSON.stringify(partial) });
      setSecretDraft("");
      await loadDelivery();
      setMsg("Delivery settings saved");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function simulate() {
    setBusy(true);
    setMsg("");
    try {
      const r = await api<{ message: string; order: { orderNumber: string } }>("/delivery/simulate", {
        method: "POST",
        body: JSON.stringify({ channel: simChannel }),
      });
      setMsg(r.message + ` · ${r.order.orderNumber}`);
      await loadOrders();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Simulate failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Kitchen / online orders</h2>
          <p>Web ordering and UK delivery apps (Just Eat, Deliveroo, Uber Eats, HungryPanda, Foodhub) land here</p>
        </div>
        <button type="button" className="secondary" onClick={() => void loadOrders()}>
          Refresh
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Channel</th>
              <th>Customer</th>
              <th>Items</th>
              <th>Total</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>
                  <strong>{o.orderNumber}</strong>
                  <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                    {o.fulfillment} · {new Date(o.createdAt).toLocaleTimeString()}
                  </div>
                </td>
                <td>
                  <span className="badge">{channelLabel(o.channel)}</span>
                </td>
                <td>
                  {o.customerName}
                  {o.deliveryAddress ? (
                    <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{o.deliveryAddress}</div>
                  ) : null}
                  {o.note ? <div style={{ color: "var(--muted)" }}>{o.note}</div> : null}
                </td>
                <td>{o.lines.map((l) => `${l.quantity}× ${l.name}`).join(", ")}</td>
                <td>{money(o.totalCents)}</td>
                <td>
                  <span className="badge warn">{o.status}</span>
                </td>
                <td>
                  <button type="button" onClick={() => void advance(o.id, o.status)}>
                    Advance
                  </button>
                </td>
              </tr>
            ))}
            {!orders.length && (
              <tr>
                <td colSpan={7} style={{ color: "var(--muted)" }}>
                  No open kitchen orders. Place a web order, or simulate a delivery app below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="panel-box" style={{ marginTop: 18 }}>
        <h3>UK delivery apps</h3>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          Tick the apps you use, then give each app (or your Deliverect account) its order link below and your
          shared password. Their orders then appear on the till and kitchen screen. Use <strong>Send test order</strong>{" "}
          to try it before you go live.
        </p>

        {delivery && (
          <>
            <div className="field" style={{ maxWidth: 420 }}>
              <label>Shared password for delivery apps</label>
              <input
                type="password"
                placeholder={delivery.webhookSecretSet ? "•••••••• (saved, type a new one to replace it)" : "At least 8 characters"}
                value={secretDraft}
                onChange={(e) => setSecretDraft(e.target.value)}
              />
            </div>
            <div className="toolbar" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className="secondary"
                disabled={busy || secretDraft.trim().length < 8}
                onClick={() => void saveDelivery({ webhookSecret: secretDraft.trim() })}
              >
                Save password
              </button>
              {delivery.webhookSecretSet && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (!confirm("Remove the delivery app password? Orders from the apps will stop until you set a new one.")) return;
                    void saveDelivery({ webhookSecret: null });
                  }}
                >
                  Remove password
                </button>
              )}
            </div>

            <div className="table-wrap" style={{ marginBottom: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>App</th>
                    <th>On</th>
                    <th>Order link to give the app</th>
                    <th>Your store ID on the app</th>
                  </tr>
                </thead>
                <tbody>
                  {delivery.channels.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.label}</strong>
                        {c.hasClientSecret ? (
                          <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Connected</div>
                        ) : null}
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={c.enabled}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? Array.from(new Set([...delivery.enabledChannels, c.id]))
                              : delivery.enabledChannels.filter((id) => id !== c.id);
                            void saveDelivery({ enabledChannels: next });
                          }}
                        />
                      </td>
                      <td style={{ fontSize: "0.78rem", wordBreak: "break-all" }}>
                        <code>{c.webhookUrl}</code>
                      </td>
                      <td>
                        <input
                          defaultValue={c.partnerRestaurantId}
                          placeholder="Site / Shop ID"
                          style={{ minWidth: 120 }}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v === (c.partnerRestaurantId || "")) return;
                            void saveDelivery({ restaurantIds: { [c.id]: v } });
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p style={{ fontSize: "0.88rem", color: "var(--muted)" }}>
              Link for Deliverect or other order hubs: <code>{delivery.normalizedIngestUrl}</code>
            </p>

            <div className="toolbar" style={{ marginTop: 10 }}>
              <select value={simChannel} onChange={(e) => setSimChannel(e.target.value as DeliveryChannelId)}>
                {delivery.channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <button type="button" disabled={busy} onClick={() => void simulate()}>
                {busy ? "Working…" : "Send test order"}
              </button>
            </div>
          </>
        )}
        {msg && (
          <p className="badge" style={{ marginTop: 10 }}>
            {msg}
          </p>
        )}
      </div>
    </div>
  );
}

export function PrintersPage() {
  const [printers, setPrinters] = useState<
    { id: string; name: string; driver: string; host: string | null; port: number | null; isDefault: boolean; enabled: boolean }[]
  >([]);
  const [jobs, setJobs] = useState<
    { id: string; type: string; status: string; preview: string | null; error: string | null; createdAt: string; printer: { name: string } | null }[]
  >([]);
  const [mockLog, setMockLog] = useState<{ at: string; bytes: number; type?: string; hexPreview: string }[]>([]);
  const [form, setForm] = useState({ name: "New printer", driver: "mock", host: "127.0.0.1", port: "9100" });

  async function load() {
    const [p, j, m] = await Promise.all([
      api<typeof printers>("/printers"),
      api<typeof jobs>("/printers/jobs"),
      api<{ jobs: typeof mockLog }>("/printers/mock/log"),
    ]);
    setPrinters(p);
    setJobs(j);
    setMockLog(m.jobs);
  }

  useEffect(() => {
    void load();
  }, []);

  async function addPrinter(e: React.FormEvent) {
    e.preventDefault();
    await api("/printers", {
      method: "POST",
      body: JSON.stringify({
        name: form.name,
        driver: form.driver,
        host: form.driver === "network" ? form.host : undefined,
        port: form.driver === "network" ? parseInt(form.port, 10) : undefined,
      }),
    });
    await load();
  }

  async function processQueue() {
    await api("/printers/process-queue", { method: "POST", body: "{}" });
    await load();
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Printers</h2>
          <p>Integration layer: mock · network ESC/POS · USB bridge · job queue</p>
        </div>
        <button type="button" onClick={() => void processQueue()}>
          Process queue
        </button>
      </div>

      <form className="panel-box" onSubmit={(e) => void addPrinter(e)}>
        <h3>Add printer</h3>
        <div className="grid-2">
          <div className="field">
            <label>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Driver</label>
            <select value={form.driver} onChange={(e) => setForm({ ...form, driver: e.target.value })}>
              <option value="mock">Mock (demo)</option>
              <option value="network">Network TCP :9100</option>
              <option value="usb_bridge">USB bridge agent</option>
            </select>
          </div>
          {form.driver === "network" && (
            <>
              <div className="field">
                <label>Host</label>
                <input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
              </div>
              <div className="field">
                <label>Port</label>
                <input value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
              </div>
            </>
          )}
        </div>
        <button type="submit">Save</button>
      </form>

      <div className="table-wrap" style={{ marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Connection</th>
              <th>Address</th>
              <th>Default</th>
            </tr>
          </thead>
          <tbody>
            {printers.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.driver}</td>
                <td>{p.driver === "network" ? `${p.host}:${p.port}` : "—"}</td>
                <td>{p.isDefault ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid-2">
        <div className="panel-box">
          <h3>Print jobs</h3>
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Status</th>
                <th>Printer</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {jobs.slice(0, 15).map((j) => (
                <tr key={j.id}>
                  <td>{j.type}</td>
                  <td>
                    <span className={`badge ${j.status === "failed" ? "danger" : j.status === "queued" ? "warn" : ""}`}>
                      {j.status}
                    </span>
                  </td>
                  <td>{j.printer?.name ?? "mock"}</td>
                  <td>{new Date(j.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel-box">
          <h3>Mock driver log</h3>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.85rem", margin: 0 }}>
            {mockLog.length
              ? mockLog
                  .slice()
                  .reverse()
                  .slice(0, 12)
                  .map((j) => `${j.at} · ${j.type ?? "print"} · ${j.bytes}b · ${j.hexPreview}`)
                  .join("\n")
              : "No mock prints yet."}
          </pre>
        </div>
      </div>
    </div>
  );
}
