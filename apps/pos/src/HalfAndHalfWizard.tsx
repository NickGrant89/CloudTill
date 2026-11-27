import {
  HALF_AND_HALF_WIZARD_STEPS,
  halfAndHalfFirstIncompleteStepIndex,
  halfAndHalfHasExplicitSizeSelection,
  halfAndHalfStepSatisfied,
  halfAndHalfColumnGroupsForSide,
  halfAndHalfColumnTailGroupsForSide,
  halfAndHalfRemoveGroupsForSide,
  halfAndHalfRemoveSelectionKey,
  halfAndHalfWizardOptionsSectionTitle,
  halfAndHalfMergedColumnOptions,
  halfAndHalfMergedSauceOptions,
  halfAndHalfSauceGroups,
  mirrorSauceModifier,
  halfAndHalfWizardStepForGroup,
  isHalfAndHalfWizardItem,
  isHalfAndHalfRemoveGroup,
  isConsolidatedPizzaItem,
  modifierListPriceCents,
  pizzaSizeInchesFromSelection,
  visiblePizzaModifierGroups,
  withLinkedHalfAndHalfSauces,
  type HalfAndHalfWizardStepId,
} from "@cloudtill/shared";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  initialSauceLinked?: boolean;
  chargedByModifierId: Map<string, number>;
  onChoose: (group: ModGroup, modifier: Modifier) => void;
  onChooseRemove: (group: ModGroup, modifier: Modifier, side: "left" | "right") => void;
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
    initialSauceLinked = true,
    chargedByModifierId,
    onChoose,
    onChooseRemove,
    onSetMods,
    onClose,
    onConfirm,
    onSauceLinkedChange,
    renderPreview,
  } = props;

  const activeSteps = useMemo(() => {
    return HALF_AND_HALF_WIZARD_STEPS.filter((step) =>
      item.modifierGroups.some((g) => halfAndHalfWizardStepForGroup(g.name) === step.id)
    );
  }, [item.modifierGroups]);

  const stepIds = useMemo(() => activeSteps.map((s) => s.id), [activeSteps]);

  const [stepIndex, setStepIndex] = useState(() => {
    if (editingLineKey) {
      return halfAndHalfFirstIncompleteStepIndex(stepIds, visibleGroups, selectedMods, initialSauceLinked);
    }
    const sizeIdx = stepIds.indexOf("size");
    return sizeIdx >= 0 ? sizeIdx : 0;
  });
  /** User tapped ← Groups or a step tab — hold step until they pick or open another step. */
  const manualStepUntilPickRef = useRef<number | null>(null);
  const stepPinMetaRef = useRef<{ index: number; wasSatisfied: boolean } | null>(null);

  function stepWasSatisfied(stepIdx: number): boolean {
    const stepId = stepIds[stepIdx];
    if (!stepId) return false;
    return halfAndHalfStepSatisfied({
      stepId,
      visibleGroups,
      selected: selectedMods,
      sauceLinked,
    });
  }
  const [sauceLinked, setSauceLinked] = useState(initialSauceLinked);
  const [sauceEditSide, setSauceEditSide] = useState<"left" | "right" | null>(null);

  useLayoutEffect(() => {
    if (editingLineKey) return;
    const sizeIdx = stepIds.indexOf("size");
    if (sizeIdx < 0) return;
    manualStepUntilPickRef.current = sizeIdx;
    stepPinMetaRef.current = { index: sizeIdx, wasSatisfied: stepWasSatisfied(sizeIdx) };
    setStepIndex(sizeIdx);
  }, [editingLineKey, item.id, stepIds]);

  function goToStep(index: number) {
    manualStepUntilPickRef.current = index;
    stepPinMetaRef.current = { index, wasSatisfied: stepWasSatisfied(index) };
    setStepIndex(index);
  }

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

  /* Advance forward only when picks change — never override a tab/back navigation. */
  useEffect(() => {
    const sizeIdx = stepIds.indexOf("size");
    const pinned = manualStepUntilPickRef.current;
    setStepIndex((i) => {
      if (
        !editingLineKey &&
        sizeIdx >= 0 &&
        !halfAndHalfHasExplicitSizeSelection(item.modifierGroups, selectedMods)
      ) {
        manualStepUntilPickRef.current = sizeIdx;
        stepPinMetaRef.current = { index: sizeIdx, wasSatisfied: false };
        return sizeIdx;
      }
      if (pinned !== null && i === pinned) {
        const meta = stepPinMetaRef.current;
        const satisfiedNow = stepWasSatisfied(pinned);
        const completedPickOnPin = meta?.index === pinned && !meta.wasSatisfied && satisfiedNow;
        if (!completedPickOnPin) return i;
        manualStepUntilPickRef.current = null;
        stepPinMetaRef.current = null;
      } else if (pinned !== null && i !== pinned) {
        manualStepUntilPickRef.current = null;
        stepPinMetaRef.current = null;
      }
      const need = halfAndHalfFirstIncompleteStepIndex(stepIds, visibleGroups, selectedMods, sauceLinked);
      return need > i ? need : i;
    });
  }, [editingLineKey, item.modifierGroups, visibleGroups, selectedMods, stepIds, sauceLinked]);

  const currentStep = activeSteps[stepIndex];

  useEffect(() => {
    if (currentStep?.id !== "sauce") setSauceEditSide(null);
  }, [currentStep?.id]);

  const stepGroups = useMemo(() => {
    if (!currentStep) return [];
    return visibleGroups.filter((g) => halfAndHalfWizardStepForGroup(g.name) === currentStep.id);
  }, [visibleGroups, currentStep]);


  const mergedSauceOptions = useMemo(
    () => halfAndHalfMergedSauceOptions<ModGroup, Modifier>(sauceVisibleGroups),
    [sauceVisibleGroups]
  );

  const sauceActiveSide = useMemo((): "left" | "right" => {
    if (sauceLinked || !sauceLeft || !sauceRight) return "left";
    if (sauceEditSide) return sauceEditSide;
    const leftOk = (selectedMods[sauceLeft.id] ?? []).length >= sauceLeft.minSelect;
    const rightOk = (selectedMods[sauceRight.id] ?? []).length >= sauceRight.minSelect;
    if (!leftOk) return "left";
    if (!rightOk) return "right";
    return "left";
  }, [sauceLinked, sauceLeft, sauceRight, selectedMods, sauceEditSide]);

  const sizeInches = isConsolidatedPizzaItem(item.name)
    ? pizzaSizeInchesFromSelection(item.modifierGroups, selectedMods)
    : null;

  useEffect(() => {
    if (!sauceLinked) return;
    const synced = withLinkedHalfAndHalfSauces(sauceVisibleGroups, selectedMods, true);
    if (synced !== selectedMods) onSetMods(synced);
  }, [sauceLinked, sauceVisibleGroups, selectedMods, onSetMods]);

  function pickSauce(modifier: Modifier, sourceGroup: ModGroup) {
    if (sauceLinked) {
      const base: Record<string, Modifier[]> = { ...selectedMods, [sourceGroup.id]: [modifier] };
      const visible = visiblePizzaModifierGroups(item.name, item.modifierGroups, base);
      onSetMods(withLinkedHalfAndHalfSauces(visible, base, true));
      return;
    }
    const target = sauceActiveSide === "left" ? sauceLeft : sauceRight;
    if (!target) return;
    const mirrored = mirrorSauceModifier(target, modifier);
    const next: Record<string, Modifier[]> = { ...selectedMods, [target.id]: [mirrored] };
    onSetMods(next);
    if (sauceActiveSide === "left" && sauceRight) {
      const rightOk = (next[sauceRight.id] ?? []).length >= sauceRight.minSelect;
      if (!rightOk) setSauceEditSide("right");
    }
  }

  function toggleSauceLinked(next: boolean) {
    setSauceLinked(next);
    setSauceEditSide(null);
    onSauceLinkedChange?.(next);
    if (!next) return;
    const synced = withLinkedHalfAndHalfSauces(sauceVisibleGroups, selectedMods, true);
    onSetMods(synced);
  }

  function sauceTileSelected(optionName: string): boolean {
    const leftP = sauceLeft ? selectedMods[sauceLeft.id]?.[0] : undefined;
    const rightP = sauceRight ? selectedMods[sauceRight.id]?.[0] : undefined;
    const key = optionName.trim().toLowerCase();
    if (!sauceLinked) {
      const activeP = sauceActiveSide === "left" ? leftP : rightP;
      if (activeP?.name.trim().toLowerCase() === key) return true;
      return (
        leftP?.name.trim().toLowerCase() === key || rightP?.name.trim().toLowerCase() === key
      );
    }
    return leftP?.name.trim().toLowerCase() === key || rightP?.name.trim().toLowerCase() === key;
  }

  function renderOptionTiles(
    group: ModGroup,
    option: Modifier,
    onPick: () => void,
    selectedOverride?: boolean,
    reactKey?: string
  ) {
    const selected = isHalfAndHalfRemoveGroup(group.name)
      ? Boolean(selectedOverride)
      : (selectedOverride ?? (selectedMods[group.id] ?? []).some((p) => p.id === option.id));
    const listPrice = modifierListPriceCents(option.priceCents, group.name, item.name, sizeInches);
    return (
      <ModifierOptionButton
        key={reactKey ?? `${group.id}-${option.id}`}
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
              manualStepUntilPickRef.current = null;
              onClose();
            }}
          >
            ← {editingLineKey ? "Sale" : "Groups"}
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
              onClick={(e) => {
                e.stopPropagation();
                goToStep(index);
              }}
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
              <div className="hh-halves-columns">
                {(["right", "left"] as const).map((side) => {
                  const columnGroups = halfAndHalfColumnGroupsForSide(stepGroups, side);
                  const merged = halfAndHalfMergedColumnOptions(columnGroups);
                  if (!merged.length) return null;
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
                      <div className="grid modifier-options-grid hh-half-grid">
                        {merged.map(({ group, modifier }) =>
                          renderOptionTiles(group, modifier, () => onChoose(group, modifier))
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        ) : currentStep.id === "options" ? (
          <div className="hh-halves-layout hh-options-layout">
            {halfAndHalfRemoveGroupsForSide(stepGroups, "left").length === 0 &&
            halfAndHalfRemoveGroupsForSide(stepGroups, "right").length === 0 &&
            halfAndHalfColumnTailGroupsForSide(stepGroups, "left").length === 0 &&
            halfAndHalfColumnTailGroupsForSide(stepGroups, "right").length === 0 ? (
              <p className="empty">Choose a size first — remove toppings and extras appear for 9″, 12″ or 16″.</p>
            ) : (
              <div className="hh-halves-columns hh-halves-columns--options">
                {(["left", "right"] as const).map((side) => {
                  const removeGroups = halfAndHalfRemoveGroupsForSide(stepGroups, side);
                  const columnTail = halfAndHalfColumnTailGroupsForSide(stepGroups, side);
                  if (!removeGroups.length && !columnTail.length) return null;
                  return (
                    <section
                      key={side}
                      className={`hh-half-col hh-half-col--${side}`}
                      aria-label={`${side === "left" ? "Left" : "Right"} options`}
                    >
                      {removeGroups.length > 0 ? (
                        <section className="hh-column-extras">
                          <h3 className="hh-half-title hh-extras-title">
                            {halfAndHalfWizardOptionsSectionTitle(side, "remove")}
                          </h3>
                          <div className="grid modifier-options-grid hh-half-grid">
                            {removeGroups.flatMap((group) =>
                              group.modifiers.map((option) => {
                                const sideKey = halfAndHalfRemoveSelectionKey(group.id, side);
                                const picked = (selectedMods[sideKey] ?? []).some((p) => p.id === option.id);
                                return renderOptionTiles(
                                  group,
                                  option,
                                  () => onChooseRemove(group, option, side),
                                  picked,
                                  `${sideKey}-${option.id}`
                                );
                              })
                            )}
                          </div>
                        </section>
                      ) : null}
                      {columnTail.length > 0 ? (
                        <section className="hh-column-extras">
                          <h3 className="hh-half-title hh-extras-title">
                            {halfAndHalfWizardOptionsSectionTitle(side, "extras")}
                          </h3>
                          <div className="grid modifier-options-grid hh-half-grid">
                            {columnTail.flatMap((group) =>
                              group.modifiers.map((option) =>
                                renderOptionTiles(group, option, () => onChoose(group, option))
                              )
                            )}
                          </div>
                        </section>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        ) : currentStep.id === "sauce" ? (
          <>
            {!sauceLinked && sauceLeft && sauceRight ? (
              <div className="hh-sauce-split-bar">
                <p className="hh-sauce-prompt">
                  {sauceActiveSide === "left"
                    ? "Tap sauce for LEFT half"
                    : "Tap sauce for RIGHT half"}
                </p>
                <div className="hh-sauce-side-switch" role="group" aria-label="Which half to sauce">
                  <button
                    type="button"
                    className={`chip ${sauceActiveSide === "left" ? "active" : ""}`}
                    onClick={() => setSauceEditSide("left")}
                  >
                    LEFT
                  </button>
                  <button
                    type="button"
                    className={`chip ${sauceActiveSide === "right" ? "active" : ""}`}
                    onClick={() => setSauceEditSide("right")}
                  >
                    RIGHT
                  </button>
                </div>
              </div>
            ) : null}
            <div className="grid modifier-options-grid">
              {mergedSauceOptions.map(({ group, modifier }) => {
                const selected = sauceTileSelected(modifier.name);
                const listPrice = modifierListPriceCents(
                  modifier.priceCents,
                  group.name,
                  item.name,
                  sizeInches
                );
                return (
                  <ModifierOptionButton
                    key={`sauce-${group.id}-${modifier.id}`}
                    name={modifier.name}
                    selected={selected}
                    priceLabel={modifierPriceLabel(
                      selected,
                      listPrice,
                      chargedByModifierId.get(modifier.id)
                    )}
                    onPick={() => pickSauce(modifier, group)}
                  />
                );
              })}
            </div>
          </>
        ) : (
          <div className="grid modifier-options-grid">
            {stepGroups.flatMap((group) =>
              group.modifiers.map((option) =>
                renderOptionTiles(group, option, () => onChoose(group, option))
              )
            )}
          </div>
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
                {currentStep.id === "halves"
                  ? "Pick RIGHT and LEFT toppings"
                  : currentStep.id === "options"
                    ? "Remove toppings, then paid extras per half"
                    : "Choose options"}
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