import { useEffect, useRef, useState } from "react";
import { api, money } from "./api";

function applyReorder<T>(list: T[], from: number, to: number): T[] | null {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return null;
  const next = [...list];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row!);
  return next;
}

/** Pointer drag grip — works on iPad (HTML5 drag-and-drop does not). */
function DragGrip({
  index,
  listLength,
  group,
  label,
  onDrop,
}: {
  index: number;
  listLength: number;
  group: string;
  label: string;
  onDrop: (from: number, to: number) => void;
}) {
  const drag = useRef<{ from: number; over: number } | null>(null);

  function clearMarks() {
    document.querySelectorAll(`[data-drag-group="${group}"] .drag-over`).forEach((node) => {
      node.classList.remove("drag-over");
    });
  }

  return (
    <button
      type="button"
      className="drag-grip"
      aria-label={`Drag to reorder ${label}`}
      title="Drag to reorder"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { from: index, over: index };
        e.currentTarget.classList.add("is-dragging");
      }}
      onPointerMove={(e) => {
        const state = drag.current;
        if (!state) return;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const row = el?.closest(`[data-drag-group="${group}"] [data-drag-index]`) as HTMLElement | null;
        if (!row) return;
        const over = Number(row.getAttribute("data-drag-index"));
        if (!Number.isFinite(over) || over < 0 || over >= listLength || over === state.over) return;
        state.over = over;
        clearMarks();
        row.classList.add("drag-over");
      }}
      onPointerUp={(e) => {
        const state = drag.current;
        drag.current = null;
        e.currentTarget.classList.remove("is-dragging");
        clearMarks();
        if (!state || state.from === state.over) return;
        onDrop(state.from, state.over);
      }}
      onPointerCancel={(e) => {
        drag.current = null;
        e.currentTarget.classList.remove("is-dragging");
        clearMarks();
      }}
    >
      ⋮⋮
    </button>
  );
}

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
  folder?: string;
  minSelect: number;
  maxSelect: number;
  options: { name: string; priceCents: number }[];
  assignments: { groupId: string; itemId: string; itemName: string }[];
}

function folderForSet(set: ModifierSet): string {
  return (set.folder || "General").trim() || "General";
}

type ModifierSetsResponse = {
  sets: ModifierSet[];
  folderOrder: string[];
  menuOrder: string[];
};

async function fetchModifierSets(): Promise<ModifierSetsResponse> {
  const raw = await api<ModifierSet[] | ModifierSetsResponse>("/catalog/modifier-sets");
  if (Array.isArray(raw)) {
    return {
      sets: raw,
      folderOrder: [...new Set(raw.map(folderForSet))],
      menuOrder: raw.map((set) => set.name),
    };
  }
  return {
    sets: Array.isArray(raw.sets) ? raw.sets : [],
    folderOrder: Array.isArray(raw.folderOrder) ? raw.folderOrder : [],
    menuOrder: Array.isArray(raw.menuOrder) ? raw.menuOrder : [],
  };
}

