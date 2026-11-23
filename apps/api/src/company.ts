import { prisma } from "./db.js";

export const DEMO_COMPANY = "demo";
const DEMO_SLUGS = ["demo-cafe", "downtown"];

/** Store ids that belong to the same business as `storeId` (always includes it). */
export async function companyStoreIds(storeId: string): Promise<string[]> {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { companyKey: true } });
  if (!store?.companyKey) return [storeId];
  const rows = await prisma.store.findMany({ where: { companyKey: store.companyKey }, select: { id: true } });
  return rows.map((r) => r.id);
}

export async function sameCompany(storeId: string, otherIds: string[]): Promise<boolean> {
  const allowed = new Set(await companyStoreIds(storeId));
  return otherIds.every((id) => allowed.has(id));
}

/** Staff member to credit automated sales to: the store's owner, any of its staff, else the business owner (branches may have no staff). */
export async function attributionEmployee(storeId: string) {
  return (
    (await prisma.employee.findFirst({ where: { storeId, role: "owner", active: true } })) ??
    (await prisma.employee.findFirst({ where: { storeId, active: true } })) ??
    (await prisma.employee.findFirst({
      where: { storeId: { in: await companyStoreIds(storeId) }, role: "owner", active: true },
      orderBy: { createdAt: "asc" },
    }))
  );
}

/** Older rows predate companyKey: demo stores share one key, every other store is its own company. */
export async function backfillCompanyKeys() {
  await prisma.store.updateMany({
    where: { slug: { in: DEMO_SLUGS }, companyKey: "" },
    data: { companyKey: DEMO_COMPANY },
  });
  await prisma.store.updateMany({ where: { slug: "demo-cafe" }, data: { listedPublicly: true } });
  const loose = await prisma.store.findMany({ where: { companyKey: "" }, select: { id: true } });
  for (const s of loose) {
    await prisma.store.update({ where: { id: s.id }, data: { companyKey: s.id } });
  }
}
