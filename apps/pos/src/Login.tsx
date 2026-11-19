import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { SessionRegister, SessionStore, SessionUser } from "./App";

interface StoreRow {
  id: string;
  name: string;
  slug?: string;
}

interface StaffRow {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface Props {
  onSuccess: (data: {
    token: string;
    user: SessionUser;
    store: SessionStore;
    registers: SessionRegister[];
  }) => void;
}

type Step = "store" | "staff" | "pin";

export function Login({ onSuccess }: Props) {
  const [step, setStep] = useState<Step>("store");
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [storeId, setStoreId] = useState("");
  const [storeName, setStoreName] = useState("");
  const [selected, setSelected] = useState<StaffRow | null>(null);
  const [emailOverride, setEmailOverride] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingStaff, setLoadingStaff] = useState(false);

  const pinRef = useRef("");
  const busyRef = useRef(false);

  useEffect(() => {
    api<StoreRow[]>("/auth/stores")
      .then((list) => {
        setStores(list);
        if (list.length === 1) {
          void chooseStore(list[0]);
        }
      })
      .catch(() => setError("Could not load stores — check the till is online"));
  }, []);

  async function chooseStore(store: StoreRow) {
    setError("");
    setStoreId(store.id);
    setStoreName(store.name);
    setSelected(null);
    setEmailOverride("");
    setLoadingStaff(true);
    try {
      const data = await api<{ store: StoreRow; staff: StaffRow[] }>(`/auth/stores/${store.id}/staff`);
      setStaff(data.staff);
      setStep("staff");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load staff");
    } finally {
      setLoadingStaff(false);
    }
  }

  function chooseStaff(row: StaffRow) {
    setSelected(row);
    setEmailOverride(row.email);
    setPinValue("");
    setError("");
    setStep("pin");
  }

  function setPinValue(next: string) {
    pinRef.current = next;
    setPin(next);
  }

  async function submit(nextPin: string) {
    const email = (emailOverride || selected?.email || "").trim();
    if (!storeId || !email || nextPin.length < 4 || busyRef.current) return;

    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await api<{
        token: string;
        user: SessionUser;
        store: SessionStore;
        registers: SessionRegister[];
      }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          storeId,
          email,
          pin: nextPin,
        }),
      });
      onSuccess(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
      setPinValue("");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function press(digit: string) {
    if (busyRef.current) return;
    if (digit === "C") {
      setPinValue("");
      setError("");
      return;
    }
    if (digit === "←") {
      setPinValue(pinRef.current.slice(0, -1));
      return;
    }
    const next = (pinRef.current + digit).slice(0, 8);
    setPinValue(next);
    if (next.length >= 4) void submit(next);
  }

  return (
    <div className="login">
      <div className="login-card login-card-wide">
        <h1 className="brand">PurePOS</h1>
        <p className="tag">Till clock-in</p>

        <ol className="login-steps" aria-label="Sign-in steps">
          <li className={step === "store" ? "active" : storeId ? "done" : ""}>1 · Store</li>
          <li className={step === "staff" ? "active" : selected || emailOverride ? "done" : ""}>2 · Staff</li>
          <li className={step === "pin" ? "active" : ""}>3 · PIN</li>
        </ol>

        {step === "store" && (
          <div className="login-step">
            <p className="login-help">Choose the shop this till belongs to.</p>
            <div className="login-choice-list">
              {stores.map((s) => (
                <button key={s.id} type="button" className="login-choice" disabled={loadingStaff} onClick={() => void chooseStore(s)}>
                  <strong>{s.name}</strong>
                  <span>{s.slug || s.id.slice(0, 8)}</span>
                </button>
              ))}
              {!stores.length && <p className="hint">Loading stores…</p>}
            </div>
          </div>
        )}

        {step === "staff" && (
          <div className="login-step">
            <button type="button" className="login-back" onClick={() => setStep("store")}>
              ← Change store
            </button>
            <p className="login-help">
              Signing into <strong>{storeName}</strong>. Pick who is on this till — PIN alone is not unique.
            </p>
            <div className="login-choice-list">
              {staff.map((row) => (
                <button key={row.id} type="button" className="login-choice" onClick={() => chooseStaff(row)}>
                  <strong>{row.name}</strong>
                  <span>
                    {row.role} · {row.email}
                  </span>
                </button>
              ))}
              {!staff.length && !loadingStaff && <p className="hint">No active staff on this store.</p>}
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor="till-email">Or type email</label>
              <input
                id="till-email"
                type="email"
                autoComplete="username"
                inputMode="email"
                placeholder="you@business.co.uk"
                value={emailOverride}
                onChange={(e) => setEmailOverride(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn primary"
              style={{ width: "100%" }}
              disabled={!emailOverride.trim()}
              onClick={() => {
                setSelected(null);
                setPinValue("");
                setError("");
                setStep("pin");
              }}
            >
              Continue with email
            </button>
          </div>
        )}

        {step === "pin" && (
          <div className="login-step">
            <button type="button" className="login-back" onClick={() => setStep("staff")}>
              ← Change staff
            </button>
            <p className="login-help">
              <strong>{selected?.name || emailOverride}</strong>
              <br />
              {storeName}
            </p>
            <div className="pin-display" aria-live="polite">
              {pin ? "•".repeat(pin.length) : "Enter PIN"}
            </div>
            <div className="pin-pad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "←"].map((d) => (
                <button key={d} type="button" disabled={busy} onClick={() => press(d)}>
                  {d}
                </button>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 12 }}>
              Demo café: owner 1234 · manager 2222 · cashier 1111
            </p>
          </div>
        )}

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
