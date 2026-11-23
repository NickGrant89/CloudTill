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
            <label>Amount (£)</label>
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
            <label>Amount (£)</label>
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

interface ModifierSet {
  name: string;
  minSelect: number;
  maxSelect: number;
  options: { name: string; priceCents: number }[];
  assignments: { groupId: string; itemId: string; itemName: string }[];
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
  const [sets, setSets] = useState<ModifierSet[]>([]);
  const [picked, setPicked] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const [nextGroups, nextSets] = await Promise.all([
      api<typeof groups>(`/catalog/items/${itemId}/modifiers`),
      api<ModifierSet[]>("/catalog/modifier-sets"),
    ]);
    setGroups(nextGroups);
    setSets(nextSets);
    setReady(true);
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Could not load modifiers"));
  }, [itemId]);

  const available = sets.filter(
    (set) => !groups.some((group) => group.name.toLowerCase() === set.name.toLowerCase())
  );

  async function moveGroups(index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= groups.length) return;
    const ids = groups.map((group) => group.id);
    const [id] = ids.splice(index, 1);
    ids.splice(next, 0, id);
    setError("");
    try {
      await api(`/catalog/items/${itemId}/modifier-order`, {
        method: "POST",
        body: JSON.stringify({ groupIds: ids }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reorder modifiers");
    }
  }

  async function moveOptions(
    group: (typeof groups)[number],
    index: number,
    dir: -1 | 1
  ) {
    const active = group.modifiers.filter((modifier) => modifier.active);
    const next = index + dir;
    if (next < 0 || next >= active.length) return;
    const ordered = [...active];
    const [row] = ordered.splice(index, 1);
    ordered.splice(next, 0, row);
    const inactive = group.modifiers.filter((modifier) => !modifier.active);
    setError("");
    try {
      await api(`/catalog/modifier-groups/${group.id}/modifier-order`, {
        method: "POST",
        body: JSON.stringify({ modifierIds: [...ordered, ...inactive].map((modifier) => modifier.id) }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reorder options");
    }
  }

  async function saveOption(
    modifier: { id: string; name: string; priceCents: number },
    next: { name: string; price: string }
  ) {
    const name = next.name.trim();
    const pounds = Number(next.price);
    if (!name) {
      setError("Option name is required.");
      return;
    }
    if (!Number.isFinite(pounds)) {
      setError("Price must be a number.");
      return;
    }
    setError("");
    try {
      await api(`/catalog/modifiers/${modifier.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, priceCents: Math.round(pounds * 100) }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save option");
    }
  }

  async function addOption(groupId: string) {
    setError("");
    try {
      await api(`/catalog/modifier-groups/${groupId}/modifiers`, {
        method: "POST",
        body: JSON.stringify({ name: "New option", priceCents: 0 }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add option");
    }
  }

  async function removeOption(id: string) {
    setError("");
    try {
      await api(`/catalog/modifiers/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove option");
    }
  }

  async function addExisting(e: React.FormEvent) {
    e.preventDefault();
    const set = sets.find((entry) => entry.name === picked);
    if (!set) return;
    setError("");
    try {
      await api("/catalog/modifier-sets", {
        method: "POST",
        body: JSON.stringify({
          name: set.name,
          minSelect: set.minSelect,
          maxSelect: set.maxSelect,
          options: set.options,
          itemIds: [itemId],
        }),
      });
      setPicked("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add modifier");
    }
  }

  return (
    <div className="panel-box">
      <div className="page-head" style={{ marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0 }}>Modifiers · {itemName}</h3>
          <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>Change names and prices here. Saving an option only updates this item.</p>
        </div>
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {groups.length === 0 && <p style={{ color: "var(--muted)" }}>No modifiers on this item yet.</p>}
      {groups.map((g, groupIndex) => {
        const active = g.modifiers.filter((m) => m.active);
        return (
        <div key={g.id} style={{ marginBottom: 18 }}>
          <strong>{g.name}</strong>{" "}
          <span style={{ color: "var(--muted)" }}>
            {g.minSelect > 0 ? "Required" : "Optional"} · {g.maxSelect > 1 ? "pick many" : "pick one"}
          </span>
          <button type="button" className="secondary" style={{ marginLeft: 8, minHeight: 32 }} disabled={groupIndex === 0} onClick={() => void moveGroups(groupIndex, -1)}>
            Up
          </button>
          <button type="button" className="secondary" style={{ marginLeft: 6, minHeight: 32 }} disabled={groupIndex === groups.length - 1} onClick={() => void moveGroups(groupIndex, 1)}>
            Down
          </button>
          <button
            type="button"
            className="secondary"
            style={{ marginLeft: 8, minHeight: 32 }}
            onClick={() =>
              void api(`/catalog/modifier-groups/${g.id}`, { method: "DELETE" }).then(load)
            }
          >
            Remove
          </button>
          <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
            {active.map((m, optionIndex) => (
                <li key={m.id} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <input
                    defaultValue={m.name}
                    aria-label={`${g.name} option name`}
                    style={{ flex: "1 1 140px", minWidth: 120 }}
                    onBlur={(e) => {
                      if (e.target.value.trim() === m.name) return;
                      void saveOption(m, { name: e.target.value, price: (m.priceCents / 100).toFixed(2) });
                    }}
                  />
                  <input
                    defaultValue={(m.priceCents / 100).toFixed(2)}
                    aria-label={`${m.name} price`}
                    style={{ width: 96 }}
                    onBlur={(e) => {
                      if (e.target.value.trim() === (m.priceCents / 100).toFixed(2)) return;
                      void saveOption(m, { name: m.name, price: e.target.value });
                    }}
                  />
                  <button type="button" className="secondary" style={{ minHeight: 32 }} disabled={optionIndex === 0} onClick={() => void moveOptions(g, optionIndex, -1)}>
                    Up
                  </button>
                  <button type="button" className="secondary" style={{ minHeight: 32 }} disabled={optionIndex === active.length - 1} onClick={() => void moveOptions(g, optionIndex, 1)}>
                    Down
                  </button>
                  <button type="button" className="secondary" style={{ minHeight: 32 }} onClick={() => void removeOption(m.id)}>
                    Remove
                  </button>
                </li>
              ))}
          </ul>
          <button type="button" className="secondary" style={{ minHeight: 32 }} onClick={() => void addOption(g.id)}>
            Add option
          </button>
        </div>
        );
      })}
      <form onSubmit={(e) => void addExisting(e)} className="grid-2">
        <div className="field">
          <label>Add a modifier</label>
          <select required value={picked} onChange={(e) => setPicked(e.target.value)}>
            <option value="">
              {!ready ? "Loading…" : sets.length === 0 ? "No modifiers yet" : available.length ? "Select a modifier…" : "Already on this item"}
            </option>
            {available.map((set) => (
              <option key={set.name} value={set.name}>
                {set.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={!available.length}>
          Add to {itemName}
        </button>
      </form>
    </div>
  );
}

export function ModifierLibrary({
  items,
  onChange,
}: {
  items: { id: string; name: string }[];
  onChange: () => void;
}) {
  const [sets, setSets] = useState<ModifierSet[]>([]);
  const [selected, setSelected] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [required, setRequired] = useState(true);
  const [pickMany, setPickMany] = useState(false);
  const [options, setOptions] = useState([
    { name: "", price: "0.00" },
    { name: "", price: "0.00" },
  ]);
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [createItemIds, setCreateItemIds] = useState<string[]>([]);
  const [editOptions, setEditOptions] = useState<{ name: string; price: string }[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load(selectName?: string) {
    const next = await api<ModifierSet[]>("/catalog/modifier-sets");
    setSets(next);
    const nameToKeep = selectName ?? selected;
    const match = next.find((set) => set.name === nameToKeep);
    if (match) {
      setSelected(match.name);
      setItemIds(match.assignments.map((assignment) => assignment.itemId));
      setEditOptions(match.options.map((option) => ({ name: option.name, price: (option.priceCents / 100).toFixed(2) })));
    } else if (nameToKeep) {
      setSelected("");
      setItemIds([]);
      setEditOptions([]);
    }
    return next;
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Could not load modifiers"));
  }, []);

  async function moveSetOption(index: number, dir: -1 | 1) {
    if (!selectedSet) return;
    const next = index + dir;
    if (next < 0 || next >= editOptions.length) return;
    const rows = [...editOptions];
    const [row] = rows.splice(index, 1);
    rows.splice(next, 0, row);
    setEditOptions(rows);
    const names = rows.map((option) => option.name.trim()).filter(Boolean);
    if (names.length !== rows.length) return;
    setError("");
    try {
      await api("/catalog/modifier-sets/order", {
        method: "POST",
        body: JSON.stringify({ name: selectedSet.name, optionNames: names }),
      });
      await load(selectedSet.name);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reorder options");
    }
  }

  function toggle(list: string[], id: string, setList: (next: string[]) => void) {
    setList(list.includes(id) ? list.filter((itemId) => itemId !== id) : [...list, id]);
  }

  async function createSet(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    const cleaned = options
      .map((option) => ({ name: option.name.trim(), priceCents: Math.round(parseFloat(option.price || "0") * 100) }))
      .filter((option) => option.name);
    if (!cleaned.length) {
      setError("Add at least one option.");
      return;
    }
    if (!createItemIds.length) {
      setError("Choose at least one item.");
      return;
    }
    try {
      const result = await api<{ created: { itemName: string }[]; skipped: string[] }>("/catalog/modifier-sets", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          minSelect: required ? 1 : 0,
          maxSelect: pickMany ? Math.max(cleaned.length, 1) : 1,
          options: cleaned,
          itemIds: createItemIds,
        }),
      });
      const createdName = name.trim();
      setName("");
      setOptions([
        { name: "", price: "0.00" },
        { name: "", price: "0.00" },
      ]);
      setCreating(false);
      setCreateItemIds([]);
      setNotice(
        result.skipped.length
          ? `Assigned to ${result.created.length}. Already on ${result.skipped.join(", ")}.`
          : `Assigned to ${result.created.map((row) => row.itemName).join(", ")}.`
      );
      await load(createdName);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create modifiers");
    }
  }

  function chooseSet(name: string) {
    setSelected(name);
    setError("");
    setNotice("");
    const set = sets.find((entry) => entry.name === name);
    setItemIds(set ? set.assignments.map((assignment) => assignment.itemId) : []);
    setEditOptions(
      set ? set.options.map((option) => ({ name: option.name, price: (option.priceCents / 100).toFixed(2) })) : []
    );
  }

  async function saveOptions(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSet) return;
    const cleaned = editOptions
      .map((option) => ({ name: option.name.trim(), priceCents: Math.round(Number(option.price) * 100) }))
      .filter((option) => option.name);
    if (!cleaned.length) {
      setError("Add at least one option.");
      return;
    }
    if (cleaned.some((option) => !Number.isFinite(option.priceCents))) {
      setError("Every option needs a price.");
      return;
    }
    setError("");
    setNotice("");
    try {
      await api("/catalog/modifier-sets", {
        method: "PATCH",
        body: JSON.stringify({
          name: selectedSet.name,
          minSelect: selectedSet.minSelect,
          maxSelect: selectedSet.maxSelect,
          options: cleaned,
        }),
      });
      setNotice(`Updated ${selectedSet.name} on every item that uses it.`);
      await load(selectedSet.name);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save options");
    }
  }

  async function saveAssignment(e: React.FormEvent) {
    e.preventDefault();
    const set = sets.find((entry) => entry.name === selected);
    if (!set) {
      setError("Select a modifier.");
      return;
    }
    setError("");
    setNotice("");
    const current = new Set(set.assignments.map((assignment) => assignment.itemId));
    const next = new Set(itemIds);
    const toAdd = itemIds.filter((id) => !current.has(id));
    const toRemove = set.assignments.filter((assignment) => !next.has(assignment.itemId));
    if (!toAdd.length && !toRemove.length) {
      setNotice(`${set.name} is already set that way.`);
      return;
    }
    try {
      if (toAdd.length) {
        await api("/catalog/modifier-sets", {
          method: "POST",
          body: JSON.stringify({
            name: set.name,
            minSelect: set.minSelect,
            maxSelect: set.maxSelect,
            options: set.options,
            itemIds: toAdd,
          }),
        });
      }
      for (const assignment of toRemove) {
        await api(`/catalog/modifier-groups/${assignment.groupId}`, { method: "DELETE" });
      }
      setNotice(`${set.name} updated.`);
      await load(set.name);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not assign modifiers");
    }
  }

  async function unassign(groupId: string) {
    setError("");
    try {
      await api(`/catalog/modifier-groups/${groupId}`, { method: "DELETE" });
      await load();
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove modifiers");
    }
  }

  const selectedSet = sets.find((set) => set.name === selected);

  return (
    <div className="modifier-layout">
      <aside className="modifier-menu" aria-label="Modifier menus">
        <div className="modifier-menu-head">
          <strong>Menus</strong>
          <button type="button" className="secondary" onClick={() => setCreating((open) => !open)}>
            {creating ? "Close" : "New"}
          </button>
        </div>
        {sets.length === 0 && <p className="modifier-menu-empty">No modifiers yet</p>}
        {sets.map((set) => (
          <button
            key={set.name}
            type="button"
            className={`modifier-menu-btn${selected === set.name ? " active" : ""}`}
            onClick={() => {
              setCreating(false);
              chooseSet(set.name);
            }}
          >
            <span>{set.name}</span>
            <span className="modifier-menu-meta">{set.assignments.length}</span>
          </button>
        ))}
      </aside>

      <div className="panel-box modifier-detail">
        {error && <p className="error">{error}</p>}
        {notice && <p style={{ color: "var(--ok, #2f6f4e)" }}>{notice}</p>}

        {creating ? (
          <form onSubmit={(e) => void createSet(e)}>
            <h3 style={{ marginTop: 0 }}>New modifier</h3>
            <div className="grid-2">
              <div className="field">
                <label>Name</label>
                <input required value={name} placeholder="Size, Milk, Extras" onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <label>How it works</label>
                <div style={{ display: "flex", gap: 16, minHeight: 42, alignItems: "center" }}>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
                    Required
                  </label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" checked={pickMany} onChange={(e) => setPickMany(e.target.checked)} />
                    Allow more than one
                  </label>
                </div>
              </div>
            </div>
            <div className="field">
              <label>Options</label>
              {options.map((option, index) => (
                <div key={index} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input
                    placeholder="Option name"
                    value={option.name}
                    onChange={(e) =>
                      setOptions((rows) => rows.map((row, i) => (i === index ? { ...row, name: e.target.value } : row)))
                    }
                  />
                  <input
                    style={{ maxWidth: 120 }}
                    placeholder="0.00"
                    value={option.price}
                    onChange={(e) =>
                      setOptions((rows) => rows.map((row, i) => (i === index ? { ...row, price: e.target.value } : row)))
                    }
                  />
                </div>
              ))}
              <button
                type="button"
                className="secondary"
                onClick={() => setOptions((rows) => [...rows, { name: "", price: "0.00" }])}
              >
                Add option
              </button>
            </div>
            <div className="field">
              <label>Assign to items</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {items.map((item) => (
                  <label key={item.id} className="badge" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={createItemIds.includes(item.id)}
                      onChange={() => toggle(createItemIds, item.id, setCreateItemIds)}
                    />
                    {item.name}
                  </label>
                ))}
              </div>
            </div>
            <button type="submit">Create and assign</button>
          </form>
        ) : selectedSet ? (
          <form onSubmit={(e) => void saveAssignment(e)}>
            <h3 style={{ marginTop: 0 }}>{selectedSet.name}</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {selectedSet.minSelect > 0 ? "Required" : "Optional"} · {selectedSet.maxSelect > 1 ? "pick many" : "pick one"}
            </p>
            <p style={{ marginTop: 0 }}>
              Change names and prices, then Save options. That updates every item that uses {selectedSet.name}. Up and Down set the till order.
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 14px" }}>
              {editOptions.map((option, index) => (
                <li key={`edit-${index}`} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <input
                    value={option.name}
                    placeholder="Option name"
                    style={{ flex: "1 1 140px", minWidth: 120 }}
                    onChange={(e) =>
                      setEditOptions((rows) => rows.map((row, i) => (i === index ? { ...row, name: e.target.value } : row)))
                    }
                  />
                  <input
                    value={option.price}
                    placeholder="0.00"
                    style={{ width: 96 }}
                    onChange={(e) =>
                      setEditOptions((rows) => rows.map((row, i) => (i === index ? { ...row, price: e.target.value } : row)))
                    }
                  />
                  <button type="button" className="secondary" style={{ minHeight: 32 }} disabled={index === 0} onClick={() => void moveSetOption(index, -1)}>
                    Up
                  </button>
                  <button type="button" className="secondary" style={{ minHeight: 32 }} disabled={index === editOptions.length - 1} onClick={() => void moveSetOption(index, 1)}>
                    Down
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    style={{ minHeight: 32 }}
                    onClick={() => setEditOptions((rows) => rows.filter((_, i) => i !== index))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              <button type="button" className="secondary" onClick={() => setEditOptions((rows) => [...rows, { name: "", price: "0.00" }])}>
                Add option
              </button>
              <button type="button" onClick={(e) => void saveOptions(e)}>
                Save options
              </button>
            </div>
            <div className="field">
              <label>Items</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {items.map((item) => (
                  <label key={item.id} className="badge" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={itemIds.includes(item.id)}
                      onChange={() => toggle(itemIds, item.id, setItemIds)}
                    />
                    {item.name}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {selectedSet.assignments.map((assignment) => (
                <button
                  key={assignment.groupId}
                  type="button"
                  className="secondary"
                  style={{ minHeight: 32 }}
                  onClick={() => void unassign(assignment.groupId)}
                >
                  {assignment.itemName} ×
                </button>
              ))}
            </div>
            <button type="submit">Save {selectedSet.name}</button>
          </form>
        ) : (
          <p style={{ color: "var(--muted)", margin: 0 }}>
            Select a modifier from the left menu, or create a new one.
          </p>
        )}
      </div>
    </div>
  );
}
