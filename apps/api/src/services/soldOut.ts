import { prisma } from "../db.js";

/** Items the kitchen marked sold out, or tracked items whose stock is all gone. */
export async function soldOutItemIds(storeId: string) {
  const [flagged, levels] = await Promise.all([
    prisma.item.findMany({ where: { storeId, soldOut: true }, select: { id: true } }),
    prisma.inventoryLevel.findMany({
      where: {
        storeId,
        quantity: { lte: 0 },
        variant: { trackStock: true, active: true, item: { isComposite: false } },
      },
      select: { variant: { select: { itemId: true } } },
    }),
  ]);
  const ids = new Set(flagged.map((i) => i.id));
  const emptyByItem = new Map<string, number>();
  for (const level of levels) {
    emptyByItem.set(level.variant.itemId, (emptyByItem.get(level.variant.itemId) ?? 0) + 1);
  }
  if (emptyByItem.size) {
    const variantCounts = await prisma.variant.groupBy({
      by: ["itemId"],
      where: { itemId: { in: [...emptyByItem.keys()] }, active: true },
      _count: { _all: true },
    });
    for (const row of variantCounts) {
      if ((emptyByItem.get(row.itemId) ?? 0) >= row._count._all) ids.add(row.itemId);
    }
  }
  return ids;
}
