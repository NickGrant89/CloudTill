import { halfAndHalfWizardStepForGroup, isConsolidatedPizzaItem, isHalfAndHalfWizardItem } from "@cloudtill/shared";
import { money } from "./api";

export type OptionsBarChip = { key: string; label: string; value: string };

const BAR_STEP_LABEL: Record<"size" | "base" | "sauce", string> = {
  size: "Size",
  base: "Base",
  sauce: "Sauce",
};

/** Size / base / sauce picks for the slim bottom bar (not full topping lists). */
export function compactTillOptionBarChips(
  itemName: string,
  mods: { name: string; groupName?: string }[]
): OptionsBarChip[] {
  if (!mods.length) return [];
  const steps = ["size", "base", "sauce"] as const;
  const chips: OptionsBarChip[] = [];
  for (const step of steps) {
    const pick = mods.find(
      (m) => m.groupName && halfAndHalfWizardStepForGroup(m.groupName) === step
    );
    if (pick) chips.push({ key: step, label: BAR_STEP_LABEL[step], value: pick.name });
  }
  if (chips.length || !isConsolidatedPizzaItem(itemName) || isHalfAndHalfWizardItem(itemName)) {
    return chips;
  }
  for (const step of steps) {
    const pick = mods.find((m) => {
      if (!m.groupName) return false;
      const role = m.groupName.trim().toLowerCase();
      if (step === "size") return role === "size";
      if (step === "base") return role.includes("base");
      if (step === "sauce") return role.includes("sauce");
      return false;
    });
    if (pick) chips.push({ key: step, label: BAR_STEP_LABEL[step], value: pick.name });
  }
  return chips;
}

type Props = {
  itemName: string;
  mods: { name: string; groupName?: string }[];
  totalCents: number;
  editingLineKey: string | null;
  onConfirm: () => void;
};

export function OptionsPickerBottomBar({ itemName, mods, totalCents, editingLineKey, onConfirm }: Props) {
  const chips = compactTillOptionBarChips(itemName, mods);
  return (
    <div className="options-bottom-bar" role="region" aria-label="Selected options summary">
      <div className="options-bottom-bar-summary">
        {chips.length === 0 ? (
          <span className="options-bottom-bar-empty">Pick options above</span>
        ) : (
          chips.map((chip) => (
            <span key={chip.key} className="options-bottom-bar-chip" title={`${chip.label}: ${chip.value}`}>
              <span className="options-bottom-bar-label">{chip.label}</span>
              <span className="options-bottom-bar-value">{chip.value}</span>
            </span>
          ))
        )}
      </div>
      <button type="button" className="pay-btn options-bottom-bar-add" onClick={onConfirm}>
        {editingLineKey ? "Update" : "Add"} {money(totalCents)}
      </button>
    </div>
  );
}