function ItemChecklist({
  items,
  selectedIds,
  onToggle,
  label,
}: {
  items: { id: string; name: string }[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  label: string;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = q
    ? items.filter((item) => item.name.toLowerCase().includes(q))
    : items;
  const selected = selectedIds.length;
  return (
    <div className="field">
      <label>{label}</label>
      <input
        placeholder="Search items…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <p style={{ margin: "0 0 8px", color: "var(--muted)", fontSize: "0.88rem" }}>
        {selected} selected · {visible.length} shown
        {q ? ` of ${items.length}` : ""}
      </p>
      <div className="modifier-item-list">
        {visible.length === 0 && <p style={{ color: "var(--muted)", margin: 8 }}>No items match.</p>}
        {visible.map((item) => (
          <label key={item.id} className="modifier-item-row">
            <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => onToggle(item.id)} />
            <span>{item.name}</span>
          </label>
        ))}
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
  const [sets, setSets] = useState<ModifierSet[]>([]);
  const [picked, setPicked] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const [nextGroups, nextSets] = await Promise.all([
      api<typeof groups>(`/catalog/items/${itemId}/modifiers`),
      fetchModifierSets(),
    ]);
    setGroups(nextGroups);
    setSets(nextSets.sets);
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
                    Move up
                  </button>
                  <button type="button" className="secondary" style={{ minHeight: 32 }} disabled={optionIndex === active.length - 1} onClick={() => void moveOptions(g, optionIndex, 1)}>
                    Move down
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
  const [folderOrder, setFolderOrder] = useState<string[]>([]);
  const [menuOrder, setMenuOrder] = useState<string[]>([]);
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
  const [editSetName, setEditSetName] = useState("");
  const [editFolder, setEditFolder] = useState("General");
  const [customFolder, setCustomFolder] = useState("");
  const [addingFolder, setAddingFolder] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load(selectName?: string) {
    const next = await fetchModifierSets();
    setSets(next.sets);
    setFolderOrder(next.folderOrder);
    setMenuOrder(next.menuOrder);
    const nameToKeep = selectName ?? selected;
    const match = next.sets.find((set) => set.name === nameToKeep);
    if (match) {
      setSelected(match.name);
      setEditSetName(match.name);
      setItemIds(match.assignments.map((assignment) => assignment.itemId));
      setEditOptions(match.options.map((option) => ({ name: option.name, price: (option.priceCents / 100).toFixed(2) })));
      setEditFolder(folderForSet(match));
      setCustomFolder("");
      setAddingFolder(false);
    } else if (nameToKeep) {
      setSelected("");
      setEditSetName("");
      setItemIds([]);
      setEditOptions([]);
      setEditFolder("General");
      setCustomFolder("");
      setAddingFolder(false);
    }
    return next;
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Could not load modifiers"));
  }, []);

  async function reorderSetOptions(from: number, to: number) {
    if (!selectedSet) return;
    const rows = applyReorder(editOptions, from, to);
    if (!rows) return;
    setEditOptions(rows);
    const names = rows.map((option) => option.name.trim()).filter(Boolean);
    if (names.length !== rows.length) return;
    setError("");
    try {
      await api("/catalog/modifier-sets/order", {
        method: "POST",
        body: JSON.stringify({ name: selectedSet.name, optionNames: names }),
      });
      setNotice("Option order saved — till and online menu use this order.");
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
    setEditSetName(set?.name ?? name);
    setItemIds(set ? set.assignments.map((assignment) => assignment.itemId) : []);
    setEditOptions(
      set ? set.options.map((option) => ({ name: option.name, price: (option.priceCents / 100).toFixed(2) })) : []
    );
    setEditFolder(set ? folderForSet(set) : "General");
    setCustomFolder("");
    setAddingFolder(false);
  }

  function menusInFolder(folder: string) {
    const inFolder = sets.filter((set) => folderForSet(set) === folder).map((set) => set.name);
    if (!menuOrder.length) return inFolder;
    const rank = new Map(menuOrder.map((name, index) => [name.toLowerCase(), index]));
    return [...inFolder].sort((a, b) => {
      const ra = rank.has(a.toLowerCase()) ? rank.get(a.toLowerCase())! : 10_000;
      const rb = rank.has(b.toLowerCase()) ? rank.get(b.toLowerCase())! : 10_000;
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b);
    });
  }

  async function saveLayout(payload: {
    folderOrder?: string[];
    menuOrder?: string[];
    renameFolder?: { from: string; to: string };
    renameSet?: { from: string; to: string };
  }) {
    setError("");
    await api("/catalog/modifier-sets/layout", {
      method: "PATCH",
      body: JSON.stringify({ ...payload, syncTillOrder: true }),
    });
  }

  async function reorderFolders(from: number, to: number) {
    const next = applyReorder(folderNames, from, to);
    if (!next) return;
    try {
      await saveLayout({ folderOrder: next });
      setNotice("Group order updated — till follows folder order (e.g. Size before Pizza).");
      await load(selected || undefined);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reorder groups");
    }
  }

  async function reorderMenus(folder: string, from: number, to: number) {
    const inFolder = menusInFolder(folder);
    const swapped = applyReorder(inFolder, from, to);
    if (!swapped) return;
    const nextMenu: string[] = [];
    for (const folderName of folderNames) {
      const names = folderName === folder ? swapped : menusInFolder(folderName);
      for (const name of names) {
        if (!nextMenu.some((entry) => entry.toLowerCase() === name.toLowerCase())) nextMenu.push(name);
      }
    }
    for (const name of menuOrder) {
      if (!nextMenu.some((entry) => entry.toLowerCase() === name.toLowerCase())) nextMenu.push(name);
    }
    try {
      await saveLayout({ menuOrder: nextMenu, folderOrder: folderNames });
      setNotice("Menu order saved — till and tickets follow this order.");
      await load(selected || undefined);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reorder menus");
    }
  }

  async function renameFolder(from: string, to: string) {
    const cleaned = to.trim();
    if (!cleaned || cleaned.toLowerCase() === from.toLowerCase()) {
      setRenamingFolder(null);
      return;
    }
    try {
      await saveLayout({ renameFolder: { from, to: cleaned }, folderOrder: folderNames.map((name) => (name === from ? cleaned : name)) });
      setRenamingFolder(null);
      setRenameFolderValue("");
      setNotice(`Renamed group to ${cleaned}.`);
      await load(selected || undefined);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename group");
    }
  }

  async function renameSelectedSet() {
    if (!selectedSet) return;
    const cleaned = editSetName.trim();
    if (!cleaned) {
      setError("Menu name is required.");
      return;
    }
    if (cleaned.toLowerCase() === selectedSet.name.toLowerCase()) return;
    try {
      await saveLayout({ renameSet: { from: selectedSet.name, to: cleaned } });
      setNotice(`Renamed to ${cleaned} on the till and tickets.`);
      await load(cleaned);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename menu");
    }
  }

  async function saveFolder(folder: string) {
    if (!selectedSet) return;
    const cleaned = folder.trim();
    if (!cleaned) return;
    setError("");
    try {
      await api("/catalog/modifier-sets/folder", {
        method: "PATCH",
        body: JSON.stringify({ name: selectedSet.name, folder: cleaned }),
      });
      setEditFolder(cleaned);
      setCustomFolder("");
      setAddingFolder(false);
      setNotice(`${selectedSet.name} moved to ${cleaned}.`);
      await load(selectedSet.name);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move modifier");
    }
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
  const discoveredFolders = [...new Set(sets.map(folderForSet))];
  const folderNames = (() => {
    const ordered = folderOrder.filter((name) =>
      discoveredFolders.some((folder) => folder.toLowerCase() === name.toLowerCase())
    );
    for (const name of discoveredFolders) {
      if (!ordered.some((folder) => folder.toLowerCase() === name.toLowerCase())) ordered.push(name);
    }
    return ordered;
  })();
  const knownFolders = Array.from(new Set(["General", "Pizza", "Burgers", ...folderNames]));

  return (
    <div className="modifier-layout">
      <aside className="modifier-menu" aria-label="modifier menus">
        <div className="modifier-menu-head">
          <strong>Menus</strong>
          <button type="button" className="secondary" onClick={() => setCreating((open) => !open)}>
            {creating ? "Close" : "New"}
          </button>
        </div>
        <p className="modifier-menu-empty" style={{ marginTop: 0 }}>
          Drag ⋮⋮ to reorder groups and menus. Rename keeps the group name clear.
        </p>
        {sets.length === 0 && <p className="modifier-menu-empty">No modifiers yet</p>}
        <div data-drag-group="folders" className="modifier-folder-list">
          {folderNames.map((folder, folderIndex) => {
            const rows = menusInFolder(folder);
            const collapsed = Boolean(collapsedFolders[folder]);
            return (
              <div key={folder} className="modifier-folder" data-drag-index={folderIndex}>
                <div className="modifier-folder-bar">
                  {renamingFolder === folder ? (
                    <>
                      <input
                        value={renameFolderValue}
                        onChange={(e) => setRenameFolderValue(e.target.value)}
                        aria-label="Group name"
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      <button type="button" className="secondary" style={{ minHeight: 32 }} onClick={() => void renameFolder(folder, renameFolderValue)}>
                        Save
                      </button>
                      <button type="button" className="secondary" style={{ minHeight: 32 }} onClick={() => setRenamingFolder(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      {folderNames.length > 1 && (
                        <DragGrip
                          index={folderIndex}
                          listLength={folderNames.length}
                          group="folders"
                          label={folder}
                          onDrop={(from, to) => void reorderFolders(from, to)}
                        />
                      )}
                      <button
                        type="button"
                        className="modifier-folder-head"
                        onClick={() => setCollapsedFolders((prev) => ({ ...prev, [folder]: !prev[folder] }))}
                      >
                        <span>
                          {collapsed ? "▸" : "▾"} {folder}
                        </span>
                        <span className="modifier-menu-meta">{rows.length}</span>
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        style={{ minHeight: 32 }}
                        onClick={() => {
                          setRenamingFolder(folder);
                          setRenameFolderValue(folder);
                        }}
                      >
                        Rename
                      </button>
                    </>
                  )}
                </div>
                {!collapsed && (
                  <div data-drag-group={`menus:${folder}`} className="modifier-menu-list">
                    {rows.map((setName, menuIndex) => {
                      const set = sets.find((entry) => entry.name === setName);
                      if (!set) return null;
                      return (
                        <div key={set.name} className="modifier-menu-row" data-drag-index={menuIndex}>
                          {rows.length > 1 && (
                            <DragGrip
                              index={menuIndex}
                              listLength={rows.length}
                              group={`menus:${folder}`}
                              label={set.name}
                              onDrop={(from, to) => void reorderMenus(folder, from, to)}
                            />
                          )}
                          <button
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
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
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
            <ItemChecklist
              items={items}
              selectedIds={createItemIds}
              onToggle={(id) => toggle(createItemIds, id, setCreateItemIds)}
              label="Assign to items"
            />
            <button type="submit">Create and assign</button>
          </form>
        ) : selectedSet ? (
          <form onSubmit={(e) => void saveAssignment(e)}>
            <div className="field">
              <label htmlFor="modifier-set-name">Menu name (till & ticket)</label>
              <div className="modifier-folder-pick">
                <input
                  id="modifier-set-name"
                  value={editSetName}
                  onChange={(e) => setEditSetName(e.target.value)}
                  onBlur={() => void renameSelectedSet()}
                />
                <button type="button" className="secondary" onClick={() => void renameSelectedSet()}>
                  Save name
                </button>
              </div>
            </div>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {selectedSet.minSelect > 0 ? "Required" : "Optional"} · {selectedSet.maxSelect > 1 ? "pick many" : "pick one"}
            </p>
            <div className="field">
              <label htmlFor="modifier-folder">Group</label>
              <div className="modifier-folder-pick">
                <select
                  id="modifier-folder"
                  value={addingFolder ? "__custom" : editFolder}
                  onChange={(e) => {
                    if (e.target.value === "__custom") {
                      setAddingFolder(true);
                      setCustomFolder("");
                      return;
                    }
                    void saveFolder(e.target.value);
                  }}
                >
                  {knownFolders.map((folder) => (
                    <option key={folder} value={folder}>
                      {folder}
                    </option>
                  ))}
                  <option value="__custom">New group…</option>
                </select>
                {addingFolder && (
                  <>
                    <input
                      placeholder="Group name"
                      value={customFolder}
                      onChange={(e) => setCustomFolder(e.target.value)}
                    />
                    <button type="button" className="secondary" onClick={() => void saveFolder(customFolder)}>
                      Save group
                    </button>
                  </>
                )}
              </div>
              <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: "0.88rem" }}>
                Group is the folder on the left. Rename it there, or move this menu into another group.
              </p>
            </div>
            <p style={{ marginTop: 0 }}>
              Change names and prices, then Save options. That updates every item that uses {selectedSet.name}.
            </p>
            <p style={{ marginTop: 0, color: "var(--muted)" }}>
              Drag ⋮⋮ to set the order on the till and online menu. Edit the name in the box (that is rename).
            </p>
            <ul className="modifier-option-list" data-drag-group="options">
              {editOptions.map((option, index) => (
                <li key={`edit-${index}`} className="modifier-option-row" data-drag-index={index}>
                  <div className="modifier-option-fields">
                    {editOptions.length > 1 && (
                      <DragGrip
                        index={index}
                        listLength={editOptions.length}
                        group="options"
                        label={option.name || `option ${index + 1}`}
                        onDrop={(from, to) => void reorderSetOptions(from, to)}
                      />
                    )}
                    <input
                      value={option.name}
                      placeholder="Option name"
                      aria-label={`Option ${index + 1} name`}
                      onChange={(e) =>
                        setEditOptions((rows) => rows.map((row, i) => (i === index ? { ...row, name: e.target.value } : row)))
                      }
                    />
                    <input
                      value={option.price}
                      placeholder="0.00"
                      aria-label={`${option.name || `Option ${index + 1}`} price`}
                      className="modifier-option-price"
                      onChange={(e) =>
                        setEditOptions((rows) => rows.map((row, i) => (i === index ? { ...row, price: e.target.value } : row)))
                      }
                    />
                  </div>
                  <div className="modifier-option-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setEditOptions((rows) => rows.filter((_, i) => i !== index))}
                    >
                      Remove
                    </button>
                  </div>
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
            <ItemChecklist
              items={items}
              selectedIds={itemIds}
              onToggle={(id) => toggle(itemIds, id, setItemIds)}
              label="Items"
            />
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
