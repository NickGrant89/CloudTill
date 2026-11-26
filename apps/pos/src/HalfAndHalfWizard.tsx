import {
  HALF_AND_HALF_WIZARD_STEPS,
  halfAndHalfColumnGroupsForSide,
  halfAndHalfColumnTailGroupsForSide,
  halfAndHalfExtrasRowLabel,
  halfAndHalfSharedTailGroups,
  halfAndHalfMergedColumnOptions,
  halfAndHalfSauceGroups,
  halfAndHalfStepSatisfied,
  halfAndHalfWizardGroupLabel,
  halfAndHalfWizardStepForGroup,
  isHalfAndHalfSauceGroup,
  isHalfAndHalfWizardItem,
  isConsolidatedPizzaItem,
  modifierListPriceCents,
  pizzaSizeInchesFromSelection,
  visiblePizzaModifierGroups,
  withLinkedHalfAndHalfSauces,
  type HalfAndHalfWizardStepId,
} from "@cloudtill/shared";
import { useEffect, useMemo, useState } from "react";
import { money } from "./api";
import { ModifierOptionButton } from "./ModifierOptionButton";

interface Modifier {
  id: string;
  name: string;
  priceCents: number;
}

interface ModGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  freeSelect: number;
  modifiers: Modifier[];
}

interface WizardItem {
  id: string;
  name: string;
  color: string;
  variants: { priceCents: number }[];
  modifierGroups: ModGroup[];
}

type ModifierPreview = { name: string; groupName: string };

function firstIncompleteStep(
  steps: HalfAndHalfWizardStepId[],
  visibleGroups: ModGroup[],
  selected: Record<string, Modifier[]>,
  sauceLinked: boolean
): number {
  for (let i = 0; i < steps.length; i++) {
    const stepId = steps[i]!;
    if (
      !halfAndHalfStepSatisfied({
        stepId,
        visibleGroups,
        selected,
        sauceLinked,
      })
    ) {
      return i;
    }
  }
  return Math.max(0, steps.length - 1);
}

function modifierPriceLabel(
  selected: boolean,
  listPrice: number,
  chargedCents: number | undefined
): string {
  if (!listPrice) return "Included";
  if (selected && chargedCents === 0) return "Included";
  if (selected && chargedCents !== undefined) return `+${money(chargedCents)}`;
  return `+${money(listPrice)}`;
}

