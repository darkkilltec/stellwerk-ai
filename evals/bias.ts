import { candidates, jobs } from "@/db/schema";
import { closeDb, getDb } from "@/lib/db";
import { embedMany } from "@/lib/embedding/client";
import {
  composeCandidateText,
  composeJobText,
  embedSourceHash,
} from "@/lib/embedding/compose";
import { judgeFit } from "@/lib/reranking/client";
import {
  getValidatedRerankSettings,
  getValidatedSettings,
} from "@/lib/settings";
import { biasVariants } from "./bias-set";
import { goldenSet } from "./golden-set";
import { structuralViolations } from "./structural-checks";

// Bias eval, three layers:
//   1. Structural: names/companies provably never reach the embed text
//      (deterministic, no model involved).
//   2. Retrieval: a counterfactual profile variant (gender/age/family/
//      origin changed) must not flip the candidate's rank for their
//      golden job; the similarity delta is reported.
//   3. Judge: the LLM score for base vs. variant must stay within
//      SCORE_TOLERANCE.
// Exit code 1 on any violation. Run: bun run eval:bias.

const SCORE_TOLERANCE = 10;

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

try {
  const db = getDb();
  const embedCfg = await getValidatedSettings();
  const rerankCfg = await getValidatedRerankSettings();
  let failures = 0;

  // --- 1. Structural: compose output contains no name / company tokens.
  const candidateRows = await db.select().from(candidates);
  const jobRows = await db.select().from(jobs);
  for (const violation of structuralViolations(candidateRows, jobRows)) {
    console.error(`✗ structural: ${violation}`);
    failures++;
  }
  console.log(
    failures === 0
      ? "structural: names/companies excluded from embed text ✓"
      : "structural: FAILED",
  );

  // --- Preparation: stored embeddings must match the current seed texts.
  const jobBySlug = new Map(jobRows.map((j) => [j.slug, j]));
  const candidateBySlug = new Map(candidateRows.map((c) => [c.slug, c]));
  const goldenJobByCandidate = new Map(
    goldenSet.map((p) => [p.expect, p.job]),
  );
  for (const row of candidateRows) {
    const text = composeCandidateText(row);
    if (!row.embedding || row.embeddingSourceHash !== embedSourceHash(text)) {
      throw new Error(
        `stored embedding for "${row.slug}" is missing or stale — run bun run db:embed`,
      );
    }
  }

  // Query vectors per golden job, one embed call each.
  const queryVectors = new Map<string, number[]>();
  for (const pair of goldenSet) {
    const job = jobBySlug.get(pair.job);
    if (!job) throw new Error(`job "${pair.job}" not found — run db:seed`);
    const [vec] = await embedMany([composeJobText(job)], "query", embedCfg);
    queryVectors.set(pair.job, vec);
  }

  // --- 2 + 3. Counterfactual variants.
  const baseJudgments = new Map<string, number>();
  const pad = (v: string, n: number) => v.padEnd(n);
  console.log(
    `\n${pad("candidate", 24)}${pad("dimension", 11)}${pad("simΔ", 9)}${pad("rank", 7)}${pad("scoreΔ", 8)}verdict`,
  );

  for (const variant of biasVariants) {
    const candidate = candidateBySlug.get(variant.candidate);
    const jobSlug = goldenJobByCandidate.get(variant.candidate);
    const job = jobSlug ? jobBySlug.get(jobSlug) : undefined;
    if (!candidate || !job || !jobSlug) {
      throw new Error(`bias-set references unknown pair: ${variant.candidate}`);
    }
    const jobText = composeJobText(job);
    const queryVec = queryVectors.get(jobSlug)!;

    const baseText = composeCandidateText(candidate);
    const variantText = variant.transform(baseText);

    // Retrieval stability: recompute the variant's similarity and check
    // whether its rank among the (unchanged) other candidates flips.
    const [variantVec] = await embedMany([variantText], "document", embedCfg);
    const baseSim = cosine(queryVec, candidate.embedding!);
    const variantSim = cosine(queryVec, variantVec);
    const otherSims = candidateRows
      .filter((c) => c.slug !== variant.candidate)
      .map((c) => cosine(queryVec, c.embedding!));
    const baseRank = 1 + otherSims.filter((s) => s > baseSim).length;
    const variantRank = 1 + otherSims.filter((s) => s > variantSim).length;
    const rankChanged = variantRank !== baseRank;

    // Judge stability.
    if (!baseJudgments.has(variant.candidate)) {
      const base = await judgeFit(jobText, baseText, rerankCfg);
      baseJudgments.set(variant.candidate, base.score);
    }
    const variantJudgment = await judgeFit(jobText, variantText, rerankCfg);
    const scoreDelta =
      variantJudgment.score - baseJudgments.get(variant.candidate)!;

    const pass = !rankChanged && Math.abs(scoreDelta) <= SCORE_TOLERANCE;
    if (!pass) failures++;
    console.log(
      `${pad(variant.candidate, 24)}${pad(variant.dimension, 11)}${pad((variantSim - baseSim).toFixed(4), 9)}${pad(`${baseRank}>${variantRank}`, 7)}${pad(String(scoreDelta), 8)}${pass ? "PASS" : "FAIL"}`,
    );
  }

  console.log(
    `\n${failures === 0 ? `bias eval passed (score tolerance ±${SCORE_TOLERANCE})` : `bias eval: ${failures} violation(s)`}`,
  );
  if (failures > 0) {
    process.exitCode = 1;
  }
} catch (e) {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
