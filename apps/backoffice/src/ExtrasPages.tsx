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

type EodSummary = {
  date: string;
  receipts: number;
  voided: number;
  refunded: number;
  grossCents: number;
  taxCents: number;
  tipCents: number;
  discountCents: number;
  payments: { name: string; amountCents: number }[];
};

export function EodPage() {
  const [date, setDate] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }));
  const [summary, setSummary] = useState<EodSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    api<EodSummary>(`/extras/eod-summary?date=${date}`)
      .then(setSummary)
      .catch((e) => {
        setSummary(null);
        setError(e instanceof Error ? e.message : "Could not load the day");
      });
  }, [date]);

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

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>End of day</h2>
          <p>Takings for one day, by payment type · download every receipt as a spreadsheet</p>
        </div>
      </div>
      <div className="panel-box">
        <div className="toolbar" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="eod-date">Day</label>
            <input id="eod-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <button type="button" onClick={downloadCsv}>
            Download CSV
          </button>
          <button type="button" className="secondary" onClick={() => window.print()}>
            Print
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {summary && (
          <>
            <div className="cards" style={{ marginTop: 16 }}>
              <div className="stat">
                <div className="label">Takings</div>
                <div className="value">{money(summary.grossCents)}</div>
              </div>
              <div className="stat">
                <div className="label">Receipts</div>
                <div className="value">{summary.receipts}</div>
              </div>
              <div className="stat">
                <div className="label">VAT</div>
                <div className="value">{money(summary.taxCents)}</div>
              </div>
              <div className="stat">
                <div className="label">Tips</div>
                <div className="value">{money(summary.tipCents)}</div>
              </div>
            </div>
            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th>Payment type</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.payments.length ? (
                    summary.payments.map((p) => (
                      <tr key={p.name}>
                        <td>{p.name}</td>
                        <td>{money(p.amountCents)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={2}>No sales on this day</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
              Discounts given {money(summary.discountCents)} · {summary.refunded} refunded · {summary.voided} voided
              (not counted in takings)
            </p>
          </>
        )}
      </div>
    </div>
  );
}

type ImportKind = "items" | "customers" | "stock" | "loyverse";

type PreviewRow = {
  line: number;
  action: "create" | "update" | "skip" | "error";
  summary: string;
  issues: { level: "error" | "warning"; message: string }[];
};

type PreviewResult = {
  kind: ImportKind;
  notes: string;
  total: number;
  valid: number;
  errors: number;
  rows: PreviewRow[];
};

const IMPORT_KINDS: { id: ImportKind; label: string; blurb: string }[] = [
  {
    id: "loyverse",
    label: "Loyverse",
    blurb:
      "Item list or customer export from Loyverse Back Office. Items, categories, stock, barcodes, and options come in. Modifier prices, images, and receipts are not in the Loyverse file.",
  },
  { id: "items", label: "Items", blurb: "Name, group, SKU, price, stock" },
  { id: "customers", label: "Customers", blurb: "Name, email, phone, credit, loyalty" },
  { id: "stock", label: "Stock levels", blurb: "Set or receive qty by SKU / barcode" },
];

export function ImportPage() {
  const [kind, setKind] = useState<ImportKind>("items");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function downloadTemplate() {
    const token = getToken();
    void fetch(`/api/import/templates/${kind}.csv`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("Template download failed");
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `purepos-${kind}-template.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Download failed"));
  }

  async function onFile(file: File | null) {
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    setPreview(null);
    setMessage("");
    setError("");
  }

  async function runPreview() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api<PreviewResult>("/import/preview", {
        method: "POST",
        body: JSON.stringify({ kind, csv }),
      });
      setPreview(result);
      setMessage(
        result.errors
          ? `${result.valid} ready · ${result.errors} row error(s) to fix`
          : `${result.valid} row(s) ready to import`
      );
    } catch (e) {
      setPreview(null);
      const message = e instanceof Error ? e.message : "Preview failed";
      setError(
        /Shop or Group|csv_import|402/i.test(message)
          ? `${message} Open Settings → Billing to upgrade.`
          : message
      );
    } finally {
      setBusy(false);
    }
  }

  async function runApply() {
    if (!preview || preview.errors > 0) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{
        created?: number;
        updated?: number;
        categoriesCreated?: number;
        modifiersLinked?: number;
        componentsLinked?: number;
      }>("/import/apply", {
        method: "POST",
        body: JSON.stringify({ kind, csv }),
      });
      const bits = [
        result.created != null ? `${result.created} created` : null,
        result.updated != null ? `${result.updated} updated` : null,
        result.categoriesCreated ? `${result.categoriesCreated} categories created` : null,
        result.modifiersLinked ? `${result.modifiersLinked} modifiers linked` : null,
        result.componentsLinked ? `${result.componentsLinked} components linked` : null,
      ].filter(Boolean);
      setMessage(`Imported · ${bits.join(" · ")}`);
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Import</h2>
          <p>CSV templates · validate · preview · apply</p>
        </div>
      </div>

      <div className="panel-box" style={{ marginBottom: 16 }}>
        <div className="chip-row" style={{ marginBottom: 12 }}>
          {IMPORT_KINDS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`chip ${kind === entry.id ? "active" : ""}`}
              onClick={() => {
                setKind(entry.id);
                setPreview(null);
                setMessage("");
                setError("");
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <p style={{ margin: "0 0 12px", color: "var(--muted)" }}>
          {IMPORT_KINDS.find((entry) => entry.id === kind)?.blurb}
        </p>
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <button type="button" className="secondary" onClick={downloadTemplate}>
            Download template
          </button>
          <label className="btn-file">
            Choose CSV
            <input
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        <div className="field">
          <label>CSV</label>
          <textarea
            rows={10}
            value={csv}
            placeholder="Paste CSV or choose a file…"
            onChange={(e) => {
              setCsv(e.target.value);
              setPreview(null);
            }}
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.85rem" }}
          />
        </div>
        <div className="toolbar">
          <button type="button" disabled={busy || !csv.trim()} onClick={() => void runPreview()}>
            {busy ? "Working…" : "Validate & preview"}
          </button>
          <button
            type="button"
            disabled={busy || !preview || preview.errors > 0}
            onClick={() => void runApply()}
          >
            Import {preview && !preview.errors ? preview.valid : ""} rows
          </button>
        </div>
        {message && <p className="badge" style={{ marginTop: 12 }}>{message}</p>}
        {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
        {preview && <p style={{ marginTop: 10, color: "var(--muted)", fontSize: "0.88rem" }}>{preview.notes}</p>}
      </div>

      {preview && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Line</th>
                <th>Action</th>
                <th>Summary</th>
                <th>Issues</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr key={`${row.line}-${row.summary}`}>
                  <td>{row.line}</td>
                  <td>
                    <span className={`badge ${row.action === "error" ? "warn" : ""}`}>{row.action}</span>
                  </td>
                  <td>{row.summary}</td>
                  <td style={{ fontSize: "0.85rem", color: row.action === "error" ? "var(--danger)" : "var(--muted)" }}>
                    {row.issues.map((issue) => issue.message).join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
