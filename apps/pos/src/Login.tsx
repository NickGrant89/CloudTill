import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { SessionRegister, SessionStore, SessionUser } from "./App";

interface Props {
  onSuccess: (data: {
    token: string;
    user: SessionUser;
    store: SessionStore;
    registers: SessionRegister[];
  }) => void;
}

export function Login({ onSuccess }: Props) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const pinRef = useRef("");
  const busyRef = useRef(false);

  useEffect(() => {
    api<{ id: string; name: string }[]>("/auth/stores").then(setStores).catch(() => undefined);
  }, []);

  function setPinValue(next: string) {
    pinRef.current = next;
    setPin(next);
  }

  async function submit(nextPin: string) {
    if (nextPin.length < 4 || busyRef.current) return;
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
        body: JSON.stringify({ pin: nextPin }),
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
      <div className="login-card">
        <h1 className="brand">PurePOS</h1>
        <p className="tag">Enter your PIN</p>

        {stores.length > 0 && (
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: -6 }}>
            Demo store: {stores[0].name}
          </p>
        )}

        <div className="pin-display">{pin ? "•".repeat(pin.length) : "Enter PIN"}</div>

        <div className="pin-pad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "←"].map((d) => (
            <button key={d} type="button" disabled={busy} onClick={() => press(d)}>
              {d}
            </button>
          ))}
        </div>

        {error && <p className="error">{error}</p>}
        <p style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: 16 }}>
          Demo PINs: cashier 1111 · manager 2222 · owner 1234
        </p>
      </div>
    </div>
  );
}
