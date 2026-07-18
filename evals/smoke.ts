import { count } from "drizzle-orm";
import { candidates, jobs } from "@/db/schema";
import { closeDb, getDb } from "@/lib/db";
import { matchCandidates } from "@/lib/matching";

// Pipeline mechanics smoke test for CI (runs against the mock embedding
// provider): seed rows are fully embedded and a free-text query returns a
// sane, ordered ranking. Semantic quality is NOT asserted here — that is
// eval:matching's job with a real model. Run: bun run eval:smoke.

try {
  const db = getDb();
  const [candidateStats] = await db
    .select({ total: count(), embedded: count(candidates.embedding) })
    .from(candidates);
  const [jobStats] = await db
    .select({ total: count(), embedded: count(jobs.embedding) })
    .from(jobs);
  if (
    candidateStats.total === 0 ||
    candidateStats.embedded !== candidateStats.total ||
    jobStats.embedded !== jobStats.total
  ) {
    throw new Error(
      `embedding coverage incomplete: candidates ${candidateStats.embedded}/${candidateStats.total}, jobs ${jobStats.embedded}/${jobStats.total}`,
    );
  }

  const ranking = await matchCandidates(
    "Suche Entwickler mit Erfahrung in TypeScript und Cloud-Infrastruktur",
    5,
  );
  if (ranking.length === 0) {
    throw new Error("matching returned no results");
  }
  for (const match of ranking) {
    if (!(match.similarity > -1 && match.similarity <= 1)) {
      throw new Error(`similarity out of range: ${match.similarity}`);
    }
  }
  console.log(
    `smoke ✓ — ${candidateStats.total} candidates and ${jobStats.total} jobs embedded, hybrid ranking returned ${ranking.length}`,
  );
} catch (e) {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
