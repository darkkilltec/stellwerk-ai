import { eq } from "drizzle-orm";
import { jobs } from "@/db/schema";
import { closeDb, getDb } from "@/lib/db";
import { composeJobText } from "@/lib/embedding/compose";
import { matchCandidatesReranked } from "@/lib/matching";
import { goldenSet } from "./golden-set";

// Re-ranking eval on the same golden set as the retrieval eval. Measures
// per pair: final rank of the expected candidate (target: 1), judge score,
// score margin to the best wrong candidate, and — the regression check —
// whether re-ranking DEMOTED a candidate the vector stage already had on
// top. Exit code 1 unless all pairs rank top-1. Run: bun run eval:reranking.
//
// This evaluates the two-stage pipeline; the retrieval-only baseline lives
// in eval:matching.

try {
  const db = getDb();
  const rows: {
    job: string;
    expect: string;
    rank: number | null;
    score: number | null;
    margin: number | null;
    vectorRank: number | null;
    regressed: boolean;
  }[] = [];

  for (const pair of goldenSet) {
    const [job] = await db.select().from(jobs).where(eq(jobs.slug, pair.job));
    if (!job) {
      throw new Error(`Job "${pair.job}" not found — run bun run db:seed first`);
    }
    const ranking = await matchCandidatesReranked(composeJobText(job), 10);
    const index = ranking.findIndex((m) => m.slug === pair.expect);
    const expected = index >= 0 ? ranking[index] : null;
    const bestWrong = ranking.find((m) => m.slug !== pair.expect);
    rows.push({
      job: pair.job,
      expect: pair.expect,
      rank: index >= 0 ? index + 1 : null,
      score: expected?.judgment.score ?? null,
      margin:
        expected && bestWrong
          ? expected.judgment.score - bestWrong.judgment.score
          : null,
      vectorRank: expected?.vectorRank ?? null,
      regressed: !!expected && expected.vectorRank === 1 && index > 0,
    });
  }

  const pad = (v: string, n: number) => v.padEnd(n);
  const num = (v: number | null) => (v === null ? "—" : String(Math.round(v)));
  console.log(
    `${pad("job", 24)}${pad("expected", 24)}${pad("rank", 6)}${pad("score", 7)}${pad("margin", 8)}${pad("vec", 5)}regressed`,
  );
  for (const r of rows) {
    console.log(
      `${pad(r.job, 24)}${pad(r.expect, 24)}${pad(r.rank === null ? "—" : String(r.rank), 6)}${pad(num(r.score), 7)}${pad(num(r.margin), 8)}${pad(r.vectorRank === null ? "—" : String(r.vectorRank), 5)}${r.regressed ? "YES" : "-"}`,
    );
  }

  const top1 = rows.filter((r) => r.rank === 1).length;
  const regressions = rows.filter((r) => r.regressed).length;
  console.log(`\ntop-1: ${top1}/${goldenSet.length}, regressions: ${regressions}`);
  if (top1 < goldenSet.length) {
    process.exitCode = 1;
  }
} catch (e) {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
