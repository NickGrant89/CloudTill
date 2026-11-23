import { useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";
import { Login } from "./Login";
import { Register } from "./Register";
import { KitchenScreen } from "./KitchenScreen";

const KITCHEN_MODE = /\/kitchen\/?$/.test(window.location.pathname);

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  storeId: string;
}

export interface SessionStore {
  id: string;
  name: string;
  currency: string;
}

export interface SessionRegister {
  id: string;
  name: string;
  storeId: string;
}

export function App() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [store, setStore] = useState<SessionStore | null>(null);
  const [registers, setRegisters] = useState<SessionRegister[]>([]);
  const [registerId, setRegisterId] = useState<string>("");

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api<{ user: SessionUser; store: SessionStore; registers: SessionRegister[] }>("/auth/me")
      .then((data) => {
        setUser(data.user);
        setStore(data.store);
        setRegisters(data.registers);
        setRegisterId(data.registers[0]?.id ?? "");
      })
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="login">
        <div className="login-card">
          <h1 className="brand">PurePOS</h1>
          <p className="tag">{KITCHEN_MODE ? "Loading kitchen screen…" : "Loading register…"}</p>
        </div>
      </div>
    );
  }

  if (!user || !store) {
    return (
      <Login
        onSuccess={(data) => {
          setToken(data.token);
          setUser(data.user);
          setStore(data.store);
          setRegisters(data.registers);
          setRegisterId(data.registers[0]?.id ?? "");
        }}
      />
    );
  }

  const logout = () => {
    setToken(null);
    setUser(null);
    setStore(null);
  };

  if (KITCHEN_MODE) return <KitchenScreen user={user} store={store} onLogout={logout} />;

  return (
    <Register
      user={user}
      store={store}
      registers={registers}
      registerId={registerId}
      onRegisterChange={setRegisterId}
      onLogout={logout}
    />
  );
}
