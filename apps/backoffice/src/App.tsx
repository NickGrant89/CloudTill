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
  const [navOpen, setNavOpen] = useState(false);
  const [email, setEmail] = useState("owner@purepos.demo");
  const [pin, setPin] = useState("1234");
  const [error, setError] = useState("");

  useEffect(() => {
    setNavOpen(false);
  }, [page]);

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
          <h1>PurePOS</h1>
          <p>Loading back office…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="login">
        <form className="login-card" onSubmit={(e) => void login(e)}>
          <h1>PurePOS</h1>
          <p>Back office · desktop management</p>
          <div className="field">
            <label>Email</label>
            <select value={email} onChange={(e) => setEmail(e.target.value)}>
              <option value="owner@purepos.demo">owner@purepos.demo</option>
              <option value="manager@purepos.demo">manager@purepos.demo</option>
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
    { id: "modifiers", label: "Modifiers" },
    { id: "inventory", label: "Inventory" },
    { id: "stocktake", label: "Stocktake" },
    { id: "import", label: "Import" },
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

  const pageLabel = nav.find((n) => n.id === page)?.label ?? "Back office";

  return (
    <div className={`shell${navOpen ? " nav-open" : ""}`}>
      <header className="mobile-topbar">
        <button
          type="button"
          className="menu-toggle"
          aria-label={navOpen ? "Close menu" : "Open menu"}
          aria-expanded={navOpen}
          aria-controls="bo-sidebar"
          onClick={() => setNavOpen((open) => !open)}
        >
          <span aria-hidden="true">{navOpen ? "✕" : "☰"}</span>
        </button>
        <div className="mobile-topbar-copy">
          <div className="mobile-brand">PurePOS</div>
          <div className="mobile-page">{pageLabel}</div>
        </div>
        <button
          type="button"
          className="secondary mobile-signout"
          onClick={() => {
            setToken(null);
            setUser(null);
          }}
        >
          Out
        </button>
      </header>

      <div
        className="nav-backdrop"
        hidden={!navOpen}
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
      />

      <div className="shell-body">
        <aside id="bo-sidebar" className="sidebar" aria-label="Back office navigation">
          <div className="brand">PurePOS</div>
          <p className="sub">{storeName}</p>
          <nav className="sidebar-nav">
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
          </nav>
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
      </div>
      <LowStockToast onOpenInventory={() => setPage("inventory")} />
    </div>
  );
}
