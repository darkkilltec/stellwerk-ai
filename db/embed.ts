import { eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/lib/db";
import { EMBEDDING_DIMENSIONS } from "@/db/schema";
import { embedMany } from "@/lib/embedding/client";
import {
  composeCandidateText,
  composeJobText,
  embedSourceHash,
} from "@/lib/embedding/compose";
import { getValidatedSettings } from "@/lib/settings";
import { candidates, jobs } from "./schema";

// Embeds every row whose vector is missing or stale (source text changed,
// or a different model is configured). Because staleness is derived from
// stored model + source hash, the same command is also the re-embedding
// tool after a model switch. Run via `bun run db:embed`.

const BATCH_SIZE = 64;

type Row = {
  id: string;
  text: string;
  hasEmbedding: boolean;
  embeddingModel: string | null;
  embeddingSourceHash: string | null;
};

async function loadCandidateRows(): Promise<Row[]> {
  const rows = await getDb()
    .select({
      id: candidates.id,
      profile: candidates.profile,
      hasEmbedding: sql<boolean>`${candidates.embedding} is not null`,
      embeddingModel: candidates.embeddingModel,
      embeddingSourceHash: candidates.embeddingSourceHash,
    })
    .from(candidates);
  return rows.map((r) => ({ ...r, text: composeCandidateText(r) }));
}

async function loadJobRows(): Promise<Row[]> {
  const rows = await getDb()
    .select({
      id: jobs.id,
      title: jobs.title,
      description: jobs.description,
      hasEmbedding: sql<boolean>`${jobs.embedding} is not null`,
      embeddingModel: jobs.embeddingModel,
      embeddingSourceHash: jobs.embeddingSourceHash,
    })
    .from(jobs);
  return rows.map((r) => ({ ...r, text: composeJobText(r) }));
}

function staleOnly(rows: Row[], configuredModel: string) {
  return rows
    .map((row) => ({ id: row.id, text: row.text, hash: embedSourceHash(row.text), row }))
    .filter(
      ({ hash, row }) =>
        !row.hasEmbedding ||
        row.embeddingSourceHash !== hash ||
        row.embeddingModel !== configuredModel,
    );
}

try {
  const cfg = await getValidatedSettings();
  const tables = [
    { name: "candidates", table: candidates, rows: await loadCandidateRows() },
    { name: "jobs", table: jobs, rows: await loadJobRows() },
  ] as const;

  let embedded = 0;
  let skipped = 0;
  for (const { name, table, rows } of tables) {
    const work = staleOnly(rows, cfg.model);
    skipped += rows.length - work.length;
    for (let i = 0; i < work.length; i += BATCH_SIZE) {
      const batch = work.slice(i, i + BATCH_SIZE);
      // embedMany enforces the dimension guard per batch and aborts hard.
      const vectors = await embedMany(
        batch.map((w) => w.text),
        "document",
        cfg,
      );
      for (let j = 0; j < batch.length; j++) {
        await getDb()
          .update(table)
          .set({
            embedding: vectors[j],
            embeddingModel: cfg.model,
            embeddingSourceHash: batch[j].hash,
            updatedAt: new Date(),
          })
          .where(eq(table.id, batch[j].id));
      }
      embedded += batch.length;
      console.log(
        `[embed] ${name}: ${Math.min(i + BATCH_SIZE, work.length)}/${work.length}`,
      );
    }
  }
  console.log(
    `embedded ${embedded}, skipped ${skipped}, model=${cfg.model}, dims=${EMBEDDING_DIMENSIONS}`,
  );
} catch (e) {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
