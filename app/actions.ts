"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { candidates, evaluationItems, evaluationRuns, jobs } from "@/db/schema";
import { endSession, isAuthenticated, startSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  composeCandidateText,
  composeJobText,
  embedSourceHash,
} from "@/lib/embedding/compose";
import { embedAndStore } from "@/lib/embedding/store";
import { startEvaluationWorker } from "@/lib/evaluation/worker";
import type {
  EmbeddingConfig,
  EmbeddingErrorKind,
  EmbeddingProvider,
} from "@/lib/embedding/client";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { locales, type Locale } from "@/lib/i18n/dictionaries";
import {
  DEFAULT_SYSTEM_PROMPT,
  judgeFit,
  type RerankConfig,
  type RerankProvider,
} from "@/lib/reranking/client";
import {
  CONSISTENCY_CASES,
  CONSISTENCY_JOB,
} from "@/lib/reranking/consistency-cases";
import {
  getStoredApiKey,
  getStoredRerankApiKey,
  getValidatedRerankSettings,
  testAndSaveEmbeddingConfig,
  testAndSaveRerankConfig,
  updateRerankSystemPrompt,
} from "@/lib/settings";
import { ProviderError, type ProviderErrorKind } from "@/lib/providers/http";
import {
  generateInterviewGuide,
  type InterviewGuide,
} from "@/lib/resume/interview";
import { parseResumeText } from "@/lib/resume/parse";

const UUID_RE = /^[0-9a-f-]{36}$/i;

// Error codes instead of strings so the client can render them in the
// active locale.
export type LoginState =
  | { error: "wrongPassword" | "missingPassword" }
  | undefined;

// Compare via hashes so timingSafeEqual gets equal-length inputs.
function passwordMatches(input: string, expected: string): boolean {
  const a = createHash("sha256").update(input, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    return { error: "missingPassword" };
  }
  const password = formData.get("password");
  if (typeof password !== "string" || !passwordMatches(password, expected)) {
    return { error: "wrongPassword" };
  }
  await startSession();
  revalidatePath("/");
  redirect("/matching");
}

export async function logout(): Promise<void> {
  await endSession();
  revalidatePath("/");
  redirect("/");
}

export type CreateState =
  | { status: "created" }
  | { status: "createdNoEmbedding"; detail: string }
  | { status: "error"; kind: "validation" | "unauthorized" }
  | undefined;

