import { useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";
import { Pages, switchStore, type PageId } from "./Pages";
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
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [page, setPage] = useState<PageId>("dashboard");
  const [navOpen, setNavOpen] = useState(false);
  const [email, setEmail] = useState(() => new URLSearchParams(window.location.search).get("email") || "");
  const [pin, setPin] = useState("");
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
    api<{ user: User; store: { name: string }; stores?: { id: string; name: string }[] }>("/auth/me")
      .then((d) => {
        setUser(d.user);
        setStoreName(d.store.name);
        setBranches(d.stores ?? []);
      })
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const data = await api<{
        token: string;
        user: User;
        store: { name: string };
        stores?: { id: string; name: string }[];
      }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, pin }),
      });
      setToken(data.token);
      setUser(data.user);
      setStoreName(data.store.name);
      setBranches(data.stores ?? []);
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
            <label htmlFor="bo-email">Email</label>
            <input
              id="bo-email"
              type="email"
              inputMode="email"
              autoComplete="username"
              required
              placeholder="you@yourbusiness.co.uk"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="bo-pin">PIN</label>
            <input
              id="bo-pin"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              required
              minLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </div>
          {error && <p className="error">{error}</p>}
          <button type="submit" style={{ width: "100%", marginTop: 8 }}>
            Sign in
          </button>
          <p style={{ marginTop: 14, fontSize: "0.82rem" }}>
            Trying the demo?{" "}
            <button
              type="button"
              className="linkish"
              onClick={() => {
                setEmail("owner@purepos.demo");
                setPin("1234");
              }}
            >
              Fill demo owner login
            </button>
          </p>
        </form>
      </div>
    );
  }

  const nav: { id: PageId; label: string }[] = [
    { id: "dashboard", label: "Dashboard" },
    { id: "catalog", label: "Items" },
    { id: "modifiers", label: "Modifiers" },
    { id: "inventory", label: "Inventory" },
    { id: "stocktake", label: "Stocktake" },
    { id: "import", label: "Import" },
    { id: "customers", label: "Customers" },
    { id: "giftcards", label: "Gift cards" },
    { id: "kitchen", label: "Kitchen / delivery" },
    { id: "employees", label: "Employees" },
    { id: "timeclock", label: "Time clock" },
    { id: "stores", label: "Stores & tills" },
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
          {branches.length > 1 ? (
            <select
              className="store-switch"
              aria-label="Switch branch"
              value={user.storeId}
              onChange={(e) => void switchStore(e.target.value)}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="sub">{storeName}</p>
          )}
          <nav className="sidebar-nav">
            {nav.map((n) => (
              <button
                key={n.id}
                type="button"
                className={`nav-btn ${page === n.id ? "active" : ""}`}
                onClick={() => {
                  setPage(n.id);
                  setNavOpen(false);
                }}
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
          <Pages page={page} onNavigate={setPage} />
        </main>
      </div>
      <LowStockToast onOpenInventory={() => setPage("inventory")} />
    </div>
  );
}
