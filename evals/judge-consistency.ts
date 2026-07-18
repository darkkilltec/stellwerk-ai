import { closeDb } from "@/lib/db";
import {
  CONSISTENCY_CASES,
  CONSISTENCY_JOB,
} from "@/lib/reranking/consistency-cases";
import { judgeFit } from "@/lib/reranking/client";
import { getValidatedRerankSettings } from "@/lib/settings";

// Runs the shared judge-consistency cases against the ACTIVE judge config
// and prompt (including a prompt-lab override). Run: bun run eval:judge.

try {
  const cfg = await getValidatedRerankSettings();
  let failures = 0;
  for (const c of CONSISTENCY_CASES) {
    const j = await judgeFit(CONSISTENCY_JOB, c.profile, cfg);
    const problem = c.check(j.score, j.missingRequirements);
    console.log(
      `${problem ? "✗" : "✓"} ${c.name}: score ${j.score}, missing [${j.missingRequirements.join(", ")}]${problem ? ` — ${problem}` : ""}`,
    );
    if (problem) failures++;
  }
  if (failures > 0) {
    console.error(`\njudge consistency: ${failures} violation(s)`);
    process.exitCode = 1;
  } else {
    console.log("\njudge consistency passed");
  }
} catch (e) {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
