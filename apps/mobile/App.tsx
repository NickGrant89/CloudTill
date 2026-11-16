import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const ROLES = ["owner", "manager", "cashier"] as const;
type Role = (typeof ROLES)[number];
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:4000/api";

type Screen = "login" | "home" | "register" | "pay" | "clock" | "gift" | "kitchen";

interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  storeId: string;
}

interface Item {
  id: string;
  name: string;
  color: string;
  variants: { id: string; priceCents: number; sku: string }[];
}

interface TicketLine {
  key: string;
  variantId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  modifiers: { name: string; priceCents: number }[];
  discountCents: number;
}

interface Ticket {
  id: string;
  name: string;
  lines: TicketLine[];
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  discountCents: number;
}

interface PaymentType {
  id: string;
  name: string;
  type: string;
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
  const [registerId, setRegisterId] = useState("");
  const [email, setEmail] = useState("cashier@cloudtill.demo");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [paymentTypes, setPaymentTypes] = useState<PaymentType[]>([]);
  const [payTypeId, setPayTypeId] = useState("");
  const [clockStatus, setClockStatus] = useState<{ clockedIn: boolean; clockIn: string | null } | null>(null);
  const [giftCode, setGiftCode] = useState("GC-DEMO50");
  const [giftCard, setGiftCard] = useState<{ code: string; balanceCents: number; status: string } | null>(null);
  const [kitchen, setKitchen] = useState<
    { id: string; orderNumber: string; customerName: string; status: string; totalCents: number; lines: { name: string; quantity: number }[] }[]
  >([]);
  const [receiptMsg, setReceiptMsg] = useState("");

  const roleLabel = useMemo(() => (user ? `${user.name} · ${user.role}` : ""), [user]);

  async function login() {
    setBusy(true);
    setError("");
    try {
      const data = await api<{
        token: string;
        user: User;
        store: { name: string };
        registers: { id: string }[];
      }>("/auth/login", null, {
        method: "POST",
        body: JSON.stringify({ email, pin }),
      });
      setToken(data.token);
      setUser(data.user);
      setStoreName(data.store.name);
      setRegisterId(data.registers[0]?.id ?? "");
      setScreen("home");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function openRegister() {
    setBusy(true);
    setError("");
    try {
      const [its, pts, t] = await Promise.all([
        api<Item[]>("/catalog/items", token),
        api<PaymentType[]>("/pos/payment-types", token),
        api<Ticket>("/pos/tickets", token, {
          method: "POST",
          body: JSON.stringify({ registerId, name: "Mobile sale" }),
        }),
      ]);
      setItems(its);
      setPaymentTypes(pts);
      setPayTypeId(pts.find((p) => p.type === "card")?.id ?? pts[0]?.id ?? "");
      setTicket(t);
      setScreen("register");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function addItem(item: Item) {
    if (!ticket) return;
    const variant = item.variants[0];
    const updated = await api<Ticket>(`/pos/tickets/${ticket.id}/lines`, token, {
      method: "POST",
      body: JSON.stringify({ variantId: variant.id, quantity: 1 }),
    });
    setTicket(updated);
  }

  async function completePay() {
    if (!ticket || !payTypeId) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ sale: { id: string; receiptNumber: string; totalCents: number } }>(
        `/pos/tickets/${ticket.id}/pay`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            payments: [{ paymentTypeId: payTypeId, amountCents: ticket.totalCents }],
          }),
        }
      );
      // Print via printer integration layer (mock driver)
      await api(`/printers/print-receipt`, token, {
        method: "POST",
        body: JSON.stringify({ saleId: result.sale.id }),
      }).catch(() => undefined);
      setReceiptMsg(`${result.sale.receiptNumber} · ${money(result.sale.totalCents)}`);
      setTicket(null);
      setScreen("home");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  }

