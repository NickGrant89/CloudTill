import { useEffect, useState } from "react";
import { api, getToken, money } from "./api";

export function StocktakePage() {
  const [rows, setRows] = useState<
    { variantId: string; itemName: string; sku: string; systemQty: number; countedQty: string }[]
  >([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void api<
      { variantId: string; itemName: string; sku: string; systemQty: number }[]
    >("/extras/stocktake").then((list) =>
      setRows(list.map((r) => ({ ...r, countedQty: String(r.systemQty) })))
    );
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = await api<{ results: { variance: number }[] }>("/extras/stocktake", {
      method: "POST",
      body: JSON.stringify({
        note: "BO stocktake",
        counts: rows.map((r) => ({
          variantId: r.variantId,
          countedQty: parseFloat(r.countedQty || "0"),
        })),
      }),
    });
    setMsg(`Saved ${result.results.length} counts`);
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Stocktake</h2>
          <p>Count on-hand qty · variances write inventory adjustments</p>
        </div>
      </div>
      {msg && <p className="badge">{msg}</p>}
      <form onSubmit={(e) => void submit(e)}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>SKU</th>
                <th>System</th>
                <th>Counted</th>
                <th>Variance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const counted = parseFloat(r.countedQty || "0");
                const variance = counted - r.systemQty;
                return (
                  <tr key={r.variantId}>
                    <td>{r.itemName}</td>
                    <td>{r.sku}</td>
                    <td>{r.systemQty}</td>
                    <td>
                      <input
                        style={{ width: 90 }}
                        value={r.countedQty}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((x) =>
                              x.variantId === r.variantId ? { ...x, countedQty: e.target.value } : x
                            )
                          )
                        }
                      />
                    </td>
                    <td style={{ color: variance === 0 ? "var(--muted)" : variance < 0 ? "var(--danger)" : "var(--accent)" }}>
                      {variance}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button type="submit" style={{ marginTop: 12 }}>
          Post stocktake
        </button>
      </form>
    </div>
  );
}

export function LabelsPage() {
  const [items, setItems] = useState<
    { id: string; name: string; variants: { id: string; sku: string; barcode: string | null; priceCents: number }[] }[]
  >([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState("");

  useEffect(() => {
    void api<typeof items>("/catalog/items").then(setItems);
  }, []);

  async function generate() {
    const variantIds = selected.length
      ? selected
      : items.slice(0, 6).map((i) => i.variants[0]?.id).filter(Boolean);
    const data = await api<{ html: string; count: number }>("/extras/labels", {
      method: "POST",
      body: JSON.stringify({ variantIds, copies: 1 }),
    });
    setPreview(data.html);
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(data.html);
      w.document.close();
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Barcode labels</h2>
          <p>Print-friendly shelf labels (name, price, barcode/SKU)</p>
        </div>
        <button type="button" onClick={() => void generate()}>
          Print labels
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Item</th>
              <th>SKU</th>
              <th>Barcode</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const v = item.variants[0];
              if (!v) return null;
              return (
                <tr key={item.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.includes(v.id)}
                      onChange={(e) =>
                        setSelected((prev) =>
                          e.target.checked ? [...prev, v.id] : prev.filter((id) => id !== v.id)
                        )
                      }
                    />
                  </td>
                  <td>{item.name}</td>
                  <td>{v.sku}</td>
                  <td>{v.barcode ?? "—"}</td>
                  <td>{money(v.priceCents)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {preview && <p style={{ color: "var(--muted)" }}>Label HTML opened in a new tab.</p>}
    </div>
  );
}

export function EodPage() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [emailResult, setEmailResult] = useState("");

  function downloadCsv() {
    const token = getToken();
    void fetch(`/api/extras/eod.csv?date=${date}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.text())
      .then((csv) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
        a.download = `eod-${date}.csv`;
        a.click();
      });
  }

  async function sendEmail() {
    const r = await api<{ to: string; subject: string; provider: string }>("/extras/eod-email", {
      method: "POST",
      body: JSON.stringify({ date, to: "owner@cloudtill.demo" }),
    });
    setEmailResult(`Queued stub email → ${r.to}: ${r.subject} (${r.provider})`);
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>End of day</h2>
          <p>CSV export + stub email for daily close</p>
        </div>
      </div>
      <div className="panel-box">
        <div className="field">
          <label>Date (UTC)</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="toolbar">
          <button type="button" onClick={downloadCsv}>
            Download CSV
          </button>
          <button type="button" className="secondary" onClick={() => void sendEmail()}>
            Email EOD (stub)
          </button>
        </div>
        {emailResult && <p>{emailResult}</p>}
      </div>
    </div>
  );
}

export function LowStockToast({ onOpenInventory }: { onOpenInventory?: () => void }) {
  const [alert, setAlert] = useState<{ count: number; pushStub: { title: string; body: string } } | null>(
    null
  );
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    void api<{ count: number; pushStub: { title: string; body: string } }>("/extras/low-stock-alerts").then(
      setAlert
    );
  }, []);

  if (!alert?.count || dismissed) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: "max(16px, env(safe-area-inset-right, 0px))",
        bottom: "max(16px, env(safe-area-inset-bottom, 0px))",
        zIndex: 35,
        maxWidth: "min(340px, calc(100vw - 32px))",
        background: "#1a2420",
        color: "#f4f0e8",
        padding: "14px 16px",
        borderRadius: 14,
        boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
      }}
    >
      <strong>{alert.pushStub.title}</strong>
      <p style={{ margin: "6px 0 10px", opacity: 0.85, fontSize: "0.9rem" }}>{alert.pushStub.body}</p>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={() => onOpenInventory?.()}>
          Inventory
        </button>
        <button type="button" className="secondary" onClick={() => setDismissed(true)}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
