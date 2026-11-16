import { useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";
import { Pages, type PageId } from "./Pages";
import { LowStockToast } from "./ExtrasPages";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  storeId: string;
}

export function App() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [storeName, setStoreName] = useState("");
  const [page, setPage] = useState<PageId>("dashboard");
  const [email, setEmail] = useState("owner@cloudtill.demo");
  const [pin, setPin] = useState("1234");
  const [error, setError] = useState("");

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api<{ user: User; store: { name: string } }>("/auth/me")
      .then((d) => {
        setUser(d.user);
        setStoreName(d.store.name);
      })
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const data = await api<{ token: string; user: User; store: { name: string } }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, pin }),
      });
      setToken(data.token);
      setUser(data.user);
      setStoreName(data.store.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  if (loading) {
    return (
      <div className="login">
        <div className="login-card">
          <h1>CloudTill</h1>
          <p>Loading back office…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="login">
        <form className="login-card" onSubmit={(e) => void login(e)}>
          <h1>CloudTill</h1>
          <p>Back office · desktop management</p>
          <div className="field">
            <label>Email</label>
            <select value={email} onChange={(e) => setEmail(e.target.value)}>
              <option value="owner@cloudtill.demo">owner@cloudtill.demo</option>
              <option value="manager@cloudtill.demo">manager@cloudtill.demo</option>
            </select>
          </div>
          <div className="field">
            <label>PIN</label>
            <input value={pin} onChange={(e) => setPin(e.target.value)} />
          </div>
          {error && <p className="error">{error}</p>}
          <button type="submit" style={{ width: "100%", marginTop: 8 }}>
            Sign in
          </button>
          <p style={{ marginTop: 14, fontSize: "0.82rem" }}>Demo: owner 1234 · manager 2222</p>
        </form>
      </div>
    );
  }

  const nav: { id: PageId; label: string }[] = [
    { id: "dashboard", label: "Dashboard" },
    { id: "catalog", label: "Catalog" },
    { id: "inventory", label: "Inventory" },
    { id: "stocktake", label: "Stocktake" },
    { id: "customers", label: "Customers" },
    { id: "giftcards", label: "Gift cards" },
    { id: "kitchen", label: "Kitchen / online" },
    { id: "employees", label: "Employees" },
    { id: "timeclock", label: "Time clock" },
    { id: "stores", label: "Stores & registers" },
    { id: "sales", label: "Sales history" },
    { id: "eod", label: "End of day" },
    { id: "reports", label: "Reports" },
    { id: "shifts", label: "Shifts" },
    { id: "labels", label: "Barcode labels" },
    { id: "printers", label: "Printers" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">CloudTill</div>
        <p className="sub">{storeName}</p>
        {nav.map((n) => (
          <button
            key={n.id}
            type="button"
            className={`nav-btn ${page === n.id ? "active" : ""}`}
            onClick={() => setPage(n.id)}
          >
            {n.label}
          </button>
        ))}
        <div className="top-user">
          <div>
            {user.name}
            <div style={{ color: "#9aaba1" }}>{user.role}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              setToken(null);
              setUser(null);
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <Pages page={page} />
      </main>
      <LowStockToast onOpenInventory={() => setPage("inventory")} />
    </div>
  );
}