  async function refreshClock() {
    setClockStatus(await api("/time-clock/status", token));
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

  async function loadKitchen() {
    setBusy(true);
    try {
      setKitchen(await api("/kitchen/orders", token));
      setScreen("kitchen");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kitchen failed");
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
        <Text style={styles.sub}>Mobile register · Expo</Text>
        <TextInput style={styles.input} autoCapitalize="none" value={email} onChangeText={setEmail} placeholder="Email" />
        <TextInput style={styles.input} value={pin} onChangeText={setPin} placeholder="PIN" keyboardType="number-pad" secureTextEntry />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={styles.btn} onPress={() => void login()} disabled={busy}>
          {busy ? <ActivityIndicator color="#1a1410" /> : <Text style={styles.btnText}>Sign in</Text>}
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <Text style={styles.brand}>CloudTill</Text>
      <Text style={styles.sub}>{storeName}</Text>
      <Text style={styles.hint}>{roleLabel}</Text>
      {receiptMsg ? <Text style={styles.ok}>Last sale: {receiptMsg}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {screen === "home" && (
        <View style={styles.menu}>
          <Pressable style={styles.btn} onPress={() => void openRegister()}>
            <Text style={styles.btnText}>Open register</Text>
          </Pressable>
          <Pressable style={styles.btnSecondary} onPress={() => void loadKitchen()}>
            <Text style={styles.btnSecondaryText}>Kitchen / online orders</Text>
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

      {screen === "register" && ticket && (
        <View style={{ flex: 1 }}>
          <Pressable onPress={() => setScreen("home")}>
            <Text style={styles.link}>← Home</Text>
          </Pressable>
          <Text style={styles.rowTitle}>
            Ticket · {money(ticket.totalCents)} (tax {money(ticket.taxCents)})
          </Text>
          <FlatList
            style={{ flex: 1, marginTop: 8 }}
            data={items}
            keyExtractor={(i) => i.id}
            numColumns={2}
            columnWrapperStyle={{ gap: 8 }}
            contentContainerStyle={{ gap: 8 }}
            renderItem={({ item }) => (
              <Pressable style={[styles.tile, { backgroundColor: item.color || "#314239" }]} onPress={() => void addItem(item)}>
                <Text style={styles.tileName}>{item.name}</Text>
                <Text style={styles.tilePrice}>{money(item.variants[0]?.priceCents ?? 0)}</Text>
              </Pressable>
            )}
          />
          <ScrollView style={{ maxHeight: 120, marginVertical: 8 }}>
            {ticket.lines.map((l) => (
              <Text key={l.key} style={styles.hint}>
                {l.quantity} × {l.name} · {money(l.unitPriceCents * l.quantity)}
              </Text>
            ))}
          </ScrollView>
          <Pressable
            style={styles.btn}
            disabled={!ticket.lines.length}
            onPress={() => setScreen("pay")}
          >
            <Text style={styles.btnText}>Charge {money(ticket.totalCents)}</Text>
          </Pressable>
        </View>
      )}

      {screen === "pay" && ticket && (
        <View style={styles.menu}>
          <Pressable onPress={() => setScreen("register")}>
            <Text style={styles.link}>← Back</Text>
          </Pressable>
          <Text style={styles.rowTitle}>Pay {money(ticket.totalCents)}</Text>
          {paymentTypes.map((pt) => (
            <Pressable
              key={pt.id}
              style={[styles.btnSecondary, payTypeId === pt.id && styles.btnSelected]}
              onPress={() => setPayTypeId(pt.id)}
            >
              <Text style={styles.btnSecondaryText}>{pt.name}</Text>
            </Pressable>
          ))}
          <Pressable style={styles.btn} onPress={() => void completePay()} disabled={busy}>
            <Text style={styles.btnText}>{busy ? "Processing…" : "Complete sale + print"}</Text>
          </Pressable>
        </View>
      )}

      {screen === "kitchen" && (
        <View style={{ flex: 1 }}>
          <Pressable onPress={() => setScreen("home")}>
            <Text style={styles.link}>← Home</Text>
          </Pressable>
          <FlatList
            data={kitchen}
            keyExtractor={(o) => o.id}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>
                    {item.orderNumber} · {item.customerName}
                  </Text>
                  <Text style={styles.hint}>
                    {item.lines.map((l) => `${l.quantity}×${l.name}`).join(", ")}
                  </Text>
                  <Text style={styles.hint}>
                    {item.status} · {money(item.totalCents)}
                  </Text>
                </View>
                <Pressable
                  style={styles.smallBtn}
                  onPress={() =>
                    void api(`/kitchen/orders/${item.id}`, token, {
                      method: "PATCH",
                      body: JSON.stringify({
                        status: item.status === "pending" ? "preparing" : item.status === "preparing" ? "ready" : "completed",
                      }),
                    }).then(loadKitchen)
                  }
                >
                  <Text style={styles.btnSecondaryText}>Advance</Text>
                </Pressable>
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
            {clockStatus?.clockedIn
              ? `Clocked in since ${new Date(clockStatus.clockIn!).toLocaleTimeString()}`
              : "Not clocked in"}
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
          <Pressable
            style={styles.btn}
            onPress={() =>
              void api<{ code: string; balanceCents: number; status: string }>(`/gift-cards/${giftCode}`, token)
                .then(setGiftCard)
                .catch((e) => setError(e instanceof Error ? e.message : "Not found"))
            }
          >
            <Text style={styles.btnText}>Lookup</Text>
          </Pressable>
          {giftCard && (
            <Text style={styles.rowTitle}>
              {giftCard.code}: {money(giftCard.balanceCents)} ({giftCard.status})
            </Text>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1a2420", padding: 20 },
  brand: { fontSize: 34, fontWeight: "700", color: "#f4f0e8", marginTop: 16 },
  sub: { color: "#9aaba1", marginBottom: 4 },
  hint: { color: "#6b7a72", marginTop: 4, fontSize: 13 },
  ok: { color: "#8fbf9f", marginTop: 8 },
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
    marginTop: 12,
  },
  btnText: { color: "#1a1410", fontWeight: "700", fontSize: 16 },
  btnSecondary: {
    backgroundColor: "#314239",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    marginTop: 10,
  },
  btnSelected: { borderWidth: 2, borderColor: "#c4783a" },
  btnSecondaryText: { color: "#f4f0e8", fontWeight: "600" },
  btnGhost: {
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#314239",
  },
  menu: { marginTop: 16 },
  error: { color: "#e07a6a", marginTop: 8 },
  link: { color: "#c4783a", marginBottom: 10, fontWeight: "600" },
  row: {
    backgroundColor: "#24302a",
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  rowTitle: { color: "#f4f0e8", fontWeight: "600" },
  tile: {
    flex: 1,
    minHeight: 96,
    borderRadius: 14,
    padding: 12,
    justifyContent: "flex-end",
  },
  tileName: { color: "#f7f3eb", fontWeight: "700" },
  tilePrice: { color: "#e8eee9", marginTop: 4 },
  smallBtn: {
    backgroundColor: "#3d5a4c",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
});
