import {
  HALF_AND_HALF_WIZARD_STEPS,
  halfAndHalfWizardGroupLabel,
  halfAndHalfWizardStepForGroup,
  isHalfAndHalfLeftGroup,
  isHalfAndHalfRightGroup,
  isHalfAndHalfSauceGroup,
  isHalfAndHalfWizardItem,
  isConsolidatedPizzaItem,
  modifierListPriceCents,
  pizzaSizeInchesFromSelection,
  type HalfAndHalfWizardStepId,
} from "@cloudtill/shared";
import { useEffect, useMemo, useState } from "react";
import { money } from "./api";

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
  selected: Record<string, Modifier[]>
): number {
  for (let i = 0; i < steps.length; i++) {
    const stepId = steps[i]!;
    const stepGroups = visibleGroups.filter((g) => halfAndHalfWizardStepForGroup(g.name) === stepId);
    for (const group of stepGroups) {
      const picked = selected[group.id] ?? [];
      if (picked.length < group.minSelect) return i;
    }
  }
  return Math.max(0, steps.length - 1);
}

function sauceGroups(groups: ModGroup[]): { left?: ModGroup; right?: ModGroup } {
  const left = groups.find((g) => g.name.trim().toLowerCase() === "pizza sauce");
  const right = groups.find((g) => g.name.trim().toLowerCase() === "pizza sauce 2");
  return { left, right };
}

function sortHalvesGroups(groups: ModGroup[]): ModGroup[] {
  return [...groups].sort((a, b) => {
    const ar = isHalfAndHalfRightGroup(a.name) ? 0 : 1;
    const br = isHalfAndHalfRightGroup(b.name) ? 0 : 1;
    return ar - br;
  });
}

