# Bewertungsläufe (Evaluation Runs) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hintergrund-Läufe, die ALLE Kandidaten für einen Job/Freitext per LLM bewerten — crash-sicher (DB-Queue), wiederaufnehmbar, mit persistenter Historie (`/runs`) und Rangliste inkl. Interview-Button.

**Architecture:** Zwei neue Tabellen (`evaluation_runs`, `evaluation_items` als dauerhafte Verdikt-Snapshots) + fire-and-forget Worker-Loop im Next-Prozess mit `rerank_cache`-Durchgriff (Hit = kein LLM-Call). Start/Cancel/Resume als Server Actions; Auto-Resume beim Boot über `instrumentation.ts`; Run-Detailseite pollt per Client-Intervall + `router.refresh()`.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, Drizzle/Postgres, Bun (+ `bun:test`). Keine neuen Dependencies.

**Spec:** `docs/superpowers/specs/2026-07-18-evaluation-runs-design.md`

## Global Constraints

- **KEINE Branches, KEINE Commits durch Agenten** — der Nutzer committet selbst. Am Ende jedes Tasks nur die vorgeschlagene Commit-Message ausgeben.
- UI-Texte immer in **beiden** Locales (`de` und `en`) in `lib/i18n/dictionaries.ts` (`Dictionary = typeof de`, `const en: Dictionary` — tsc erzwingt Paritität). Fehler als Codes, nie rohe Strings.
- **PII-Regel:** parse-Kind-Fehlertexte zitieren die rohe LLM-Completion und dürfen NIRGENDS erscheinen — am `evaluation_items.error` landet für `kind === "parse"` nur der feste Text `"model returned invalid JSON"`, nie `e.message`.
- Jede Server Action macht als ERSTES ihren eigenen Auth-Check (`isAuthenticated()`).
- LLM-Zugang ausschließlich über `getValidatedRerankSettings()`; Cache-Schlüssel exakt wie in `lib/matching.ts`: `jobHash = embedSourceHash(queryText)`, `profileHash = embedSourceHash(profile)`, `promptHash = embedSourceHash(cfg.systemPrompt ?? DEFAULT_SYSTEM_PROMPT)`, plus `model`.
- Verifikation pro Task: `bunx tsc --noEmit && bun run lint`; wo Tests existieren zusätzlich `bun test lib/`. DB-Kommandos brauchen die laufende DB: `podman compose up -d db` (KEIN docker auf diesem System).
- Zeitgesteuerte Läufe, Export, Benachrichtigungen, Lauf-Löschen: OUT OF SCOPE.

## File Structure

- **Modify** `db/schema.ts` — Tabellen `evaluationRuns`, `evaluationItems`; Migration via `bun run db:generate`.
- **Create** `lib/evaluation/helpers.ts` + `lib/evaluation/helpers.test.ts` — pure, testbare Fortschritts-/Sortier-Helper.
- **Create** `lib/evaluation/worker.ts` — Worker-Loop, `countCachedVerdicts`, `resumeInterruptedRuns`.
- **Modify** `instrumentation.ts` — Resume-Hook nach den Migrationen.
- **Modify** `app/actions.ts` — `startEvaluationRun`, `cancelEvaluationRun`, `resumeEvaluationRun`.
- **Create** `app/components/score-tier.ts` — `scoreTier` aus `rerank-stream-list.tsx` extrahiert (Server-tauglich, kein `"use client"`).
- **Modify** `app/components/rerank-stream-list.tsx` — `scoreTier` importieren statt lokal; `InterviewSection` exportieren.
- **Create** `app/components/start-run-form.tsx` — Start-Button + Vorab-Info auf der Matching-Seite.
- **Modify** `app/matching/page.tsx` — StartRunForm einbinden.
- **Create** `app/runs/page.tsx` — Lauf-Historie.
- **Create** `app/runs/[id]/page.tsx` — Detailseite mit Rangliste.
- **Create** `app/components/run-poller.tsx` — Client-Poller (`router.refresh()` solange `running`).
- **Modify** `app/components/header.tsx` — Nav-Punkt `/runs`.
- **Modify** `lib/i18n/dictionaries.ts` — Sektion `runs` (de + en), `nav.runs`.

---

### Task 1: Schema + Migration

**Files:**
- Modify: `db/schema.ts` (ans Dateiende, nach `jobs`)
- Neue Migration: `bun run db:generate` erzeugt `db/migrations/0008_*.sql`

**Interfaces:**
- Consumes: bestehende Tabellen `jobs`, `candidates`; Drizzle-Helper (`uuid`, `text`, `integer`, `real`, `jsonb`, `timestamp`, `index`, `uniqueIndex`) — alle bereits importiert.
- Produces: `evaluationRuns`, `evaluationItems` (Export-Namen exakt so). Status-Strings: Runs `"running" | "done" | "cancelled" | "failed"`, Items `"pending" | "done" | "error"`. Alle späteren Tasks verlassen sich auf diese Spaltennamen.

- [ ] **Step 1: Tabellen in `db/schema.ts` ergänzen**

