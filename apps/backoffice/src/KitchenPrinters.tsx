import { useEffect, useState } from "react";
import { api, money } from "./api";

export function KitchenPage() {
  const [orders, setOrders] = useState<
    {
      id: string;
      orderNumber: string;
      customerName: string;
      fulfillment: string;
      status: string;
      totalCents: number;
      note: string | null;
      lines: { name: string; quantity: number }[];
      createdAt: string;
    }[]
  >([]);

  async function load() {
    setOrders(await api("/kitchen/orders"));
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
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
    await load();
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Kitchen / online orders</h2>
          <p>Customer online orders become held tickets with kitchen status</p>
        </div>
        <button type="button" className="secondary" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Order</th>
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
                  {o.customerName}
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
                <td colSpan={6} style={{ color: "var(--muted)" }}>
                  No open online orders. Place one at the ordering app (port 5175).
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
              <th>Driver</th>
              <th>Endpoint</th>
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
