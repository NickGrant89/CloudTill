import { useRef, useState } from "react";
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

type LoginResult = {
  token: string;
  user: SessionUser;
  store: SessionStore;
  registers: SessionRegister[];
  stores?: { id: string; name: string }[];
};

const DEVICE_KEY = "purepos.pos.device";

type DeviceStore = { storeId: string; storeName: string };

function readDevice(): DeviceStore | null {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    return raw ? (JSON.parse(raw) as DeviceStore) : null;
  } catch {
    return null;
  }
}

export function Login({ onSuccess }: Props) {
  const [device, setDevice] = useState<DeviceStore | null>(() => readDevice());
  const [pairing, setPairing] = useState(false);
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [branches, setBranches] = useState<{ id: string; name: string }[] | null>(null);
  const pinRef = useRef("");
  const busyRef = useRef(false);

  function setPinValue(next: string) {
    pinRef.current = next;
    setPin(next);
  }

  function remember(data: LoginResult) {
    const next = { storeId: data.store.id, storeName: data.store.name };
    localStorage.setItem(DEVICE_KEY, JSON.stringify(next));
    setDevice(next);
  }

  async function submit(nextPin: string) {
    if (nextPin.length < 4 || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await api<LoginResult>("/auth/login", {
        method: "POST",
        body: JSON.stringify(
          pairing
            ? { email: email.trim(), pin: nextPin }
            : device
              ? { pin: nextPin, storeId: device.storeId }
              : { pin: nextPin }
        ),
      });
      if (pairing && (data.stores?.length ?? 0) > 1) {
        setBranches(data.stores!);
        return;
      }
      if (pairing) remember(data);
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
    if (!pairing && next.length >= 4) void submit(next);
  }

  async function pickBranch(storeId: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await api<LoginResult>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), pin: pinRef.current, storeId }),
      });
      remember(data);
      setBranches(null);
      setPairing(false);
      onSuccess(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function switchToDemo() {
    localStorage.removeItem(DEVICE_KEY);
    setDevice(null);
    setPairing(false);
    setPinValue("");
    setError("");
  }

  if (branches) {
    return (
      <div className="login">
        <div className="login-card">
          <h1 className="brand">PurePOS</h1>
          <p className="tag">Which branch is this till in?</p>
          <div className="branch-list">
            {branches.map((b) => (
              <button key={b.id} type="button" disabled={busy} onClick={() => void pickBranch(b.id)}>
                {b.name}
              </button>
            ))}
          </div>
          {error && <p className="error">{error}</p>}
          <p style={{ marginTop: 12 }}>
            <button
              type="button"
              className="linkish"
              onClick={() => {
                setBranches(null);
                setPinValue("");
              }}
            >
              Back
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <div className="login-card">
        <h1 className="brand">PurePOS</h1>
        <p className="tag">{pairing ? "Set up this till for your business" : "Enter your PIN"}</p>

        <p className="device-line">
          {pairing ? "Sign in once with your email — after that staff only need their PIN." : `Till: ${device?.storeName ?? "PurePOS Demo Café"}`}
          {!pairing && (
            <button type="button" className="linkish" onClick={() => { setPairing(true); setPinValue(""); setError(""); }}>
              {device ? "Change business" : "Use my business"}
            </button>
          )}
        </p>

        {pairing && (
          <input
            className="pair-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="Owner or staff email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}

        <div className="pin-display">{pin ? "•".repeat(pin.length) : "Enter PIN"}</div>

        <div className="pin-pad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "←"].map((d) => (
            <button key={d} type="button" disabled={busy} onClick={() => press(d)}>
              {d}
            </button>
          ))}
        </div>

        {pairing && (
          <div className="pair-actions">
            <button
              type="button"
              className="pair-submit"
              disabled={busy || !email.includes("@") || pin.length < 4}
              onClick={() => void submit(pinRef.current)}
            >
              {busy ? "Signing in…" : "Set up this till"}
            </button>
            <button type="button" className="linkish" onClick={() => { setPairing(false); setPinValue(""); setError(""); }}>
              Cancel
            </button>
          </div>
        )}

        {error && <p className="error">{error}</p>}
        {!device && !pairing && (
          <p style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: 16 }}>
            Demo PINs: cashier 1111 · manager 2222 · owner 1234
          </p>
        )}
        {device && !pairing && (
          <p style={{ marginTop: 12 }}>
            <button type="button" className="linkish" onClick={switchToDemo}>
              Switch this till to the demo café
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