export function HalfAndHalfWizard(props: {
  item: WizardItem;
  visibleGroups: ModGroup[];
  selectedMods: Record<string, Modifier[]>;
  modifierPreview: ModifierPreview[];
  modifierTotal: number;
  editingLineKey: string | null;
  chargedByModifierId: Map<string, number>;
  onChoose: (group: ModGroup, modifier: Modifier) => void;
  onSetMods: (next: Record<string, Modifier[]>) => void;
  onClose: () => void;
  onConfirm: () => void;
  onSauceLinkedChange?: (linked: boolean) => void;
  renderPreview: (stepId: HalfAndHalfWizardStepId) => React.ReactNode;
}) {
  const {
    item,
    visibleGroups,
    selectedMods,
    modifierPreview,
    modifierTotal,
    editingLineKey,
    chargedByModifierId,
    onChoose,
    onSetMods,
    onClose,
    onConfirm,
    onSauceLinkedChange,
    renderPreview,
  } = props;

  const activeSteps = useMemo(() => {
    return HALF_AND_HALF_WIZARD_STEPS.filter((step) =>
      visibleGroups.some((g) => halfAndHalfWizardStepForGroup(g.name) === step.id)
    );
  }, [visibleGroups]);

  const stepIds = useMemo(() => activeSteps.map((s) => s.id), [activeSteps]);

  const [stepIndex, setStepIndex] = useState(() =>
    firstIncompleteStep(stepIds, visibleGroups, selectedMods, true)
  );
  const [sauceLinked, setSauceLinked] = useState(true);

  useEffect(() => {
    onSauceLinkedChange?.(sauceLinked);
  }, [sauceLinked, onSauceLinkedChange]);

  const sauceVisibleGroups = useMemo(
    () => visiblePizzaModifierGroups(item.name, item.modifierGroups, selectedMods),
    [item.modifierGroups, item.name, selectedMods]
  );

  const { left: sauceLeft, right: sauceRight } = useMemo(
    () => halfAndHalfSauceGroups(sauceVisibleGroups),
    [sauceVisibleGroups]
  );

  useEffect(() => {
    if (stepIndex >= activeSteps.length) setStepIndex(Math.max(0, activeSteps.length - 1));
  }, [activeSteps.length, stepIndex]);

  useEffect(() => {
    const need = firstIncompleteStep(stepIds, visibleGroups, selectedMods, sauceLinked);
    if (need > stepIndex) setStepIndex(need);
  }, [visibleGroups, selectedMods, stepIds, stepIndex, sauceLinked]);

  const currentStep = activeSteps[stepIndex];
  const stepGroups = useMemo(() => {
    if (!currentStep) return [];
    return visibleGroups.filter((g) => halfAndHalfWizardStepForGroup(g.name) === currentStep.id);
  }, [visibleGroups, currentStep]);

  const halvesSharedTail = useMemo(
    () => (currentStep?.id === "halves" ? halfAndHalfSharedTailGroups(stepGroups) : []),
    [currentStep, stepGroups]
  );

  function stepComplete(stepId: HalfAndHalfWizardStepId): boolean {
    return halfAndHalfStepSatisfied({
      stepId,
      visibleGroups,
      selected: selectedMods,
      sauceLinked,
    });
  }

  useEffect(() => {
    if (!currentStep || currentStep.id === "halves") return;
    if (currentStep.id === "sauce" && !sauceLinked) return;
    if (!stepComplete(currentStep.id) || stepIndex >= activeSteps.length - 1) return;
    const timer = window.setTimeout(() => setStepIndex((i) => Math.min(activeSteps.length - 1, i + 1)), 150);
    return () => window.clearTimeout(timer);
  }, [selectedMods, currentStep, stepIndex, activeSteps.length, sauceLinked, visibleGroups]);

  const sizeInches = isConsolidatedPizzaItem(item.name)
    ? pizzaSizeInchesFromSelection(item.modifierGroups, selectedMods)
    : null;

  useEffect(() => {
    if (!sauceLinked) return;
    const synced = withLinkedHalfAndHalfSauces(sauceVisibleGroups, selectedMods, true);
    if (synced !== selectedMods) onSetMods(synced);
  }, [sauceLinked, sauceVisibleGroups, selectedMods, onSetMods]);

  function pickSauce(group: ModGroup, modifier: Modifier) {
    const base: Record<string, Modifier[]> = { ...selectedMods, [group.id]: [modifier] };
    const visible = visiblePizzaModifierGroups(item.name, item.modifierGroups, base);
    onSetMods(withLinkedHalfAndHalfSauces(visible, base, sauceLinked));
  }

  function toggleSauceLinked(next: boolean) {
    setSauceLinked(next);
    onSauceLinkedChange?.(next);
    if (!next) return;
    const synced = withLinkedHalfAndHalfSauces(sauceVisibleGroups, selectedMods, true);
    onSetMods(synced);
  }

  function renderOptionTiles(
    group: ModGroup,
    option: Modifier,
    onPick: () => void
  ) {
    const selected = (selectedMods[group.id] ?? []).some((p) => p.id === option.id);
    const listPrice = modifierListPriceCents(option.priceCents, group.name, item.name, sizeInches);
    return (
      <ModifierOptionButton
        key={`${group.id}-${option.id}`}
        name={option.name}
        selected={selected}
        priceLabel={modifierPriceLabel(selected, listPrice, chargedByModifierId.get(option.id))}
        onPick={onPick}
      />
    );
  }

  if (!isHalfAndHalfWizardItem(item.name) || !currentStep) return null;

  function stepTabHint(stepId: HalfAndHalfWizardStepId): string {
    const groups = visibleGroups.filter((g) => halfAndHalfWizardStepForGroup(g.name) === stepId);
    const minSelect = Math.max(0, ...groups.map((g) => g.minSelect));
    const freeSelect = Math.max(0, ...groups.map((g) => g.freeSelect ?? 0));
    let hint = "";
    if (minSelect > 0) hint += " *";
    if (freeSelect > 0) hint += ` · ${freeSelect} free`;
    return hint;
  }

  return (
    <div className="options-picker options-picker--hh">
      <div className="options-picker-head till-options-head">
        <div className="topbar">
          <button
            type="button"
            className="chip chip-back till-options-back"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            ← {editingLineKey ? "Sale" : "Menu"}
          </button>
          <div className="brand-mini">{editingLineKey ? `Edit · ${item.name}` : item.name}</div>
        </div>
        <div className="chip-row modifier-tabs" role="tablist" aria-label="Half and half options">
          {activeSteps.map((step, index) => (
            <button
              key={step.id}
              type="button"
              role="tab"
              aria-selected={index === stepIndex}
              className={`chip ${index === stepIndex ? "active" : ""}`}
              onClick={() => setStepIndex(index)}
            >
              {step.title}
              {stepTabHint(step.id)}
            </button>
          ))}
        </div>
        {currentStep.id === "sauce" && sauceLeft && sauceRight ? (
          <div className="modifier-sauce-bar">
            <label className="modifier-sauce-linked">
              <input type="checkbox" checked={sauceLinked} onChange={(e) => toggleSauceLinked(e.target.checked)} />
              Apply to both halves
            </label>
          </div>
        ) : null}
      </div>

      <div className="options-picker-body">
        {currentStep.id === "halves" ? (
          <div className="hh-halves-layout">
            {stepGroups.length === 0 ? (
              <p className="empty">Choose a size first — half options appear for 9″, 12″ or 16″.</p>
            ) : (
              <>
                <div className="hh-halves-columns">
                  {(["right", "left"] as const).map((side) => {
                    const columnGroups = halfAndHalfColumnGroupsForSide(stepGroups, side);
                    const columnTail = halfAndHalfColumnTailGroupsForSide(stepGroups, side);
                    const merged = halfAndHalfMergedColumnOptions(columnGroups);
                    if (!merged.length && !columnTail.length) return null;
                    const freeSelect = Math.max(0, ...columnGroups.map((g) => g.freeSelect ?? 0));
                    const minSelect = Math.max(0, ...columnGroups.map((g) => g.minSelect));
                    return (
                      <section
                        key={side}
                        className="hh-half-col"
                        aria-label={side === "right" ? "RIGHT" : "LEFT"}
                      >
                        <h3 className="hh-half-title">
                          {side === "right" ? "RIGHT" : "LEFT"}
                          {minSelect > 0 ? " *" : ""}
                          {freeSelect > 0 ? ` · ${freeSelect} free` : ""}
                        </h3>
                        {merged.length > 0 ? (
                          <div className="grid modifier-options-grid hh-half-grid">
                            {merged.map(({ group, modifier }) =>
                              renderOptionTiles(group, modifier, () => onChoose(group, modifier))
                            )}
                          </div>
                        ) : null}
                        {columnTail.map((group) => (
                          <section key={group.id} className="hh-column-extras">
                            <h3 className="hh-half-title hh-extras-title">{halfAndHalfExtrasRowLabel(group.name)}</h3>
                            <div className="grid modifier-options-grid hh-half-grid">
                              {group.modifiers.map((option) =>
                                renderOptionTiles(group, option, () => onChoose(group, option))
                              )}
                            </div>
                          </section>
                        ))}
                      </section>
                    );
                  })}
                </div>
                {halvesSharedTail.map((group) => (
                  <section key={group.id} className="hh-shared-tail">
                    <h3 className="hh-half-title hh-extras-title">{halfAndHalfExtrasRowLabel(group.name)}</h3>
                    <div className="grid modifier-options-grid">
                      {group.modifiers.map((option) =>
                        renderOptionTiles(group, option, () => onChoose(group, option))
                      )}
                    </div>
                  </section>
                ))}
              </>
            )}
          </div>
        ) : (
          <>
            {currentStep.id === "sauce" &&
              !sauceLinked &&
              stepGroups.map(
                (group) =>
                  isHalfAndHalfSauceGroup(group.name) && (
                    <h3 key={group.id} className="hh-half-title hh-sauce-heading">
                      {halfAndHalfWizardGroupLabel(group.name)}
                    </h3>
                  )
              )}
            <div className="grid modifier-options-grid">
              {(currentStep.id === "sauce" && sauceLinked && sauceLeft ? [sauceLeft] : stepGroups).flatMap((group) =>
                group
                  ? group.modifiers.map((option) =>
                      renderOptionTiles(group, option, () =>
                        currentStep.id === "sauce" ? pickSauce(group, option) : onChoose(group, option)
                      )
                    )
                  : []
              )}
            </div>
          </>
        )}
      </div>

      <div className="options-picker-footer">
        <div className="modifier-bar modifier-bar--options">
          <div className="modifier-bar-summary">
            <p className="step-kicker">{editingLineKey ? "Edit options" : "Step 2 · Options"}</p>
            <strong>{item.name}</strong>
            {modifierPreview.length > 0 ? (
              <div className="till-options-preview">{renderPreview(currentStep.id)}</div>
            ) : (
              <div className="meta">
                {currentStep.id === "halves" ? "Pick RIGHT and LEFT toppings" : "Choose options"}
              </div>
            )}
          </div>
          <button type="button" className="pay-btn options-confirm-btn" onClick={onConfirm}>
            {editingLineKey ? "Update" : "Add"} {money(modifierTotal)}
          </button>
        </div>
      </div>
    </div>
  );
}