import { useRef, useState } from "react";
import { api } from "./api";
import type { SessionRegister, SessionStore, SessionUser } from "./App";
import { clearPinnedTill, readPinnedTill, registerTone, registerToneIndex, toneAt, writePinnedTill } from "./pinnedTill";

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
  const [changing, setChanging] = useState(false);
  const [tillChoices, setTillChoices] = useState<SessionRegister[] | null>(null);
  const [pinned, setPinned] = useState(() => readPinnedTill(readDevice()?.storeId ?? null));
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
    const saved = readPinnedTill();
    if (saved && saved.storeId !== data.store.id) {
      clearPinnedTill();
      setPinned(null);
    }
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
      if (changing) {
        if (data.user.role !== "owner" && data.user.role !== "manager") {
          setError("Only an owner or manager can change which till this iPad is.");
          setPinValue("");
          return;
        }
        setTillChoices(data.registers);
        return;
      }
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
    clearPinnedTill();
    setDevice(null);
    setPinned(null);
    setPairing(false);
    setChanging(false);
    setPinValue("");
    setError("");
  }

  function chooseTill(register: SessionRegister) {
    const storeId = device?.storeId ?? pinned?.storeId;
    if (!storeId) return;
    writePinnedTill({
      storeId,
      registerId: register.id,
      registerName: register.name,
      toneIndex: registerToneIndex(register.id, tillChoices ?? []),
    });
    setPinned(readPinnedTill(storeId));
    setTillChoices(null);
    setChanging(false);
    setPinValue("");
    setError("");
  }

  if (tillChoices) {
    return (
      <div className="login">
        <div className="login-card">
          <h1 className="brand">PurePOS</h1>
          <p className="tag">Use this iPad as…</p>
          <div className="branch-list">
            {tillChoices.map((register) => {
              const tone = registerTone(register.id, tillChoices);
              return (
                <button
                  key={register.id}
                  type="button"
                  style={{ background: tone.bg, color: tone.ink }}
                  onClick={() => chooseTill(register)}
                >
                  {register.name}
                </button>
              );
            })}
          </div>
          <p style={{ marginTop: 12 }}>
            <button
              type="button"
              className="linkish"
              onClick={() => {
                setTillChoices(null);
                setChanging(false);
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
        <p className="tag">
          {pairing ? "Set up this till for your business" : changing ? "Owner or manager PIN" : "Enter your PIN"}
        </p>

        <p className="device-line">
          {pairing
            ? "Sign in once with your email — after that staff only need their PIN."
            : changing
              ? "This confirms you can move this iPad to a different till."
              : `${/\/kitchen\/?$/.test(window.location.pathname) ? "Kitchen screen" : "Till"}: ${device?.storeName ?? "PurePOS Demo Café"}`}
          {!pairing && !changing && (
            <button type="button" className="linkish" onClick={() => { setPairing(true); setPinValue(""); setError(""); }}>
              {device ? "Change business" : "Use my business"}
            </button>
          )}
        </p>

        {pinned && !pairing && !changing && (
          <p className="device-line">
            <span className="register-badge" style={{ background: toneAt(pinned.toneIndex).bg, color: toneAt(pinned.toneIndex).ink }}>
              This iPad is {pinned.registerName}
            </span>
            <button
              type="button"
              className="linkish"
              onClick={() => {
                setChanging(true);
                setPinValue("");
                setError("");
              }}
            >
              Change till
            </button>
          </p>
        )}

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

        {changing && (
          <p style={{ marginTop: 12 }}>
            <button
              type="button"
              className="linkish"
              onClick={() => {
                setChanging(false);
                setPinValue("");
                setError("");
              }}
            >
              Cancel
            </button>
          </p>
        )}

        {error && <p className="error">{error}</p>}
        {!device && !pairing && !changing && (
          <p style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: 16 }}>
            Demo PINs: cashier 1111 · manager 2222 · owner 1234
          </p>
        )}
        {device && !pairing && !changing && (
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