```ts
// Background evaluation runs: judge ALL candidates for one job/query.
// Items are verdict COPIES (archive) — rerank_cache stays the invalidable
// working store, runs remain readable after prompt/model changes.
export const evaluationRuns = pgTable("evaluation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Null for free-text queries; kept readable via queryText snapshot.
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
  queryText: text("query_text").notNull(),
  model: text("model").notNull(),
  promptHash: text("prompt_hash").notNull(),
  status: text("status").notNull().default("running"), // running|done|cancelled|failed
  total: integer("total").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const evaluationItems = pgTable(
  "evaluation_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => evaluationRuns.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id").references(() => candidates.id, {
      onDelete: "set null",
    }),
    // Snapshot so the run stays readable if the candidate is deleted.
    candidateName: text("candidate_name").notNull(),
    status: text("status").notNull().default("pending"), // pending|done|error
    score: real("score"),
    reasoning: text("reasoning"),
    missingRequirements: jsonb("missing_requirements")
      .$type<string[]>()
      .notNull()
      .default([]),
    error: text("error"),
    judgedAt: timestamp("judged_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("evaluation_items_run_candidate_idx").on(
      table.runId,
      table.candidateId,
    ),
    index("evaluation_items_run_status_idx").on(table.runId, table.status),
  ],
);
```

- [ ] **Step 2: Migration generieren und anwenden**

Run: `bun run db:generate` — Expected: neue Datei `db/migrations/0008_*.sql` mit beiden `CREATE TABLE`.
Run: `podman compose up -d db && bun run db:migrate` — Expected: `migrations applied` ohne Fehler.

- [ ] **Step 3: Typecheck + Lint**

Run: `bunx tsc --noEmit && bun run lint`
Expected: keine Fehler.

- [ ] **Step 4: Commit-Message ausgeben (NICHT committen)**

Vorschlag: `feat: evaluation runs schema — durable per-candidate verdict snapshots`

---

### Task 2: Pure Helper (TDD)

**Files:**
- Create: `lib/evaluation/helpers.ts`
- Test: `lib/evaluation/helpers.test.ts`

**Interfaces:**
- Produces:
  `type ItemStatus = "pending" | "done" | "error"`,
  `summarizeItems(statuses: ItemStatus[]): { total: number; done: number; error: number; pending: number; percent: number }` (percent = gerundeter Anteil abgeschlossener — done+error — an total; 100 bei total 0),
  `rankItems<T extends { candidateName: string; score: number | null }>(items: T[]): T[]` (absteigend nach score — null wie -1 —, bei Gleichstand candidateName aufsteigend; Eingabe wird nicht mutiert).
  Tasks 7/8 konsumieren beide.

- [ ] **Step 1: Failing Tests schreiben (`lib/evaluation/helpers.test.ts`)**

```ts
import { describe, expect, test } from "bun:test";
import { rankItems, summarizeItems } from "./helpers";

describe("summarizeItems", () => {
  test("counts statuses and percent of settled items", () => {
    expect(
      summarizeItems(["done", "done", "error", "pending"]),
    ).toEqual({ total: 4, done: 2, error: 1, pending: 1, percent: 75 });
  });

  test("empty run is 100 percent settled", () => {
    expect(summarizeItems([])).toEqual({
      total: 0,
      done: 0,
      error: 0,
      pending: 0,
      percent: 100,
    });
  });

  test("all pending is 0 percent", () => {
    expect(summarizeItems(["pending", "pending"]).percent).toBe(0);
  });
});

describe("rankItems", () => {
  test("sorts by score desc, name asc on ties, null score last", () => {
    const ranked = rankItems([
      { candidateName: "Zoe", score: 70 },
      { candidateName: "Anna", score: 90 },
      { candidateName: "Ben", score: 70 },
      { candidateName: "Nora", score: null },
    ]);
    expect(ranked.map((r) => r.candidateName)).toEqual([
      "Anna",
      "Ben",
      "Zoe",
      "Nora",
    ]);
  });

  test("does not mutate the input array", () => {
    const input = [
      { candidateName: "B", score: 1 },
      { candidateName: "A", score: 2 },
    ];
    rankItems(input);
    expect(input[0].candidateName).toBe("B");
  });
});
```

- [ ] **Step 2: Tests laufen lassen — FAIL**

Run: `bun test lib/evaluation`
Expected: FAIL — Modul `./helpers` nicht gefunden.

- [ ] **Step 3: `lib/evaluation/helpers.ts` implementieren**

```ts
// Pure, DB-free pieces of the evaluation-run feature — kept separate so
// progress math and ranking are unit-testable without a worker.

export type ItemStatus = "pending" | "done" | "error";

export function summarizeItems(statuses: ItemStatus[]): {
  total: number;
  done: number;
  error: number;
  pending: number;
  percent: number;
} {
  const total = statuses.length;
  const done = statuses.filter((s) => s === "done").length;
  const error = statuses.filter((s) => s === "error").length;
  const pending = total - done - error;
  const percent = total === 0 ? 100 : Math.round(((done + error) / total) * 100);
  return { total, done, error, pending, percent };
}

export function rankItems<
  T extends { candidateName: string; score: number | null },
>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      (b.score ?? -1) - (a.score ?? -1) ||
      a.candidateName.localeCompare(b.candidateName),
  );
}
```

