export type ItemGroupLike = { id: string; sortOrder?: number | null; name?: string };
export type TillItemLike = { name: string; categoryId: string | null; id?: string };

/** Item groups (categories) in Manage groups / till chip order. */
export function sortItemGroups<T extends { sortOrder?: number | null; name: string }>(groups: T[]): T[] {
  return [...groups].sort(
    (a, b) =>
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

export function itemGroupRank(categoryId: string | null, groups: ItemGroupLike[]): number {
  if (!categoryId) return 1_000_000;
  const group = groups.find((entry) => entry.id === categoryId);
  if (!group) return 999_999;
  return group.sortOrder ?? 0;
}

/** Till / menu: group sortOrder first, then item name within the group. Ungrouped items last. */
export function sortTillMenuItems<T extends TillItemLike>(items: T[], groups: ItemGroupLike[]): T[] {
  return [...items].sort((a, b) => {
    const ga = itemGroupRank(a.categoryId, groups);
    const gb = itemGroupRank(b.categoryId, groups);
    if (ga !== gb) return ga - gb;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/** Quick keys: same group order, keep favourite sequence within each group. */
export function sortTillFavoriteItems<T extends TillItemLike>(
  items: T[],
  groups: ItemGroupLike[],
  favoriteIds: string[]
): T[] {
  const pin = new Map(favoriteIds.map((id, index) => [id, index]));
  return [...items].sort((a, b) => {
    const ga = itemGroupRank(a.categoryId, groups);
    const gb = itemGroupRank(b.categoryId, groups);
    if (ga !== gb) return ga - gb;
    const pa = pin.get(a.id ?? "") ?? 1_000_000;
    const pb = pin.get(b.id ?? "") ?? 1_000_000;
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}