import { eq } from "drizzle-orm";
import { jobs } from "@/db/schema";
import { closeDb, getDb } from "@/lib/db";
import { composeJobText } from "@/lib/embedding/compose";
import { matchCandidates } from "@/lib/matching";
import { goldenSet } from "./golden-set";

// Retrieval eval: runs every golden pair through the real matchCandidates
// path (fresh query embedding — the same path a free-text/PDF job takes)
// and measures rank, similarity, and the margin to the best-ranked wrong
// candidate. Margin is the separability signal: top-1 by 0.02 is luck,
// by 0.15 it's a robust result. Exit code 1 unless all pairs rank top-1,
// so this is CI-ready from day one. Run via `bun run eval:matching`.
//
// This evaluates retrieval only — LLM re-ranking gets its own eval later,
// sharing the golden set as fixture.

try {
  const db = getDb();
  const results: {
    job: string;
    expect: string;
    rank: number | null;
    similarity: number | null;
    margin: number | null;
  }[] = [];

  for (const pair of goldenSet) {
    const [job] = await db.select().from(jobs).where(eq(jobs.slug, pair.job));
    if (!job) {
      throw new Error(
        `Job "${pair.job}" not found — run bun run db:seed first`,
      );
    }
    const ranking = await matchCandidates(composeJobText(job), 10);
    const index = ranking.findIndex((m) => m.slug === pair.expect);
    const expected = index >= 0 ? ranking[index] : null;
    const bestWrong = ranking.find((m) => m.slug !== pair.expect);
    results.push({
      job: pair.job,
      expect: pair.expect,
      rank: index >= 0 ? index + 1 : null,
      similarity: expected?.similarity ?? null,
      margin:
        expected && bestWrong
          ? expected.similarity - bestWrong.similarity
          : null,
    });
  }

  const pad = (v: string, n: number) => v.padEnd(n);
  const num = (v: number | null, digits = 3) =>
    v === null ? "—" : v.toFixed(digits);
  console.log(
    `${pad("job", 24)}${pad("expected", 24)}${pad("rank", 6)}${pad("similarity", 12)}margin`,
  );
  for (const r of results) {
    console.log(
      `${pad(r.job, 24)}${pad(r.expect, 24)}${pad(r.rank === null ? "—" : String(r.rank), 6)}${pad(num(r.similarity), 12)}${num(r.margin)}`,
    );
  }

  const top1 = results.filter((r) => r.rank === 1).length;
  console.log(`\ntop-1: ${top1}/${goldenSet.length}`);
  if (top1 < goldenSet.length) {
    process.exitCode = 1;
  }
} catch (e) {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
