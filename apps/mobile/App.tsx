import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
/** Mirrors @cloudtill/shared roles — keep in sync with packages/shared */
const ROLES = ["owner", "manager", "cashier"] as const;
type Role = (typeof ROLES)[number];

/** Override via EXPO_PUBLIC_API_URL when testing on device */
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:4000/api";

type Screen = "login" | "home" | "catalog" | "clock" | "gift";

interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  storeId: string;
}

async function api<T>(path: string, token?: string | null, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("login");
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [storeName, setStoreName] = useState("");
  const [email, setEmail] = useState("cashier@cloudtill.demo");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<{ id: string; name: string; variants: { priceCents: number }[] }[]>([]);
  const [clockStatus, setClockStatus] = useState<{ clockedIn: boolean; clockIn: string | null } | null>(null);
  const [giftCode, setGiftCode] = useState("GC-DEMO50");
  const [giftCard, setGiftCard] = useState<{ code: string; balanceCents: number; status: string } | null>(null);

  const roleLabel = useMemo(() => (user ? `${user.name} · ${user.role}` : ""), [user]);

  async function login() {
    setBusy(true);
    setError("");
    try {
      const data = await api<{ token: string; user: User; store: { name: string } }>("/auth/login", null, {
        method: "POST",
        body: JSON.stringify({ email, pin }),
      });
      setToken(data.token);
      setUser(data.user);
      setStoreName(data.store.name);
      setScreen("home");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadCatalog() {
    setBusy(true);
    try {
      const list = await api<typeof items>("/catalog/items", token);
      setItems(list);
      setScreen("catalog");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function refreshClock() {
    const status = await api<{ clockedIn: boolean; clockIn: string | null }>("/time-clock/status", token);
    setClockStatus(status);
  }

  async function toggleClock() {
    setBusy(true);
    try {
      if (clockStatus?.clockedIn) await api("/time-clock/clock-out", token, { method: "POST", body: "{}" });
      else await api("/time-clock/clock-in", token, { method: "POST", body: "{}" });
      await refreshClock();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clock failed");
    } finally {
      setBusy(false);
    }
  }

  async function lookupGift() {
    setBusy(true);
    setError("");
    try {
      const card = await api<typeof giftCard>(`/gift-cards/${giftCode}`, token);
      setGiftCard(card);
    } catch (e) {
      setGiftCard(null);
      setError(e instanceof Error ? e.message : "Not found");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (screen === "clock" && token) void refreshClock().catch(() => undefined);
  }, [screen, token]);

  if (screen === "login") {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar style="light" />
        <Text style={styles.brand}>CloudTill</Text>
        <Text style={styles.sub}>Mobile · Expo scaffold · shares API + @cloudtill/shared</Text>
        <TextInput style={styles.input} autoCapitalize="none" value={email} onChangeText={setEmail} placeholder="Email" />
        <TextInput style={styles.input} value={pin} onChangeText={setPin} placeholder="PIN" keyboardType="number-pad" secureTextEntry />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={styles.btn} onPress={() => void login()} disabled={busy}>
          {busy ? <ActivityIndicator color="#1a1410" /> : <Text style={styles.btnText}>Sign in</Text>}
        </Pressable>
        <Text style={styles.hint}>Roles: {ROLES.join(", ")} · demo PIN 1111 / 2222 / 1234</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <Text style={styles.brand}>CloudTill</Text>
      <Text style={styles.sub}>{storeName}</Text>
      <Text style={styles.hint}>{roleLabel}</Text>

      {screen === "home" && (
        <View style={styles.menu}>
          <Pressable style={styles.btn} onPress={() => void loadCatalog()}>
            <Text style={styles.btnText}>Catalog</Text>
          </Pressable>
          <Pressable style={styles.btnSecondary} onPress={() => setScreen("clock")}>
            <Text style={styles.btnSecondaryText}>Time clock</Text>
          </Pressable>
          <Pressable style={styles.btnSecondary} onPress={() => setScreen("gift")}>
            <Text style={styles.btnSecondaryText}>Gift card lookup</Text>
          </Pressable>
          <Pressable
            style={styles.btnGhost}
            onPress={() => {
              setToken(null);
              setUser(null);
              setScreen("login");
              setPin("");
            }}
          >
            <Text style={styles.btnSecondaryText}>Lock</Text>
          </Pressable>
        </View>
      )}

      {screen === "catalog" && (
        <View style={{ flex: 1, width: "100%" }}>
          <Pressable onPress={() => setScreen("home")}>
            <Text style={styles.link}>← Home</Text>
          </Pressable>
          <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Text style={styles.rowTitle}>{item.name}</Text>
                <Text style={styles.rowMeta}>{money(item.variants[0]?.priceCents ?? 0)}</Text>
              </View>
            )}
          />
        </View>
      )}

      {screen === "clock" && (
        <View style={styles.menu}>
          <Pressable onPress={() => setScreen("home")}>
            <Text style={styles.link}>← Home</Text>
          </Pressable>
          <Text style={styles.rowTitle}>
            {clockStatus?.clockedIn ? `Clocked in since ${new Date(clockStatus.clockIn!).toLocaleTimeString()}` : "Not clocked in"}
          </Text>
          <Pressable style={styles.btn} onPress={() => void toggleClock()} disabled={busy}>
            <Text style={styles.btnText}>{clockStatus?.clockedIn ? "Clock out" : "Clock in"}</Text>
          </Pressable>
        </View>
      )}

      {screen === "gift" && (
        <View style={styles.menu}>
          <Pressable onPress={() => setScreen("home")}>
            <Text style={styles.link}>← Home</Text>
          </Pressable>
          <TextInput style={styles.input} value={giftCode} onChangeText={setGiftCode} autoCapitalize="characters" />
          <Pressable style={styles.btn} onPress={() => void lookupGift()}>
            <Text style={styles.btnText}>Lookup</Text>
          </Pressable>
          {giftCard && (
            <Text style={styles.rowTitle}>
              {giftCard.code}: {money(giftCard.balanceCents)} ({giftCard.status})
            </Text>
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#1a2420",
    padding: 24,
    alignItems: "stretch",
  },
  brand: {
    fontSize: 36,
    fontWeight: "700",
    color: "#f4f0e8",
    marginTop: 24,
  },
  sub: { color: "#9aaba1", marginBottom: 8 },
  hint: { color: "#6b7a72", marginTop: 12, fontSize: 13 },
  input: {
    backgroundColor: "#f4f0e8",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 10,
    color: "#1c2420",
  },
  btn: {
    backgroundColor: "#c4783a",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    marginTop: 14,
  },
  btnText: { color: "#1a1410", fontWeight: "700", fontSize: 16 },
  btnSecondary: {
    backgroundColor: "#314239",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    marginTop: 10,
  },
  btnSecondaryText: { color: "#f4f0e8", fontWeight: "600" },
  btnGhost: {
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#314239",
  },
  menu: { marginTop: 20 },
  error: { color: "#e07a6a", marginTop: 8 },
  link: { color: "#c4783a", marginBottom: 12, fontWeight: "600" },
  row: {
    backgroundColor: "#24302a",
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  rowTitle: { color: "#f4f0e8", fontWeight: "600" },
  rowMeta: { color: "#9aaba1" },
});
