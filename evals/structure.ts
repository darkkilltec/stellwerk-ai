import { candidates, jobs } from "@/db/schema";
import { closeDb, getDb } from "@/lib/db";
import { structuralViolations } from "./structural-checks";

// Model-free structural bias check — runs in CI against the seeded DB.
// Run: bun run eval:structure.

try {
  const db = getDb();
  const violations = structuralViolations(
    await db.select().from(candidates),
    await db.select().from(jobs),
  );
  for (const violation of violations) {
    console.error(`✗ structural: ${violation}`);
  }
  if (violations.length > 0) {
    process.exitCode = 1;
  } else {
    console.log("structural: names/companies excluded from embed text ✓");
  }
} catch (e) {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
