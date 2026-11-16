import { useEffect, useState } from "react";
import { api, money } from "./api";

export function GiftCardsPage() {
  const [cards, setCards] = useState<
    {
      id: string;
      code: string;
      balanceCents: number;
      initialCents: number;
      status: string;
      customer: { name: string } | null;
      ledger: { type: string; amountCents: number; balanceAfter: number; note: string | null; createdAt: string }[];
    }[]
  >([]);
  const [form, setForm] = useState({ amount: "25.00", code: "", note: "" });
  const [reload, setReload] = useState({ id: "", amount: "10.00" });
  const [selected, setSelected] = useState<(typeof cards)[0] | null>(null);

  async function load() {
    const list = await api<typeof cards>("/gift-cards");
    setCards(list);
  }

  useEffect(() => {
    void load();
  }, []);

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    await api("/gift-cards", {
      method: "POST",
      body: JSON.stringify({
        amountCents: Math.round(parseFloat(form.amount) * 100),
        code: form.code || undefined,
        note: form.note || undefined,
      }),
    });
    setForm({ amount: "25.00", code: "", note: "" });
    await load();
  }

  async function doReload(e: React.FormEvent) {
    e.preventDefault();
    if (!reload.id) return;
    await api(`/gift-cards/${reload.id}/reload`, {
      method: "POST",
      body: JSON.stringify({ amountCents: Math.round(parseFloat(reload.amount) * 100) }),
    });
    await load();
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Gift cards</h2>
          <p>First-class ledger: issue, reload, redeem (POS), adjust</p>
        </div>
      </div>
      <div className="grid-2">
        <form className="panel-box" onSubmit={(e) => void issue(e)}>
          <h3>Issue card</h3>
          <div className="field">
            <label>Amount ($)</label>
            <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div className="field">
            <label>Code (optional)</label>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="GC-…" />
          </div>
          <div className="field">
            <label>Note</label>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          <button type="submit">Issue</button>
        </form>
        <form className="panel-box" onSubmit={(e) => void doReload(e)}>
          <h3>Reload</h3>
          <div className="field">
            <label>Card</label>
            <select value={reload.id} onChange={(e) => setReload({ ...reload, id: e.target.value })}>
              <option value="">Select…</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} ({money(c.balanceCents)})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Amount ($)</label>
            <input value={reload.amount} onChange={(e) => setReload({ ...reload, amount: e.target.value })} />
          </div>
          <button type="submit">Reload</button>
        </form>
      </div>
      <div className="grid-2">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Balance</th>
                <th>Customer</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => setSelected(c)}>
                  <td>{c.code}</td>
                  <td>{money(c.balanceCents)}</td>
                  <td>{c.customer?.name ?? "—"}</td>
                  <td>
                    <span className="badge">{c.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel-box">
          <h3>{selected ? selected.code : "Ledger"}</h3>
          {selected?.ledger?.length ? (
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Balance</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {selected.ledger.map((l, i) => (
                  <tr key={i}>
                    <td>{l.type}</td>
                    <td>{money(l.amountCents)}</td>
                    <td>{money(l.balanceAfter)}</td>
                    <td>{l.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ color: "var(--muted)" }}>Select a card to view ledger entries.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function TimeClockPage() {
  const [entries, setEntries] = useState<
    {
      id: string;
      employeeName: string;
      clockIn: string;
      clockOut: string | null;
      hours: number | null;
      note: string | null;
    }[]
  >([]);
  const [status, setStatus] = useState<{ clockedIn: boolean; clockIn: string | null } | null>(null);

  async function load() {
    const [list, st] = await Promise.all([
      api<typeof entries>("/time-clock/entries"),
      api<typeof status>("/time-clock/status"),
    ]);
    setEntries(list);
    setStatus(st);
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggle() {
    if (status?.clockedIn) await api("/time-clock/clock-out", { method: "POST", body: "{}" });
    else await api("/time-clock/clock-in", { method: "POST", body: "{}" });
    await load();
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Time clock</h2>
          <p>Employee clock in / out and timesheet history</p>
        </div>
        <button type="button" onClick={() => void toggle()}>
          {status?.clockedIn ? "Clock out" : "Clock in"}
        </button>
      </div>
      <div className="panel-box">
        <p style={{ margin: 0 }}>
          Your status:{" "}
          <strong>{status?.clockedIn ? `In since ${new Date(status.clockIn!).toLocaleString()}` : "Out"}</strong>
        </p>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>In</th>
              <th>Out</th>
              <th>Hours</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{e.employeeName}</td>
                <td>{new Date(e.clockIn).toLocaleString()}</td>
                <td>{e.clockOut ? new Date(e.clockOut).toLocaleString() : "—"}</td>
                <td>{e.hours ?? "—"}</td>
                <td>{e.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ModifierEditor({
  itemId,
  itemName,
  onClose,
}: {
  itemId: string;
  itemName: string;
  onClose: () => void;
}) {
  const [groups, setGroups] = useState<
    {
      id: string;
      name: string;
      minSelect: number;
      maxSelect: number;
      modifiers: { id: string; name: string; priceCents: number; active: boolean }[];
    }[]
  >([]);
  const [groupForm, setGroupForm] = useState({ name: "", minSelect: "0", maxSelect: "1" });
  const [modForm, setModForm] = useState({ groupId: "", name: "", price: "0" });

  async function load() {
    setGroups(await api(`/catalog/items/${itemId}/modifiers`));
  }

  useEffect(() => {
    void load();
  }, [itemId]);

  async function addGroup(e: React.FormEvent) {
    e.preventDefault();
    await api(`/catalog/items/${itemId}/modifier-groups`, {
      method: "POST",
      body: JSON.stringify({
        name: groupForm.name,
        minSelect: parseInt(groupForm.minSelect, 10),
        maxSelect: parseInt(groupForm.maxSelect, 10),
      }),
    });
    setGroupForm({ name: "", minSelect: "0", maxSelect: "1" });
    await load();
  }

  async function addMod(e: React.FormEvent) {
    e.preventDefault();
    await api(`/catalog/modifier-groups/${modForm.groupId}/modifiers`, {
      method: "POST",
      body: JSON.stringify({
        name: modForm.name,
        priceCents: Math.round(parseFloat(modForm.price || "0") * 100),
      }),
    });
    setModForm({ ...modForm, name: "", price: "0" });
    await load();
  }

  return (
    <div className="panel-box">
      <div className="page-head" style={{ marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0 }}>Modifiers · {itemName}</h3>
        </div>
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
      {groups.map((g) => (
        <div key={g.id} style={{ marginBottom: 14 }}>
          <strong>
            {g.name}
          </strong>{" "}
          <span style={{ color: "var(--muted)" }}>
            (min {g.minSelect} · max {g.maxSelect})
          </span>
          <button
            type="button"
            className="secondary"
            style={{ marginLeft: 8, minHeight: 32 }}
            onClick={() =>
              void api(`/catalog/modifier-groups/${g.id}`, { method: "DELETE" }).then(load)
            }
          >
            Delete group
          </button>
          <ul>
            {g.modifiers
              .filter((m) => m.active)
              .map((m) => (
                <li key={m.id}>
                  {m.name} · {money(m.priceCents)}{" "}
                  <button
                    type="button"
                    className="secondary"
                    style={{ minHeight: 28 }}
                    onClick={() =>
                      void api(`/catalog/modifiers/${m.id}`, { method: "DELETE" }).then(load)
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
          </ul>
        </div>
      ))}
      <form onSubmit={(e) => void addGroup(e)} className="grid-2">
        <div className="field">
          <label>New group name</label>
          <input required value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} />
        </div>
        <div className="field">
          <label>Min / max</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={groupForm.minSelect} onChange={(e) => setGroupForm({ ...groupForm, minSelect: e.target.value })} />
            <input value={groupForm.maxSelect} onChange={(e) => setGroupForm({ ...groupForm, maxSelect: e.target.value })} />
          </div>
        </div>
        <button type="submit">Add group</button>
      </form>
      <form onSubmit={(e) => void addMod(e)} style={{ marginTop: 12 }} className="grid-2">
        <div className="field">
          <label>Group</label>
          <select required value={modForm.groupId} onChange={(e) => setModForm({ ...modForm, groupId: e.target.value })}>
            <option value="">Select…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Modifier name</label>
          <input required value={modForm.name} onChange={(e) => setModForm({ ...modForm, name: e.target.value })} />
        </div>
        <div className="field">
          <label>Price ($)</label>
          <input value={modForm.price} onChange={(e) => setModForm({ ...modForm, price: e.target.value })} />
        </div>
        <button type="submit">Add modifier</button>
      </form>
    </div>
  );
}