function OptionTile(props: {
  item: WizardItem;
  group: ModGroup;
  option: Modifier;
  selected: boolean;
  chargedCents?: number;
  listPrice: number;
  onPick: () => void;
}) {
  const { item, option, selected, chargedCents, listPrice, onPick } = props;
  return (
    <button
      type="button"
      className={`item-tile hh-tile ${selected ? "is-selected" : ""}`}
      style={{ backgroundColor: item.color }}
      onClick={onPick}
    >
      <span className="name">{option.name}</span>
      <span className="price">
        {!listPrice
          ? "Included"
          : selected && chargedCents === 0
            ? "Included"
            : selected && chargedCents !== undefined
              ? `+${money(chargedCents)}`
              : `+${money(listPrice)}`}
      </span>
    </button>
  );
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
    renderPreview,
  } = props;

  const activeSteps = useMemo(() => {
    return HALF_AND_HALF_WIZARD_STEPS.filter((step) =>
      visibleGroups.some((g) => halfAndHalfWizardStepForGroup(g.name) === step.id)
    );
  }, [visibleGroups]);

  const stepIds = useMemo(() => activeSteps.map((s) => s.id), [activeSteps]);

  const [stepIndex, setStepIndex] = useState(() => firstIncompleteStep(stepIds, visibleGroups, selectedMods));
  const [sauceLinked, setSauceLinked] = useState(true);

  useEffect(() => {
    if (stepIndex >= activeSteps.length) setStepIndex(Math.max(0, activeSteps.length - 1));
  }, [activeSteps.length, stepIndex]);

  useEffect(() => {
    const need = firstIncompleteStep(stepIds, visibleGroups, selectedMods);
    if (need > stepIndex) setStepIndex(need);
  }, [visibleGroups, selectedMods, stepIds, stepIndex]);

  const currentStep = activeSteps[stepIndex];
  const stepGroups = useMemo(() => {
    if (!currentStep) return [];
    const matched = visibleGroups.filter((g) => halfAndHalfWizardStepForGroup(g.name) === currentStep.id);
    if (currentStep.id === "halves") return sortHalvesGroups(matched);
    return matched;
  }, [visibleGroups, currentStep]);

  function stepComplete(stepId: HalfAndHalfWizardStepId): boolean {
    const groups = visibleGroups.filter((g) => halfAndHalfWizardStepForGroup(g.name) === stepId);
    return groups.every((g) => (selectedMods[g.id] ?? []).length >= g.minSelect);
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

  const { left: sauceLeft, right: sauceRight } = sauceGroups(item.modifierGroups);

  function pickSauce(group: ModGroup, modifier: Modifier) {
    let next: Record<string, Modifier[]> = { ...selectedMods, [group.id]: [modifier] };
    if (sauceLinked && sauceLeft && sauceRight) {
      next = { ...next, [sauceLeft.id]: [modifier], [sauceRight.id]: [modifier] };
    }
    onSetMods(next);
  }

  function toggleSauceLinked(next: boolean) {
    setSauceLinked(next);
    if (next && sauceLeft && sauceRight) {
      const picked = selectedMods[sauceLeft.id]?.[0] ?? selectedMods[sauceRight.id]?.[0];
      if (picked) {
        onSetMods({
          ...selectedMods,
          [sauceLeft.id]: [picked],
          [sauceRight.id]: [picked],
        });
      }
    }
  }

  const canNext = currentStep ? stepComplete(currentStep.id) : false;
  const onLastStep = stepIndex >= activeSteps.length - 1;

  if (!isHalfAndHalfWizardItem(item.name) || !currentStep) return null;

  return (
    <div className="hh-wizard">
      <div className="hh-wizard-head">
        <button type="button" className="chip" onClick={onClose}>
          ← {editingLineKey ? "Sale" : "Menu"}
        </button>
        <div className="brand-mini">{editingLineKey ? `Edit · ${item.name}` : item.name}</div>
      </div>

      <ol className="hh-steps" aria-label="Wizard progress">
        {activeSteps.map((step, index) => (
          <li key={step.id}>
            <button
              type="button"
              className={`hh-step${index === stepIndex ? " is-current" : ""}${stepComplete(step.id) ? " is-done" : ""}`}
              onClick={() => setStepIndex(index)}
            >
              <span className="hh-step-num">{index + 1}</span>
              <span className="hh-step-label">{step.title}</span>
            </button>
          </li>
        ))}
      </ol>

      <p className="hh-step-kicker">
        Step {stepIndex + 1} · {currentStep.title} — {currentStep.subtitle}
      </p>

      {currentStep.id === "sauce" && sauceLeft && sauceRight && (
        <div className="hh-sauce-bar">
          <label className="hh-linked">
            <input type="checkbox" checked={sauceLinked} onChange={(e) => toggleSauceLinked(e.target.checked)} />
            Apply to both halves
          </label>
        </div>
      )}

      <div className="hh-wizard-body">
        {currentStep.id === "halves" ? (
          <div className="hh-halves">
            {stepGroups.length === 0 ? (
              <p className="empty">Choose a size first — topping groups appear for 9″, 12″ or 16″.</p>
            ) : (
              stepGroups.map((group) => (
                <section key={group.id} className="hh-half-col" aria-label={halfAndHalfWizardGroupLabel(group.name)}>
                  <h3 className="hh-half-title">
                    {halfAndHalfWizardGroupLabel(group.name)}
                    {group.minSelect > 0 ? " *" : ""}
                    {(group.freeSelect ?? 0) > 0 ? ` · ${group.freeSelect} free` : ""}
                  </h3>
                  <div className="grid hh-half-grid">
                    {group.modifiers.map((option) => {
                      const selected = (selectedMods[group.id] ?? []).some((p) => p.id === option.id);
                      const listPrice = modifierListPriceCents(
                        option.priceCents,
                        group.name,
                        item.name,
                        sizeInches
                      );
                      return (
                        <OptionTile
                          key={option.id}
                          item={item}
                          group={group}
                          option={option}
                          selected={selected}
                          listPrice={listPrice}
                          chargedCents={chargedByModifierId.get(option.id)}
                          onPick={() => onChoose(group, option)}
                        />
                      );
                    })}
                  </div>
                </section>
              ))
            )}
          </div>
        ) : (
          <>
            {currentStep.id === "sauce" &&
              !sauceLinked &&
              stepGroups.map(
                (group) =>
                  isHalfAndHalfSauceGroup(group.name) && (
                    <h3 key={group.id} className="hh-half-title">
                      {halfAndHalfWizardGroupLabel(group.name)}
                    </h3>
                  )
              )}
            <div className="grid hh-step-grid">
              {(currentStep.id === "sauce" && sauceLinked && sauceLeft ? [sauceLeft] : stepGroups).flatMap((group) =>
                group
                  ? group.modifiers.map((option) => {
                      const selected = (selectedMods[group.id] ?? []).some((p) => p.id === option.id);
                      const listPrice = modifierListPriceCents(
                        option.priceCents,
                        group.name,
                        item.name,
                        sizeInches
                      );
                      return (
                        <OptionTile
                          key={`${group.id}-${option.id}`}
                          item={item}
                          group={group}
                          option={option}
                          selected={selected}
                          listPrice={listPrice}
                          chargedCents={chargedByModifierId.get(option.id)}
                          onPick={() =>
                            currentStep.id === "sauce" ? pickSauce(group, option) : onChoose(group, option)
                          }
                        />
                      );
                    })
                  : []
              )}
            </div>
          </>
        )}
      </div>

      <div className="hh-wizard-footer">
        <div className="hh-nav">
          <button
            type="button"
            className="btn ghost"
            disabled={stepIndex === 0}
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          >
            Back
          </button>
          {!onLastStep ? (
            <button
              type="button"
              className="btn"
              disabled={!canNext}
              onClick={() => setStepIndex((i) => Math.min(activeSteps.length - 1, i + 1))}
            >
              Next
            </button>
          ) : null}
        </div>

        <div className="modifier-bar hh-modifier-bar">
          <div className="hh-modifier-summary">
            <p className="step-kicker">{editingLineKey ? "Edit options" : "Half & half"}</p>
            <strong>{item.name}</strong>
            {modifierPreview.length > 0 ? (
              <div className="till-options-preview">{renderPreview(currentStep.id)}</div>
            ) : (
              <div className="meta">
                {currentStep.id === "halves" ? "Pick RIGHT and LEFT toppings" : "Choose options"}
              </div>
            )}
          </div>
          <button type="button" className="pay-btn hh-add-btn" onClick={onConfirm}>
            {editingLineKey ? "Update" : "Add"} {money(modifierTotal)}
          </button>
        </div>
      </div>
    </div>
  );
}