// Shared tail of both create actions: row exists, embed it right away;
// a failing provider degrades to a warning (db:embed heals the row later).
async function embedCreated(
  table: typeof candidates | typeof jobs,
  id: string,
  text: string,
  paths: string[],
): Promise<CreateState> {
  let state: CreateState = { status: "created" };
  try {
    await embedAndStore(table, id, text);
  } catch (e) {
    state = {
      status: "createdNoEmbedding",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
  for (const path of paths) revalidatePath(path);
  return state;
}

export async function createCandidate(
  _prev: CreateState,
  formData: FormData,
): Promise<CreateState> {
  if (!(await isAuthenticated())) {
    return { status: "error", kind: "unauthorized" };
  }
  const name = formData.get("name");
  const profile = formData.get("profile");
  if (
    typeof name !== "string" ||
    name.trim() === "" ||
    typeof profile !== "string" ||
    profile.trim() === ""
  ) {
    return { status: "error", kind: "validation" };
  }
  const row = { name: name.trim(), profile: profile.trim() };
  const [created] = await getDb()
    .insert(candidates)
    .values(row)
    .returning({ id: candidates.id });
  return embedCreated(candidates, created.id, composeCandidateText(row), [
    "/candidates",
    "/matching",
    "/",
  ]);
}

export async function createJob(
  _prev: CreateState,
  formData: FormData,
): Promise<CreateState> {
  if (!(await isAuthenticated())) {
    return { status: "error", kind: "unauthorized" };
  }
  const title = formData.get("title");
  const company = formData.get("company");
  const description = formData.get("description");
  if (
    typeof title !== "string" ||
    title.trim() === "" ||
    typeof description !== "string" ||
    description.trim() === ""
  ) {
    return { status: "error", kind: "validation" };
  }
  const row = {
    title: title.trim(),
    company:
      typeof company === "string" && company.trim() !== ""
        ? company.trim()
        : null,
    description: description.trim(),
  };
  const [created] = await getDb()
    .insert(jobs)
    .values(row)
    .returning({ id: jobs.id });
  return embedCreated(jobs, created.id, composeJobText(row), [
    "/jobs",
    "/matching",
    "/",
  ]);
}

const PROVIDERS: EmbeddingProvider[] = ["openai", "ollama", "voyage"];

export type SettingsSaveState =
  | { status: "saved"; latencyMs: number }
  | {
      status: "error";
      kind: EmbeddingErrorKind | "validation" | "unauthorized";
      detail?: string;
    }
  | undefined;

// Wizard surface over the same test-gated write path the CLI uses.
export async function saveSettings(
  _prev: SettingsSaveState,
  formData: FormData,
): Promise<SettingsSaveState> {
  if (!(await isAuthenticated())) {
    return { status: "error", kind: "unauthorized" };
  }
  const provider = formData.get("provider");
  const model = formData.get("model");
  const apiKey = formData.get("apiKey");
  const baseUrl = formData.get("baseUrl");
  if (
    typeof provider !== "string" ||
    !PROVIDERS.includes(provider as EmbeddingProvider) ||
    typeof model !== "string" ||
    model.trim() === ""
  ) {
    return { status: "error", kind: "validation" };
  }
  const needsKey = provider !== "ollama";
  // Empty key field + same provider = keep the stored key.
  const key =
    typeof apiKey === "string" && apiKey !== ""
      ? apiKey
      : await getStoredApiKey(provider);
  if (needsKey && !key) {
    return { status: "error", kind: "validation" };
  }
  const cfg: EmbeddingConfig = {
    provider: provider as EmbeddingProvider,
    model: model.trim(),
    apiKey: needsKey ? key : undefined,
    baseUrl:
      provider === "ollama" && typeof baseUrl === "string" && baseUrl !== ""
        ? baseUrl.trim()
        : undefined,
  };
  const result = await testAndSaveEmbeddingConfig(cfg);
  if (!result.ok) {
    return { status: "error", kind: result.kind, detail: result.error };
  }
  revalidatePath("/");
  revalidatePath("/settings");
  return { status: "saved", latencyMs: result.latencyMs };
}

const RERANK_PROVIDERS: RerankProvider[] = ["anthropic", "ollama", "openai"];

// Same wizard flow for the re-ranking stage.
export async function saveRerankSettings(
  _prev: SettingsSaveState,
  formData: FormData,
): Promise<SettingsSaveState> {
  if (!(await isAuthenticated())) {
    return { status: "error", kind: "unauthorized" };
  }
  const provider = formData.get("provider");
  const model = formData.get("model");
  const apiKey = formData.get("apiKey");
  const baseUrl = formData.get("baseUrl");
  if (
    typeof provider !== "string" ||
    !RERANK_PROVIDERS.includes(provider as RerankProvider) ||
    typeof model !== "string" ||
    model.trim() === ""
  ) {
    return { status: "error", kind: "validation" };
  }
  const needsKey = provider !== "ollama";
  const key =
    typeof apiKey === "string" && apiKey !== ""
      ? apiKey
      : await getStoredRerankApiKey(provider);
  if (needsKey && !key) {
    return { status: "error", kind: "validation" };
  }
  const cfg: RerankConfig = {
    provider: provider as RerankProvider,
    model: model.trim(),
    apiKey: needsKey ? key : undefined,
    baseUrl:
      provider === "ollama" && typeof baseUrl === "string" && baseUrl !== ""
        ? baseUrl.trim()
        : undefined,
  };
  const result = await testAndSaveRerankConfig(cfg);
  if (!result.ok) {
    return { status: "error", kind: result.kind, detail: result.error };
  }
  revalidatePath("/");
  revalidatePath("/settings");
  return { status: "saved", latencyMs: result.latencyMs };
}

export type PromptCaseResult = {
  name: string;
  score: number | null;
  missing: string[];
  problem: string | null;
};

export type PromptLabState =
  | {
      status: "tested" | "saved" | "gateFailed";
      results: PromptCaseResult[];
      custom?: { score: number; reasoning: string; missing: string[] } | null;
    }
  | { status: "error"; kind: "unauthorized" | "validation"; detail?: string }
  | { status: "reset" }
  | undefined;

// Prompt lab: run the shared consistency cases against a DRAFT prompt;
// saving goes through the same gate — a prompt that fails its own test
// cases is never persisted. Reset returns to the code default.
export async function promptLab(
  _prev: PromptLabState,
  formData: FormData,
): Promise<PromptLabState> {
  if (!(await isAuthenticated())) {
    return { status: "error", kind: "unauthorized" };
  }
  const intent = formData.get("intent");
  if (intent === "reset") {
    await updateRerankSystemPrompt(null);
    revalidatePath("/settings/prompt");
    return { status: "reset" };
  }
  const draft = formData.get("prompt");
  if (typeof draft !== "string" || draft.trim().length < 40) {
    return { status: "error", kind: "validation" };
  }
  let cfg: RerankConfig;
  try {
    cfg = await getValidatedRerankSettings();
  } catch (e) {
    return {
      status: "error",
      kind: "validation",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
  const draftCfg: RerankConfig = { ...cfg, systemPrompt: draft.trim() };

  const results: PromptCaseResult[] = [];
  for (const c of CONSISTENCY_CASES) {
    try {
      const j = await judgeFit(CONSISTENCY_JOB, c.profile, draftCfg);
      results.push({
        name: c.name,
        score: j.score,
        missing: j.missingRequirements,
        problem: c.check(j.score, j.missingRequirements),
      });
    } catch (e) {
      results.push({
        name: c.name,
        score: null,
        missing: [],
        problem: e instanceof Error ? e.message : String(e),
      });
    }
  }

  let custom: { score: number; reasoning: string; missing: string[] } | null =
    null;
  const customJob = formData.get("customJob");
  const customProfile = formData.get("customProfile");
  if (
    typeof customJob === "string" &&
    customJob.trim() !== "" &&
    typeof customProfile === "string" &&
    customProfile.trim() !== ""
  ) {
    try {
      const j = await judgeFit(customJob.trim(), customProfile.trim(), draftCfg);
      custom = {
        score: j.score,
        reasoning: j.reasoning,
        missing: j.missingRequirements,
      };
    } catch {
      custom = null;
    }
  }

  const pass = results.every((r) => r.problem === null);
  if (intent === "save") {
    if (!pass) {
      return { status: "gateFailed", results, custom };
    }
    const value =
      draft.trim() === DEFAULT_SYSTEM_PROMPT ? null : draft.trim();
    await updateRerankSystemPrompt(value);
    revalidatePath("/settings/prompt");
    revalidatePath("/matching");
    return { status: "saved", results, custom };
  }
  return { status: "tested", results, custom };
}

export async function setLocale(locale: Locale): Promise<void> {
  if (!locales.includes(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/");
}

export type ParseResumeState =
  | { status: "parsed"; name: string; profile: string }
  | {
      status: "error";
      kind:
        | "validation"
        | "unauthorized"
        | "notConfigured"
        | "emptyFile"
        | ProviderErrorKind;
      detail?: string;
    }
  | undefined;

const RESUME_MAX_BYTES = 5 * 1024 * 1024;

// Phase one of the two-phase upload flow: extract + anonymize into the
// form for human review. Nothing is persisted here — createCandidate
// stays the only write path. The raw resume text never reaches the
// client: only the LLM's anonymized result is returned.
export async function parseResume(
  _prev: ParseResumeState,
  formData: FormData,
): Promise<ParseResumeState> {
  if (!(await isAuthenticated())) {
    return { status: "error", kind: "unauthorized" };
  }
  const file = formData.get("resume");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", kind: "validation" };
  }
  if (file.size > RESUME_MAX_BYTES) {
    return { status: "error", kind: "validation" };
  }
  const lower = file.name.toLowerCase();
  let text: string;
  try {
    if (lower.endsWith(".pdf")) {
      // Dynamic import: unpdf only loads for actual PDF uploads, not on
      // every actions.ts evaluation.
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(
        new Uint8Array(await file.arrayBuffer()),
      );
      ({ text } = await extractText(pdf, { mergePages: true }));
    } else if (lower.endsWith(".txt") || lower.endsWith(".md")) {
      text = await file.text();
    } else {
      return { status: "error", kind: "validation" };
    }
  } catch (e) {
    return {
      status: "error",
      kind: "emptyFile",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
  if (text.trim() === "") {
    return { status: "error", kind: "emptyFile" };
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
  try {
    const parsed = await parseResumeText(text, cfg);
    return { status: "parsed", ...parsed };
  } catch (e) {
    if (e instanceof ProviderError) {
      return {
        status: "error",
        kind: e.kind,
        // A parse-kind message quotes the model's raw completion — never
        // ship that to the client, it can contain un-anonymized content.
        detail: e.kind === "parse" ? undefined : e.message,
      };
    }
    return { status: "error", kind: "api", detail: String(e) };
  }
}

export type InterviewState =
  | { status: "generated"; guide: InterviewGuide }
  | {
      status: "error";
      kind: "validation" | "unauthorized" | "notConfigured" | ProviderErrorKind;
      detail?: string;
    }
  | undefined;

// On-demand interview guide for one judged match. The client sends the
// job text and the verdict's missing requirements (display data it
// already holds); the profile is re-read from the DB by id, so the
// prompt only ever contains the stored anonymized profile — name-blind
// like the judge.
export async function generateInterviewQuestions(
  _prev: InterviewState,
  formData: FormData,
): Promise<InterviewState> {
  if (!(await isAuthenticated())) {
    return { status: "error", kind: "unauthorized" };
  }
  const candidateId = formData.get("candidateId");
  const jobText = formData.get("jobText");
  const missingRaw = formData.get("missing");
  if (
    typeof candidateId !== "string" ||
    !UUID_RE.test(candidateId) ||
    typeof jobText !== "string" ||
    jobText.trim() === ""
  ) {
    return { status: "error", kind: "validation" };
  }
  let missing: string[] = [];
  if (typeof missingRaw === "string" && missingRaw !== "") {
    try {
      const parsed: unknown = JSON.parse(missingRaw);
      if (Array.isArray(parsed)) {
        missing = parsed.filter((m): m is string => typeof m === "string");
      }
    } catch {
      // Malformed display data — proceed without gap targeting.
    }
  }
  const [candidate] = await getDb()
    .select({ profile: candidates.profile })
    .from(candidates)
    .where(eq(candidates.id, candidateId));
  if (!candidate) {
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
  try {
    const guide = await generateInterviewGuide(
      jobText.trim(),
      candidate.profile,
      missing,
      cfg,
    );
    return { status: "generated", guide };
  } catch (e) {
    if (e instanceof ProviderError) {
      return {
        status: "error",
        kind: e.kind,
        // A parse-kind message quotes the model's raw completion — never
        // ship that to the client, it can contain un-anonymized content.
        detail: e.kind === "parse" ? undefined : e.message,
      };
    }
    return { status: "error", kind: "api", detail: String(e) };
  }
}

export type StartRunState =
  | {
      status: "error";
      kind: "validation" | "unauthorized" | "notConfigured";
      detail?: string;
    }
  | undefined;

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
