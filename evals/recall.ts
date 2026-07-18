import { candidates } from "@/db/schema";
import { closeDb, getDb } from "@/lib/db";
import { matchCandidates } from "@/lib/matching";

// Retrieval recall eval: for skill-focused queries the ground truth is
// derivable from the profile texts themselves (does the profile contain
// the skill?). Measures recall@10 — the share of actually qualified
// candidates that make it into the top 10 the judge gets to see. This is
// the number the hybrid retrieval exists for. Run: bun run eval:recall.

const SKILL_QUERIES: { q: string; needle: string }[] = [
  { q: "sollte python haben", needle: "python" },
  { q: "Erfahrung mit AUTOSAR und Steuergeräten", needle: "autosar" },
  { q: "S/4HANA Migrationserfahrung", needle: "s/4hana" },
  { q: "Testautomatisierung mit Playwright", needle: "playwright" },
  { q: "Kenntnisse in Power BI", needle: "power bi" },
  { q: "Erfahrung mit Snowflake", needle: "snowflake" },
  { q: "Wir suchen jemanden mit Kafka-Erfahrung", needle: "kafka" },
  { q: "SwiftUI Kenntnisse erforderlich", needle: "swiftui" },
];

const MIN_PER_QUERY = 0.8;
const MIN_MEAN = 0.9;

try {
  const rows = await getDb()
    .select({ id: candidates.id, profile: candidates.profile })
    .from(candidates);

  const pad = (v: string, n: number) => v.padEnd(n);
  console.log(`${pad("query", 44)}${pad("relevant", 10)}${pad("hit", 6)}recall@10`);

  let sum = 0;
  let worst = 1;
  for (const { q, needle } of SKILL_QUERIES) {
    const relevant = new Set(
      rows
        .filter((r) => r.profile.toLowerCase().includes(needle))
        .map((r) => r.id),
    );
    if (relevant.size === 0) {
      throw new Error(`no ground truth for "${needle}" — run db:demo-data?`);
    }
    const retrieved = await matchCandidates(q, 10);
    const hits = retrieved.filter((m) => relevant.has(m.id)).length;
    const denominator = Math.min(relevant.size, 10);
    const recall = hits / denominator;
    sum += recall;
    worst = Math.min(worst, recall);
    console.log(
      `${pad(q, 44)}${pad(String(relevant.size), 10)}${pad(String(hits), 6)}${recall.toFixed(2)}`,
    );
  }

  const mean = sum / SKILL_QUERIES.length;
  console.log(`\nmean recall@10: ${mean.toFixed(3)}, worst: ${worst.toFixed(2)}`);
  if (mean < MIN_MEAN || worst < MIN_PER_QUERY) {
    console.error(
      `✗ below gate (mean ≥ ${MIN_MEAN}, per-query ≥ ${MIN_PER_QUERY})`,
    );
    process.exitCode = 1;
  }
} catch (e) {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
