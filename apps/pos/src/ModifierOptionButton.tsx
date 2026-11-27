/** Shared till-options modifier tile (burgers + consolidated pizza wizard / tabs). */
export function ModifierOptionButton(props: {
  name: string;
  priceLabel: string;
  selected: boolean;
  onPick: () => void;
}) {
  const { name, priceLabel, selected, onPick } = props;
  return (
    <button
      type="button"
      className={`item-tile mod-opt ${selected ? "is-selected" : ""}`}
      onClick={onPick}
    >
      <span className="name">{name}</span>
      <span className="price">{priceLabel}</span>
    </button>
  );
}