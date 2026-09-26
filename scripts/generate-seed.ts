/**
 * Regenerates supabase/seed.sql from src/domain (foundations, registries,
 * flags, catalog). Run after changing the seed catalog:
 *   npx tsx scripts/generate-seed.ts          # write
 *   npx tsx scripts/generate-seed.ts --check  # exit 1 if stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateSeedSql } from "../src/server/data/seed";

const target = join(process.cwd(), "supabase", "seed.sql");
const sql = generateSeedSql();

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    // missing counts as stale
  }
  if (current !== sql) {
    console.error("supabase/seed.sql is stale. Run: npx tsx scripts/generate-seed.ts");
    process.exit(1);
  }
  console.log("supabase/seed.sql is current.");
} else {
  writeFileSync(target, sql);
  console.log(`wrote ${target}`);
}
