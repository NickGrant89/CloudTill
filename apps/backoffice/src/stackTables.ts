/** Mark back-office tables so phone CSS can stack each row as a card. */

function headersFor(table: HTMLTableElement) {
  return [...table.querySelectorAll("thead th")].map((th) =>
    (th.textContent || "").replace(/\s+/g, " ").trim()
  );
}

function enhanceTable(table: HTMLTableElement) {
  if (table.classList.contains("reports-table") || table.closest(".reports-table-wrap")) return;
  if (table.closest(".modifier-option-list, .modifier-item-list, .sr-only")) return;

  const wrap = table.closest(".table-wrap");
  if (wrap) wrap.classList.add("stack-cards");
  else table.classList.add("stack-orphan");

  table.classList.add("stack-on-phone");

  const headers = headersFor(table);
  table.querySelectorAll("tbody tr").forEach((tr) => {
    const cells = [...tr.children] as HTMLTableCellElement[];
    if (cells.length === 1 && (cells[0]?.colSpan ?? 1) > 1) {
      tr.classList.add("stack-empty");
      return;
    }
    tr.classList.remove("stack-empty");
    cells.forEach((td, index) => {
      const label = headers[index] ?? "";
      td.setAttribute("data-label", label);
      td.classList.remove("stack-select", "stack-title", "stack-actions");
      const hasCheckbox = Boolean(td.querySelector('input[type="checkbox"]'));
      const hasActions = Boolean(td.querySelector("button, a"));
      const text = (td.textContent || "").replace(/\s+/g, " ").trim();
      if (hasCheckbox && text.length <= 1) {
        td.classList.add("stack-select");
      } else if (!label && hasActions) {
        td.classList.add("stack-actions");
      }
    });
    const title = cells.find(
      (td) => !td.classList.contains("stack-select") && !td.classList.contains("stack-actions")
    );
    title?.classList.add("stack-title");
  });
}

export function enhanceBackOfficeTables(root: ParentNode | null | undefined) {
  if (!root) return;
  root.querySelectorAll("table").forEach((table) => enhanceTable(table as HTMLTableElement));
}

export function watchBackOfficeTables(root: HTMLElement | null) {
  if (!root || typeof MutationObserver === "undefined") {
    enhanceBackOfficeTables(root);
    return () => undefined;
  }
  let frame = 0;
  const run = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => enhanceBackOfficeTables(root));
  };
  run();
  const observer = new MutationObserver(run);
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
  };
}
