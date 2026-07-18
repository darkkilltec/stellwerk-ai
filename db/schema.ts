import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

// Dimension of the embedding model (voyage-3 family = 1024).
// Changing this requires a migration and re-embedding all rows.
export const EMBEDDING_DIMENSIONS = 1024;

// Application configuration lives encrypted in the DB (one row, id = 1);
// infrastructure config (DATABASE_URL etc.) stays in ENV. A config is only
// usable after a successful test run (lastTestOk) — see db/configure.ts.
export const settings = pgTable(
  "settings",
  {
    id: integer("id").primaryKey().default(1),
    provider: text("provider").notNull(), // 'openai' | 'ollama' | 'voyage'
    embeddingModel: text("embedding_model").notNull(),
    apiKeyEncrypted: text("api_key_encrypted"), // null for ollama
    baseUrl: text("base_url"), // ollama only
    lastTestOk: boolean("last_test_ok").notNull().default(false),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    lastTestLatencyMs: integer("last_test_latency_ms"),
    lastTestError: text("last_test_error"),
    // Second stage: LLM re-ranking. Optional — matching works without it.
    rerankProvider: text("rerank_provider"), // 'anthropic' | 'ollama' | 'openai'
    rerankModel: text("rerank_model"),
    rerankApiKeyEncrypted: text("rerank_api_key_encrypted"),
    rerankBaseUrl: text("rerank_base_url"),
    // Judge system prompt override (prompt lab); null = code default.
    rerankSystemPrompt: text("rerank_system_prompt"),
    rerankLastTestOk: boolean("rerank_last_test_ok").notNull().default(false),
    rerankLastTestedAt: timestamp("rerank_last_tested_at", {
      withTimezone: true,
    }),
    rerankLastTestLatencyMs: integer("rerank_last_test_latency_ms"),
    rerankLastTestError: text("rerank_last_test_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [check("settings_singleton", sql`${table.id} = 1`)],
);

// Judgment cache for the re-ranking stage: keyed by content hashes and
// model, mirroring the embedding staleness pattern — same job text, same
// profile text, same judge model = same verdict, no repeated LLM calls.
export const rerankCache = pgTable(
  "rerank_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobHash: text("job_hash").notNull(),
    profileHash: text("profile_hash").notNull(),
    model: text("model").notNull(),
    // Hash of the active judge prompt — any prompt change (code default
    // or prompt-lab override) invalidates old verdicts.
    promptHash: text("prompt_hash").notNull().default(""),
    score: real("score").notNull(),
    reasoning: text("reasoning").notNull(),
    missingRequirements: jsonb("missing_requirements")
      .$type<string[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("rerank_cache_key_idx").on(
      table.jobHash,
      table.profileHash,
      table.model,
      table.promptHash,
    ),
  ],
);

export const candidates = pgTable(
  "candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Stable identifier for seed/eval fixtures (golden set).
    slug: text("slug").unique(),
    name: text("name").notNull(),
    // Raw profile/resume text the embedding is computed from.
    profile: text("profile").notNull(),
    // Lexical half of the hybrid retrieval: exact terms (skills, tools)
    // that embeddings blur into "topical proximity". German config strips
    // stopwords and stems.
    profileTsv: tsvector("profile_tsv").generatedAlwaysAs(
      sql`to_tsvector('german', profile)`,
    ),
    // Null until the embedding has been computed.
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    // Which model produced the stored embedding, and a hash of the exact
    // text that went in — makes db:embed idempotent and model mix detectable.
    embeddingModel: text("embedding_model"),
    embeddingSourceHash: text("embedding_source_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("candidates_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    index("candidates_profile_tsv_idx").using("gin", table.profileTsv),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").unique(),
    title: text("title").notNull(),
    company: text("company"),
    description: text("description").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    embeddingModel: text("embedding_model"),
    embeddingSourceHash: text("embedding_source_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("jobs_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);

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