- [ ] **Step 4: Tests laufen lassen — PASS**

Run: `bun test lib/evaluation` — Expected: 5/5 PASS.
Run: `bunx tsc --noEmit && bun run lint` — Expected: keine Fehler.

- [ ] **Step 5: Commit-Message ausgeben (NICHT committen)**

Vorschlag: `feat: evaluation-run progress and ranking helpers`

---

### Task 3: Worker + Resume-Hook

**Files:**
- Create: `lib/evaluation/worker.ts`
- Modify: `instrumentation.ts`

**Interfaces:**
- Consumes: `evaluationRuns`, `evaluationItems`, `candidates`, `rerankCache` aus `db/schema.ts`; `getDb` aus `lib/db.ts`; `embedSourceHash` aus `lib/embedding/compose.ts`; `judgeFit`, `DEFAULT_SYSTEM_PROMPT`, `RerankError`, `type RerankConfig` aus `lib/reranking/client.ts`; `getValidatedRerankSettings` aus `lib/settings.ts`.
- Produces: `startEvaluationWorker(runId: string): void` (fire-and-forget, idempotent), `countCachedVerdicts(queryText: string): Promise<{ total: number; cached: number }>`, `resumeInterruptedRuns(): Promise<void>`. Tasks 4/6 und instrumentation konsumieren exakt diese Signaturen.

- [ ] **Step 1: `lib/evaluation/worker.ts` implementieren**

```ts
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

// One in-process worker per run. The set makes start idempotent — a
// second start (resume button + boot hook racing) is a no-op.
const activeRuns = new Set<string>();

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
      .where(eq(evaluationRuns.id, runId))
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
```

- [ ] **Step 2: `instrumentation.ts` erweitern**

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runMigrations } = await import("./db/migrate");
    await runMigrations();
    console.log("[db] migrations applied");
    const { resumeInterruptedRuns } = await import("./lib/evaluation/worker");
    await resumeInterruptedRuns();
  }
}
```

- [ ] **Step 3: Typecheck + Lint + bestehende Tests**

Run: `bunx tsc --noEmit && bun run lint && bun test lib/`
Expected: alles grün (helpers- + resume-Tests unverändert).

- [ ] **Step 4: Commit-Message ausgeben (NICHT committen)**

Vorschlag: `feat: evaluation worker — cache-aware background judging with boot resume`

---

### Task 4: Server Actions start/cancel/resume

**Files:**
- Modify: `app/actions.ts`

**Interfaces:**
- Consumes: `startEvaluationWorker` aus `lib/evaluation/worker.ts` (Task 3); `evaluationRuns`, `evaluationItems` aus `db/schema.ts`; bereits importiert in actions.ts: `isAuthenticated`, `getDb`, `candidates`, `jobs`, `composeJobText`, `getValidatedRerankSettings`, `type RerankConfig`, `eq`, `revalidatePath`, `redirect`, `DEFAULT_SYSTEM_PROMPT`; zusätzlich `embedSourceHash` aus `lib/embedding/compose.ts` und `and` aus `drizzle-orm` importieren.
- Produces:
  `type StartRunState = { status: "error"; kind: "validation" | "unauthorized" | "notConfigured"; detail?: string } | undefined`,
  `startEvaluationRun(_prev: StartRunState, formData: FormData): Promise<StartRunState>` (FormData-Felder: `job` = Job-UUID ODER `q` = Freitext; bei Erfolg redirect auf `/runs/<id>` — kehrt nie zurück),
  `cancelEvaluationRun(formData: FormData): Promise<void>` (Feld `runId`),
  `resumeEvaluationRun(formData: FormData): Promise<void>` (Feld `runId`).
  Task 6 nutzt `startEvaluationRun` mit `useActionState`; Task 8 nutzt cancel/resume in einfachen `<form action={...}>`.

- [ ] **Step 1: Actions ans Ende von `app/actions.ts`**

Imports oben ergänzen (`and` zu drizzle-orm-Import, plus):

```ts
import { and, eq } from "drizzle-orm";
import { embedSourceHash } from "@/lib/embedding/compose";
import { evaluationItems, evaluationRuns } from "@/db/schema";
import { startEvaluationWorker } from "@/lib/evaluation/worker";
```

(`eq` ist seit dem Interview-Task importiert — Import-Zeile entsprechend zusammenführen.)

```ts
export type StartRunState =
  | {
      status: "error";
      kind: "validation" | "unauthorized" | "notConfigured";
      detail?: string;
    }
  | undefined;

const UUID_RE = /^[0-9a-f-]{36}$/i;

