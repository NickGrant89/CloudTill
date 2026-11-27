/**
 * G&A: hide generic pizza tiles + tidy Loyverse Half & Half modifier tabs.
 * Run (Postgres): sed schema to postgresql, prisma generate, then:
 *   railway run env DRY_RUN=1 pnpm exec tsx scripts/ga-pizza-catalog-tidy.ts
 */
import { tidyGaPizzaCatalog } from "../src/gaPizzaCatalogTidy.js";

const storeId = process.env.GA_STORE_ID ?? "cmwtspy480000p548mhgcngzu";
const dryRun = process.env.DRY_RUN === "1";

async function main() {
  const report = await tidyGaPizzaCatalog(storeId, dryRun);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});