import { and, asc, eq, inArray } from "drizzle-orm";
import {
  candidates,
  evaluationItems,
  evaluationRuns,
  rerankCache,
} from "@/db/schema";
import { getDb } from "@/lib/db";
import { embedSourceHash } from "@/lib/embedding/compose";
import {
  DEFAULT_SYSTEM_PROMPT,
  judgeFit,
  RerankError,
  type RerankConfig,
} from "@/lib/reranking/client";
import { getValidatedRerankSettings } from "@/lib/settings";

const globalForEvaluation = globalThis as unknown as {
  evaluationActiveRuns?: Set<string>;
};

// One in-process worker per run. Stored on globalThis so the guard spans
// every bundle that loads this module (instrumentation + server actions).
const activeRuns = (globalForEvaluation.evaluationActiveRuns ??= new Set<string>());

const BATCH_SIZE = 10;

export function startEvaluationWorker(runId: string): void {
  if (activeRuns.has(runId)) return;
  activeRuns.add(runId);
  void runWorker(runId).finally(() => activeRuns.delete(runId));
}

async function runWorker(runId: string): Promise<void> {
  const db = getDb();
  try {
    const [run] = await db
      .select()
      .from(evaluationRuns)
      .where(eq(evaluationRuns.id, runId));
    if (!run || run.status !== "running") return;
    const cfg = await getValidatedRerankSettings();
    const jobHash = embedSourceHash(run.queryText);
    const promptHash = embedSourceHash(
      cfg.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    );
    const concurrency = cfg.provider === "ollama" ? 1 : 3;

    for (;;) {
      // Re-check per batch so cancel takes effect quickly.
      const [current] = await db
        .select({ status: evaluationRuns.status })
        .from(evaluationRuns)
        .where(eq(evaluationRuns.id, runId));
      if (!current || current.status !== "running") return;

      const batch = await db
        .select()
        .from(evaluationItems)
        .where(
          and(
            eq(evaluationItems.runId, runId),
            eq(evaluationItems.status, "pending"),
          ),
        )
        .orderBy(asc(evaluationItems.candidateName))
        .limit(BATCH_SIZE);
      if (batch.length === 0) break;

      let next = 0;
      const judgeSlot = async () => {
        while (next < batch.length) {
          const item = batch[next++];
          await judgeItem(run.queryText, jobHash, promptHash, cfg, item);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(concurrency, batch.length) }, judgeSlot),
      );
    }

    await db
      .update(evaluationRuns)
      .set({ status: "done", finishedAt: new Date() })
      .where(
        and(eq(evaluationRuns.id, runId), eq(evaluationRuns.status, "running")),
      );
  } catch (e) {
    // Unexpected failure (DB gone, config revoked mid-run): mark the run
    // failed; items keep their state, resume re-enters at pending ones.
    console.error(`[evaluation] run ${runId} failed:`, e);
    await db
      .update(evaluationRuns)
      .set({ status: "failed", finishedAt: new Date() })
      .where(
        and(eq(evaluationRuns.id, runId), eq(evaluationRuns.status, "running")),
      )
      .catch(() => {});
  }
}

async function judgeItem(
  queryText: string,
  jobHash: string,
  promptHash: string,
  cfg: RerankConfig,
  item: typeof evaluationItems.$inferSelect,
): Promise<void> {
  const db = getDb();
  try {
    if (!item.candidateId) {
      throw new Error("candidate deleted");
    }
    const [candidate] = await db
      .select({ profile: candidates.profile })
      .from(candidates)
      .where(eq(candidates.id, item.candidateId));
    if (!candidate) {
      throw new Error("candidate deleted");
    }
    const profileHash = embedSourceHash(candidate.profile);

    const [hit] = await db
      .select()
      .from(rerankCache)
      .where(
        and(
          eq(rerankCache.jobHash, jobHash),
          eq(rerankCache.profileHash, profileHash),
          eq(rerankCache.model, cfg.model),
          eq(rerankCache.promptHash, promptHash),
        ),
      );

    const judgment = hit
      ? {
          score: hit.score,
          reasoning: hit.reasoning,
          missingRequirements: hit.missingRequirements,
        }
      : await judgeFit(queryText, candidate.profile, cfg);
    if (!hit) {
      await db
        .insert(rerankCache)
        .values({
          jobHash,
          profileHash,
          model: cfg.model,
          promptHash,
          score: judgment.score,
          reasoning: judgment.reasoning,
          missingRequirements: judgment.missingRequirements,
        })
        .onConflictDoNothing();
    }

    await db
      .update(evaluationItems)
      .set({
        status: "done",
        score: judgment.score,
        reasoning: judgment.reasoning,
        missingRequirements: judgment.missingRequirements,
        error: null,
        judgedAt: new Date(),
      })
      .where(eq(evaluationItems.id, item.id));
  } catch (e) {
    // PII rule: a parse-kind message quotes the raw model completion —
    // store a fixed text instead, never e.message.
    const message =
      e instanceof RerankError && e.kind === "parse"
        ? "model returned invalid JSON"
        : e instanceof Error
          ? e.message
          : String(e);
    await db
      .update(evaluationItems)
      .set({ status: "error", error: message, judgedAt: new Date() })
      .where(eq(evaluationItems.id, item.id));
  }
}

// Pre-flight info for the start button: how many candidates already have
// a cached verdict for this query/model/prompt (a rerun is nearly free).
export async function countCachedVerdicts(
  queryText: string,
): Promise<{ total: number; cached: number }> {
  const db = getDb();
  const cfg = await getValidatedRerankSettings();
  const jobHash = embedSourceHash(queryText);
  const promptHash = embedSourceHash(cfg.systemPrompt ?? DEFAULT_SYSTEM_PROMPT);
  const rows = await db
    .select({ profile: candidates.profile })
    .from(candidates);
  const hashes = rows.map((r) => embedSourceHash(r.profile));
  if (hashes.length === 0) return { total: 0, cached: 0 };
  const cachedRows = await db
    .select({ profileHash: rerankCache.profileHash })
    .from(rerankCache)
    .where(
      and(
        eq(rerankCache.jobHash, jobHash),
        eq(rerankCache.model, cfg.model),
        eq(rerankCache.promptHash, promptHash),
        inArray(rerankCache.profileHash, hashes),
      ),
    );
  const cachedSet = new Set(cachedRows.map((r) => r.profileHash));
  return {
    total: hashes.length,
    cached: hashes.filter((h) => cachedSet.has(h)).length,
  };
}

// Boot hook: pick up runs the previous process left behind. Called from
// instrumentation.ts after migrations.
export async function resumeInterruptedRuns(): Promise<void> {
  try {
    const db = getDb();
    const running = await db
      .select({ id: evaluationRuns.id })
      .from(evaluationRuns)
      .where(eq(evaluationRuns.status, "running"));
    for (const run of running) {
      const [pending] = await db
        .select({ id: evaluationItems.id })
        .from(evaluationItems)
        .where(
          and(
            eq(evaluationItems.runId, run.id),
            eq(evaluationItems.status, "pending"),
          ),
        )
        .limit(1);
      if (pending) {
        console.log(`[evaluation] resuming interrupted run ${run.id}`);
        startEvaluationWorker(run.id);
      } else {
        await db
          .update(evaluationRuns)
          .set({ status: "done", finishedAt: new Date() })
          .where(eq(evaluationRuns.id, run.id));
      }
    }
  } catch (e) {
    // Never block boot on this.
    console.error("[evaluation] resume check failed:", e);
  }
}