// Kick off a full-database evaluation run: one pending item per
// candidate, then a fire-and-forget worker. On success this redirects to
// the run page and never returns.
export async function startEvaluationRun(
  _prev: StartRunState,
  formData: FormData,
): Promise<StartRunState> {
  if (!(await isAuthenticated())) {
    return { status: "error", kind: "unauthorized" };
  }
  const jobParam = formData.get("job");
  const q = formData.get("q");
  const db = getDb();
  let jobId: string | null = null;
  let queryText: string | undefined;
  if (typeof q === "string" && q.trim() !== "") {
    queryText = q.trim();
  } else if (typeof jobParam === "string" && UUID_RE.test(jobParam)) {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobParam));
    if (job) {
      jobId = job.id;
      queryText = composeJobText(job);
    }
  }
  if (!queryText) {
    return { status: "error", kind: "validation" };
  }
  let cfg: RerankConfig;
  try {
    cfg = await getValidatedRerankSettings();
  } catch (e) {
    return {
      status: "error",
      kind: "notConfigured",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
  const all = await db
    .select({ id: candidates.id, name: candidates.name })
    .from(candidates);
  if (all.length === 0) {
    return { status: "error", kind: "validation" };
  }
  const [run] = await db
    .insert(evaluationRuns)
    .values({
      jobId,
      queryText,
      model: cfg.model,
      promptHash: embedSourceHash(cfg.systemPrompt ?? DEFAULT_SYSTEM_PROMPT),
      total: all.length,
    })
    .returning({ id: evaluationRuns.id });
  await db.insert(evaluationItems).values(
    all.map((candidate) => ({
      runId: run.id,
      candidateId: candidate.id,
      candidateName: candidate.name,
    })),
  );
  startEvaluationWorker(run.id);
  revalidatePath("/runs");
  redirect(`/runs/${run.id}`);
}

export async function cancelEvaluationRun(formData: FormData): Promise<void> {
  if (!(await isAuthenticated())) return;
  const runId = formData.get("runId");
  if (typeof runId !== "string" || !UUID_RE.test(runId)) return;
  await getDb()
    .update(evaluationRuns)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(
      and(eq(evaluationRuns.id, runId), eq(evaluationRuns.status, "running")),
    );
  revalidatePath(`/runs/${runId}`);
  revalidatePath("/runs");
}

// Restart the worker for a run the process lost (crash → still
// "running") or that failed mid-way; idempotent via the worker's
// in-process set.
export async function resumeEvaluationRun(formData: FormData): Promise<void> {
  if (!(await isAuthenticated())) return;
  const runId = formData.get("runId");
  if (typeof runId !== "string" || !UUID_RE.test(runId)) return;
  const db = getDb();
  const [run] = await db
    .select({ status: evaluationRuns.status })
    .from(evaluationRuns)
    .where(eq(evaluationRuns.id, runId));
  if (!run || (run.status !== "running" && run.status !== "failed")) return;
  const [pending] = await db
    .select({ id: evaluationItems.id })
    .from(evaluationItems)
    .where(
      and(
        eq(evaluationItems.runId, runId),
        eq(evaluationItems.status, "pending"),
      ),
    )
    .limit(1);
  if (!pending) return;
  await db
    .update(evaluationRuns)
    .set({ status: "running", finishedAt: null })
    .where(eq(evaluationRuns.id, runId));
  startEvaluationWorker(runId);
  revalidatePath(`/runs/${runId}`);
  revalidatePath("/runs");
}
```

Hinweis: Das bestehende UUID-Regex in `generateInterviewQuestions` (`/^[0-9a-f-]{36}$/i`) durch die neue Konstante `UUID_RE` ersetzen (eine Definition, drei Nutzer).

- [ ] **Step 2: Typecheck + Lint**

Run: `bunx tsc --noEmit && bun run lint` — Expected: keine Fehler.

- [ ] **Step 3: Commit-Message ausgeben (NICHT committen)**

Vorschlag: `feat: start/cancel/resume actions for evaluation runs`

---

### Task 5: i18n + Nav + scoreTier-Extraktion

**Files:**
- Create: `app/components/score-tier.ts`
- Modify: `app/components/rerank-stream-list.tsx` (scoreTier entfernen + importieren; `InterviewSection` exportieren)
- Modify: `app/components/header.tsx`
- Modify: `lib/i18n/dictionaries.ts`

**Interfaces:**
- Produces: `scoreTier(t: Dictionary["matching"], score: number): { dot: string; label: string }` aus `app/components/score-tier.ts` (Server-tauglich — Datei OHNE `"use client"`); `export function InterviewSection` aus `rerank-stream-list.tsx` (Props unverändert: `{ t: Dictionary["matching"]; candidateId: string; jobText: string; missing: string[] }`); Dictionary-Sektion `runs` + Key `nav.runs`. Tasks 6–8 konsumieren all das.

- [ ] **Step 1: `app/components/score-tier.ts` anlegen**

Die Funktion 1:1 aus `rerank-stream-list.tsx` hierher verschieben (kein `"use client"` — sie muss auch in Server-Komponenten der Run-Seite laufen):

```ts
import type { Dictionary } from "@/lib/i18n";

// Tiers mirror the judge prompt's own scoring guide (90+/70+/40+), so the
// color always means what the number means.
export function scoreTier(
  t: Dictionary["matching"],
  score: number,
): { dot: string; label: string } {
  if (score >= 90) return { dot: "bg-gold", label: t.tierExcellent };
  if (score >= 70) return { dot: "bg-ok", label: t.tierStrong };
  if (score >= 40) return { dot: "bg-warn", label: t.tierPartial };
  return { dot: "bg-danger", label: t.tierWeak };
}
```

In `rerank-stream-list.tsx`: lokale `scoreTier`-Definition löschen, stattdessen `import { scoreTier } from "./score-tier";` und vor `function InterviewSection` ein `export` setzen.

- [ ] **Step 2: Dictionary erweitern**

`de.nav` bekommt `runs: "Bewertungsläufe",` (und `en.nav` `runs: "Evaluation runs",`).

Neue Sektion `runs` im `de`-Objekt (nach `matching`):

```ts
runs: {
  heading: "Bewertungsläufe",
  empty: "Noch keine Läufe — auf der Matching-Seite „Alle Kandidaten bewerten“ starten.",
  startButton: "Alle Kandidaten bewerten",
  startPending: "Starte Lauf …",
  startHint: "Bewertet jeden Kandidaten in der Datenbank für diesen Job — läuft im Hintergrund weiter.",
  cachedInfo: "bereits im Cache",
  candidatesLabel: "Kandidaten",
  statusRunning: "läuft",
  statusDone: "fertig",
  statusCancelled: "abgebrochen",
  statusFailed: "fehlgeschlagen",
  progress: "Fortschritt",
  errorsLabel: "Fehler",
  cancel: "Abbrechen",
  resume: "Fortsetzen",
  startedAt: "Gestartet",
  finishedAt: "Beendet",
  freeTextQuery: "Freitext-Suche",
  modelLabel: "Modell",
  ranking: "Rangliste",
  errorItemsHeading: "Fehlgeschlagene Bewertungen",
  notConfigured: "Kein Judge-LLM konfiguriert — unter Einstellungen einrichten.",
  validation: "Lauf konnte nicht gestartet werden — Eingaben/Kandidaten prüfen.",
},
```

`en`-Pendant an gleicher Stelle:

```ts
runs: {
  heading: "Evaluation runs",
  empty: "No runs yet — start one via “Evaluate all candidates” on the matching page.",
  startButton: "Evaluate all candidates",
  startPending: "Starting run …",
  startHint: "Judges every candidate in the database for this job — keeps running in the background.",
  cachedInfo: "already cached",
  candidatesLabel: "candidates",
  statusRunning: "running",
  statusDone: "done",
  statusCancelled: "cancelled",
  statusFailed: "failed",
  progress: "Progress",
  errorsLabel: "Errors",
  cancel: "Cancel",
  resume: "Resume",
  startedAt: "Started",
  finishedAt: "Finished",
  freeTextQuery: "Free-text query",
  modelLabel: "Model",
  ranking: "Ranking",
  errorItemsHeading: "Failed evaluations",
  notConfigured: "No judge LLM configured — set it up under Settings.",
  validation: "Run could not be started — check input/candidates.",
},
```

- [ ] **Step 3: Nav-Link in `app/components/header.tsx`**

Im authentifizierten `<nav>`-Block nach dem Matching-Link:

```tsx
<Link href="/runs" className={navLink}>
  {dict.nav.runs}
</Link>
```

- [ ] **Step 4: Typecheck + Lint**

Run: `bunx tsc --noEmit && bun run lint` — Expected: keine Fehler (beweist u. a. en/de-Parität und dass die scoreTier-Extraktion keinen Import bricht).

- [ ] **Step 5: Commit-Message ausgeben (NICHT committen)**

Vorschlag: `feat: runs i18n, nav entry, shared score-tier helper`

---

### Task 6: StartRunForm + Matching-Einbindung

**Files:**
- Create: `app/components/start-run-form.tsx`
- Modify: `app/matching/page.tsx`

**Interfaces:**
- Consumes: `startEvaluationRun`, `type StartRunState` aus `app/actions.ts` (Task 4); `countCachedVerdicts` aus `lib/evaluation/worker.ts` (Task 3); `isRerankConfigured` aus `lib/settings.ts` (auf der Page bereits als `rerankAvailable` vorhanden).
- Produces: `StartRunForm({ t, jobParam, query, total, cached })` — Client-Komponente; die Page rendert sie unter den Ergebnissen, wenn `retrieved && queryText && rerankAvailable`.

- [ ] **Step 1: `app/components/start-run-form.tsx` anlegen**

```tsx
"use client";

import { useActionState } from "react";
import { startEvaluationRun, type StartRunState } from "@/app/actions";
import type { Dictionary } from "@/lib/i18n";

// Start card for a full-database evaluation run. Success redirects to
// /runs/<id> from the action, so only error states render here.
export function StartRunForm({
  t,
  jobParam,
  query,
  total,
  cached,
}: {
  t: Dictionary["runs"];
  jobParam?: string;
  query?: string;
  total: number;
  cached: number;
}) {
  const [state, action, pending] = useActionState<StartRunState, FormData>(
    startEvaluationRun,
    undefined,
  );
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <form action={action} className="flex flex-wrap items-center gap-4">
        {jobParam && <input type="hidden" name="job" value={jobParam} />}
        {query && <input type="hidden" name="q" value={query} />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {total} {t.candidatesLabel}
            {cached > 0 && (
              <span className="text-muted"> · {cached} {t.cachedInfo}</span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted">{t.startHint}</p>
          {state?.status === "error" && (
            <p className="mt-1 text-xs text-danger" role="alert">
              {state.kind === "notConfigured" ? t.notConfigured : t.validation}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity disabled:opacity-50"
        >
          {pending ? t.startPending : t.startButton}
        </button>
      </form>
    </section>
  );
}
```

- [ ] **Step 2: In `app/matching/page.tsx` einbinden**

Imports ergänzen:

```ts
import { StartRunForm } from "@/app/components/start-run-form";
import { countCachedVerdicts } from "@/lib/evaluation/worker";
```

Im Page-Body, nach der `retrieved`-Berechnung: Vorabzählung nur wenn Lauf-Start möglich ist —

```ts
let runPrecount: { total: number; cached: number } | null = null;
if (retrieved && queryText && rerankAvailable) {
  try {
    runPrecount = await countCachedVerdicts(queryText);
  } catch {
    runPrecount = null;
  }
}
```

Im JSX nach dem `<RankedResults …/>`-Block (innerhalb desselben `{retrieved && queryText && (…)}`-Wrappers, direkt nach RankedResults):

```tsx
{runPrecount && (
  <StartRunForm
    t={dict.runs}
    jobParam={jobParam}
    query={query}
    total={runPrecount.total}
    cached={runPrecount.cached}
  />
)}
```

- [ ] **Step 3: Typecheck + Lint**

Run: `bunx tsc --noEmit && bun run lint` — Expected: keine Fehler.

- [ ] **Step 4: Commit-Message ausgeben (NICHT committen)**

Vorschlag: `feat: start-evaluation-run card on the matching page with cache precount`

---

### Task 7: `/runs` — Historien-Seite

**Files:**
- Create: `app/runs/page.tsx`

**Interfaces:**
- Consumes: `evaluationRuns`, `evaluationItems`, `jobs` aus `db/schema.ts`; `summarizeItems`, `type ItemStatus` aus `lib/evaluation/helpers.ts`; Auth-/Dict-Muster wie `app/candidates/page.tsx`.
- Produces: Seite unter `/runs`; Link-Ziel `/runs/<id>` (Task 8).

- [ ] **Step 1: `app/runs/page.tsx` anlegen**

```tsx
import { desc, inArray } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { evaluationItems, evaluationRuns, jobs } from "@/db/schema";
import { isAuthenticated } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getDictionary, type Dictionary } from "@/lib/i18n";
import { summarizeItems, type ItemStatus } from "@/lib/evaluation/helpers";

function statusBadge(t: Dictionary["runs"], status: string) {
  switch (status) {
    case "running":
      return { label: t.statusRunning, cls: "bg-warn" };
    case "done":
      return { label: t.statusDone, cls: "bg-ok" };
    case "cancelled":
      return { label: t.statusCancelled, cls: "bg-border" };
    default:
      return { label: t.statusFailed, cls: "bg-danger" };
  }
}

export default async function RunsPage() {
  if (!(await isAuthenticated())) {
    redirect("/");
  }
  const dict = await getDictionary();
  const t = dict.runs;
  const db = getDb();
  const runs = await db
    .select()
    .from(evaluationRuns)
    .orderBy(desc(evaluationRuns.createdAt));

  const jobIds = runs
    .map((run) => run.jobId)
    .filter((id): id is string => id !== null);
  const jobRows = jobIds.length
    ? await db
        .select({ id: jobs.id, title: jobs.title })
        .from(jobs)
        .where(inArray(jobs.id, jobIds))
    : [];
  const jobTitles = new Map(jobRows.map((j) => [j.id, j.title]));

  const itemRows = runs.length
    ? await db
        .select({
          runId: evaluationItems.runId,
          status: evaluationItems.status,
        })
        .from(evaluationItems)
        .where(
          inArray(
            evaluationItems.runId,
            runs.map((run) => run.id),
          ),
        )
    : [];
  const byRun = new Map<string, ItemStatus[]>();
  for (const row of itemRows) {
    const list = byRun.get(row.runId) ?? [];
    list.push(row.status as ItemStatus);
    byRun.set(row.runId, list);
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <h1 className="text-xs font-medium uppercase tracking-wider text-muted">
        {t.heading} <span className="font-mono">({runs.length})</span>
      </h1>
      {runs.length === 0 ? (
        <p className="font-mono text-sm text-muted">{t.empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {runs.map((run) => {
            const badge = statusBadge(t, run.status);
            const progress = summarizeItems(byRun.get(run.id) ?? []);
            return (
              <li key={run.id}>
                <Link
                  href={`/runs/${run.id}`}
                  className="flex items-center gap-4 p-4 transition-colors hover:bg-background"
                >
                  <span
                    className={`inline-block size-2 shrink-0 rounded-full ${badge.cls}`}
                    aria-label={badge.label}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {run.jobId
                        ? (jobTitles.get(run.jobId) ?? t.freeTextQuery)
                        : t.freeTextQuery}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {run.createdAt.toLocaleString()} · {badge.label}
                      {progress.error > 0 &&
                        ` · ${progress.error} ${t.errorsLabel}`}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted">
                    {progress.done + progress.error}/{run.total}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Typecheck + Lint**

Run: `bunx tsc --noEmit && bun run lint` — Expected: keine Fehler.

- [ ] **Step 3: Commit-Message ausgeben (NICHT committen)**

Vorschlag: `feat: evaluation runs history page`

---

### Task 8: `/runs/[id]` — Detailseite mit Rangliste + Poller

**Files:**
- Create: `app/runs/[id]/page.tsx`
- Create: `app/components/run-poller.tsx`

**Interfaces:**
- Consumes: `summarizeItems`, `rankItems` (Task 2); `scoreTier` aus `app/components/score-tier.ts` und `InterviewSection` aus `app/components/rerank-stream-list.tsx` (Task 5); `cancelEvaluationRun`, `resumeEvaluationRun` (Task 4); Dynamic-Route-Muster wie `app/candidates/[id]/page.tsx` (`params: Promise<{ id: string }>`, UUID-Check, `notFound()`).
- Produces: Seite `/runs/<id>`; `RunPoller({ active })` — Client-Komponente, refresht alle 3 s solange `active`.

- [ ] **Step 1: `app/components/run-poller.tsx` anlegen**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Refreshes the server-rendered run page while the worker is busy; goes
// quiet as soon as the run reaches a terminal status.
export function RunPoller({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
```

- [ ] **Step 2: `app/runs/[id]/page.tsx` anlegen**

```tsx
import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  cancelEvaluationRun,
  resumeEvaluationRun,
} from "@/app/actions";
import { BackLink } from "@/app/components/back-link";
import { RunPoller } from "@/app/components/run-poller";
import { InterviewSection } from "@/app/components/rerank-stream-list";
import { scoreTier } from "@/app/components/score-tier";
import { evaluationItems, evaluationRuns, jobs } from "@/db/schema";
import { isAuthenticated } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  rankItems,
  summarizeItems,
  type ItemStatus,
} from "@/lib/evaluation/helpers";
import { getDictionary, type Dictionary } from "@/lib/i18n";

function statusBadge(t: Dictionary["runs"], status: string) {
  switch (status) {
    case "running":
      return { label: t.statusRunning, cls: "bg-warn" };
    case "done":
      return { label: t.statusDone, cls: "bg-ok" };
    case "cancelled":
      return { label: t.statusCancelled, cls: "bg-border" };
    default:
      return { label: t.statusFailed, cls: "bg-danger" };
  }
}

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAuthenticated())) {
    redirect("/");
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    notFound();
  }
  const dict = await getDictionary();
  const t = dict.runs;
  const db = getDb();
  const [run] = await db
    .select()
    .from(evaluationRuns)
    .where(eq(evaluationRuns.id, id));
  if (!run) {
    notFound();
  }
  const items = await db
    .select()
    .from(evaluationItems)
    .where(eq(evaluationItems.runId, id))
    .orderBy(asc(evaluationItems.candidateName));
  const progress = summarizeItems(items.map((i) => i.status as ItemStatus));
  const running = run.status === "running";
  const resumable =
    (run.status === "running" || run.status === "failed") &&
    progress.pending > 0;
  const badge = statusBadge(t, run.status);
  const jobTitle = run.jobId
    ? (
        await db
          .select({ title: jobs.title })
          .from(jobs)
          .where(eq(jobs.id, run.jobId))
      )[0]?.title
    : undefined;
  const ranked = rankItems(items.filter((item) => item.status === "done"));
  const failed = items.filter((item) => item.status === "error");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <RunPoller active={running} />
      <BackLink href="/runs" label={t.heading} />

      <section className="rounded-lg border border-border bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
            {jobTitle ?? t.freeTextQuery}
          </h1>
          <span className="flex items-center gap-2 text-xs text-muted">
            <span
              className={`inline-block size-2 shrink-0 rounded-full ${badge.cls}`}
            />
            {badge.label}
          </span>
        </div>
        <p className="mt-2 line-clamp-3 text-xs text-muted">{run.queryText}</p>
        <div className="mt-4 flex items-center gap-3">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
            <span
              className="block h-full rounded-full bg-foreground transition-all"
              style={{ width: `${progress.percent}%` }}
            />
          </span>
          <span className="shrink-0 font-mono text-xs text-muted">
            {progress.done + progress.error}/{progress.total}
            {progress.error > 0 && ` · ${progress.error} ${t.errorsLabel}`}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
          <span>
            {t.startedAt}: {run.createdAt.toLocaleString()}
          </span>
          {run.finishedAt && (
            <span>
              {t.finishedAt}: {run.finishedAt.toLocaleString()}
            </span>
          )}
          <span>
            {t.modelLabel}: <span className="font-mono">{run.model}</span>
          </span>
          {running && (
            <form action={cancelEvaluationRun}>
              <input type="hidden" name="runId" value={run.id} />
              <button
                type="submit"
                className="rounded-md border border-border px-2 py-1 font-medium transition-colors hover:border-muted"
              >
                {t.cancel}
              </button>
            </form>
          )}
          {resumable && (
            <form action={resumeEvaluationRun}>
              <input type="hidden" name="runId" value={run.id} />
              <button
                type="submit"
                className="rounded-md border border-border px-2 py-1 font-medium transition-colors hover:border-muted"
              >
                {t.resume}
              </button>
            </form>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface">
        <h2 className="border-b border-border p-4 text-xs font-medium uppercase tracking-wider text-muted">
          {t.ranking} <span className="font-mono">({ranked.length})</span>
        </h2>
        <ol className="divide-y divide-border">
          {ranked.map((item, index) => {
            const tier = scoreTier(dict.matching, item.score ?? 0);
            return (
              <li key={item.id} className="p-4">
                <div className="flex items-center gap-4">
                  <span className="w-6 shrink-0 font-mono text-sm text-muted">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {item.candidateId ? (
                      <Link
                        href={`/candidates/${item.candidateId}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {item.candidateName}
                      </Link>
                    ) : (
                      item.candidateName
                    )}
                  </span>
                  <span
                    className="flex w-24 shrink-0 items-center justify-end gap-2 text-right font-mono text-[13px]"
                    title={tier.label}
                  >
                    <span
                      className={`inline-block size-2 shrink-0 rounded-full ${tier.dot}`}
                      aria-label={tier.label}
                    />
                    {dict.matching.score} {Math.round(item.score ?? 0)}
                  </span>
                </div>
                <div className="mt-2 pl-10 text-xs text-muted">
                  {item.reasoning && <p>{item.reasoning}</p>}
                  {item.missingRequirements.length > 0 && (
                    <p className="mt-1">
                      <span className="font-medium">
                        {dict.matching.missing}:
                      </span>{" "}
                      {item.missingRequirements.join(" · ")}
                    </p>
                  )}
                  {item.candidateId && (
                    <InterviewSection
                      t={dict.matching}
                      candidateId={item.candidateId}
                      jobText={run.queryText}
                      missing={item.missingRequirements}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {failed.length > 0 && (
        <section className="rounded-lg border border-danger/40 bg-surface">
          <h2 className="border-b border-border p-4 text-xs font-medium uppercase tracking-wider text-danger">
            {t.errorItemsHeading}{" "}
            <span className="font-mono">({failed.length})</span>
          </h2>
          <ul className="divide-y divide-border">
            {failed.map((item) => (
              <li key={item.id} className="flex items-baseline gap-4 p-4">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {item.candidateName}
                </span>
                <span className="break-all font-mono text-xs text-muted">
                  {item.error}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Typecheck + Lint**

Run: `bunx tsc --noEmit && bun run lint` — Expected: keine Fehler.

- [ ] **Step 4: Commit-Message ausgeben (NICHT committen)**

Vorschlag: `feat: run detail page — live progress, ranked verdicts, cancel/resume`

---

### Task 9: End-to-End-Verifikation (Controller, inline)

**Files:** keine Änderungen — reine Verifikation gegen lokale DB + Ollama.

- [ ] **Step 1: Statik komplett** — `bunx tsc --noEmit && bun run lint && bun test lib/` alles grün.
- [ ] **Step 2: DB + Dev-Server** — `podman compose up -d db`; `bun x next dev` (Boot-Log muss `[db] migrations applied` zeigen, KEIN Resume-Fehler).
- [ ] **Step 3: Lauf über Seed-Daten** — authentifiziert (Session-Cookie via `createSessionToken`) auf `/matching?job=<slug>` die StartRunForm prüfen (Kandidaten-/Cache-Zahl), Lauf starten (POST via UI oder Action), auf `/runs/<id>`: Fortschritt wächst, Status endet auf `fertig`, Rangliste sortiert mit Reasoning + Interview-Button, `/runs` zeigt den Lauf.
- [ ] **Step 4: Cache-Beweis** — zweiten Lauf mit demselben Job starten: muss in Sekunden `done` sein (alle Items Cache-Hits, keine LLM-Calls — ollama-Log ruhig).
- [ ] **Step 5: Resume-Beweis** — dritten Lauf mit anderem Job starten, Dev-Server währenddessen killen, neu starten: Boot-Log zeigt `[evaluation] resuming interrupted run <id>`, Lauf endet `fertig`.
- [ ] **Step 6: Cancel-Pfad** — Lauf starten, sofort Abbrechen klicken: Status `abgebrochen`, Pending-Items bleiben, kein Worker-Log mehr.
- [ ] **Step 7: Abschlussbericht** — Ergebnisse + gesammelte Commit-Messages der Tasks 1–8 an den Nutzer.
