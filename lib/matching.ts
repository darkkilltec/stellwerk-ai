import { and, cosineDistance, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { candidates, rerankCache } from "@/db/schema";
import { getDb } from "./db";
import { embedMany } from "./embedding/client";
import { embedSourceHash } from "./embedding/compose";
import {
  DEFAULT_SYSTEM_PROMPT,
  enforceScoreConsistency,
  judgeFitMany,
  type Judgment,
} from "./reranking/client";
import { getValidatedRerankSettings, getValidatedSettings } from "./settings";

export type Match = {
  id: string;
  slug: string | null;
  name: string;
  similarity: number;
};

// The one ranking path that app, eval and future flows share:
// free text in, ranked candidates out. The query text is embedded fresh
// (kind "query") because the real HR flow is free text / PDF in — the
// stored job vectors serve other flows (similar jobs, candidate-to-jobs).
// Hybrid retrieval: vector similarity finds topical proximity, Postgres
// full text finds exact terms (skills, tools) that embeddings blur —
// fused via Reciprocal Rank Fusion.
export async function matchCandidates(
  queryText: string,
  topK = 10,
): Promise<Match[]> {
  const cfg = await getValidatedSettings();
  await assertNoModelMix(cfg.model);
  const [queryVector] = await embedMany([queryText], "query", cfg);
  return rankHybrid(queryText, queryVector, topK);
}

// Pool each ranking contributes to the fusion; RRF_K dampens rank
// differences (standard value from the RRF paper).
const HYBRID_POOL = 50;
const RRF_K = 60;

export async function rankHybrid(
  queryText: string,
  queryVector: number[],
  topK = 10,
): Promise<Match[]> {
  const vec = JSON.stringify(queryVector);
  const rows = await getDb().execute<{
    id: string;
    slug: string | null;
    name: string;
    similarity: number;
  }>(sql`
    with vec as (
      select id,
             1 - (embedding <=> ${vec}::vector) as similarity,
             row_number() over (order by embedding <=> ${vec}::vector) as r
      from candidates
      where embedding is not null
      order by embedding <=> ${vec}::vector
      limit ${HYBRID_POOL}
    ),
    lex as (
      select id,
             row_number() over (
               order by ts_rank_cd(profile_tsv, websearch_to_tsquery('german', ${queryText})) desc
             ) as r
      from candidates
      where profile_tsv @@ websearch_to_tsquery('german', ${queryText})
      limit ${HYBRID_POOL}
    )
    select c.id,
           c.slug,
           c.name,
           coalesce(vec.similarity, 1 - (c.embedding <=> ${vec}::vector))::float as similarity,
           (coalesce(1.0 / (${RRF_K} + vec.r), 0) + coalesce(1.0 / (${RRF_K} + lex.r), 0)) as fused
    from candidates c
    join (select id from vec union select id from lex) u on u.id = c.id
    left join vec on vec.id = c.id
    left join lex on lex.id = c.id
    where c.embedding is not null
    order by fused desc, similarity desc
    limit ${topK}
  `);
  return [...rows].map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    similarity: Number(r.similarity),
  }));
}

// SQL-only ranking half, separated so it can be exercised without a
// provider. cosineDistance compiles to the <=> operator and therefore
// uses the HNSW cosine index.
export async function rankCandidates(
  queryVector: number[],
  topK = 10,
): Promise<Match[]> {
  const similarity = sql<number>`1 - (${cosineDistance(candidates.embedding, queryVector)})`;
  return getDb()
    .select({
      id: candidates.id,
      slug: candidates.slug,
      name: candidates.name,
      similarity,
    })
    .from(candidates)
    .where(isNotNull(candidates.embedding))
    .orderBy(desc(similarity))
    .limit(topK);
}

export type RerankedMatch = Match & {
  vectorRank: number;
  judgment: Judgment;
};

// Stage two: the vector top-K, re-judged in depth by the configured LLM.
// Final order = judge score, similarity as tie-breaker. The judge sees
// job text and anonymized profile — no names, same as the embedding.
export async function matchCandidatesReranked(
  queryText: string,
  topK = 10,
): Promise<RerankedMatch[]> {
  const retrieved = await matchCandidates(queryText, topK);
  return judgeRetrieved(queryText, retrieved);
}

// Judgments are cached by (job text, profile text, model) hash — same
// staleness idea as the embeddings: content or model changes invalidate,
// repeats are instant.
export async function judgeRetrieved(
  queryText: string,
  retrieved: Match[],
): Promise<RerankedMatch[]> {
  if (retrieved.length === 0) return [];
  const db = getDb();
  const rerankCfg = await getValidatedRerankSettings();
  const jobHash = embedSourceHash(queryText);
  const promptHash = embedSourceHash(
    rerankCfg.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
  );

  const profileRows = await db
    .select({ id: candidates.id, profile: candidates.profile })
    .from(candidates)
    .where(
      inArray(
        candidates.id,
        retrieved.map((m) => m.id),
      ),
    );
  const profiles = new Map(profileRows.map((r) => [r.id, r.profile]));
  const entries = retrieved.map((match, index) => {
    const profile = profiles.get(match.id) ?? "";
    return {
      match,
      vectorRank: index + 1,
      profile,
      profileHash: embedSourceHash(profile),
    };
  });

  const cachedRows = await db
    .select()
    .from(rerankCache)
    .where(
      and(
        eq(rerankCache.jobHash, jobHash),
        eq(rerankCache.model, rerankCfg.model),
        eq(rerankCache.promptHash, promptHash),
        inArray(
          rerankCache.profileHash,
          entries.map((e) => e.profileHash),
        ),
      ),
    );
  const cached = new Map(cachedRows.map((r) => [r.profileHash, r]));

  const misses = entries.filter((e) => !cached.has(e.profileHash));
  if (misses.length > 0) {
    const judgments = await judgeFitMany(
      queryText,
      misses.map((m) => m.profile),
      rerankCfg,
    );
    const rows = misses.map((miss, i) => ({
      jobHash,
      profileHash: miss.profileHash,
      model: rerankCfg.model,
      promptHash,
      score: judgments[i].score,
      reasoning: judgments[i].reasoning,
      missingRequirements: judgments[i].missingRequirements,
    }));
    await db.insert(rerankCache).values(rows).onConflictDoNothing();
    for (const row of rows) {
      cached.set(row.profileHash, {
        ...row,
        id: "",
        createdAt: new Date(),
      });
    }
  }

  return entries
    .map((entry) => {
      const hit = cached.get(entry.profileHash)!;
      return {
        ...entry.match,
        vectorRank: entry.vectorRank,
        judgment: {
          // Re-clamp on read: cache rows may predate the consistency guard.
          score: enforceScoreConsistency(hit.score, hit.missingRequirements),
          reasoning: hit.reasoning,
          missingRequirements: hit.missingRequirements,
        },
      };
    })
    .sort(
      (a, b) =>
        b.judgment.score - a.judgment.score || b.similarity - a.similarity,
    );
}

export type StreamedRerankItem = {
  match: Match;
  vectorRank: number;
  profileHash: string;
  cached: Judgment | null;
  judgment: Promise<Judgment>;
};

// Per-candidate judgments as individual promises so the UI can stream
// each verdict as it lands. Cache hits resolve immediately; misses run
// through a pool sized like judgeFitMany (serial for local ollama) and
// are written back to the cache one by one.
export async function judgeRetrievedStreamed(
  queryText: string,
  retrieved: Match[],
): Promise<StreamedRerankItem[]> {
  const db = getDb();
  const rerankCfg = await getValidatedRerankSettings();
  const jobHash = embedSourceHash(queryText);
  const promptHash = embedSourceHash(
    rerankCfg.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
  );

  const profileRows = await db
    .select({ id: candidates.id, profile: candidates.profile })
    .from(candidates)
    .where(
      inArray(
        candidates.id,
        retrieved.map((m) => m.id),
      ),
    );
  const profiles = new Map(profileRows.map((r) => [r.id, r.profile]));
  const profileHashes = retrieved.map((m) =>
    embedSourceHash(profiles.get(m.id) ?? ""),
  );

  const cachedRows = await db
    .select()
    .from(rerankCache)
    .where(
      and(
        eq(rerankCache.jobHash, jobHash),
        eq(rerankCache.model, rerankCfg.model),
        eq(rerankCache.promptHash, promptHash),
        inArray(rerankCache.profileHash, profileHashes),
      ),
    );
  const cached = new Map(cachedRows.map((r) => [r.profileHash, r]));

  const concurrency = rerankCfg.provider === "ollama" ? 1 : 3;
  let active = 0;
  const queue: (() => void)[] = [];
  const acquire = () =>
    new Promise<void>((resolve) => {
      if (active < concurrency) {
        active++;
        resolve();
      } else {
        queue.push(() => {
          active++;
          resolve();
        });
      }
    });
  const release = () => {
    active--;
    queue.shift()?.();
  };

  return retrieved.map((match, index) => {
    const profileHash = profileHashes[index];
    const hit = cached.get(profileHash);
    const cachedJudgment: Judgment | null = hit
      ? {
          // Re-clamp on read: cache rows may predate the consistency guard.
          score: enforceScoreConsistency(hit.score, hit.missingRequirements),
          reasoning: hit.reasoning,
          missingRequirements: hit.missingRequirements,
        }
      : null;
    const judgment = cachedJudgment
      ? Promise.resolve(cachedJudgment)
      : (async () => {
          await acquire();
          try {
            const result = await judgeFitMany(
              queryText,
              [profiles.get(match.id) ?? ""],
              rerankCfg,
              1,
            );
            await db
              .insert(rerankCache)
              .values({
                jobHash,
                profileHash,
                model: rerankCfg.model,
                promptHash,
                score: result[0].score,
                reasoning: result[0].reasoning,
                missingRequirements: result[0].missingRequirements,
              })
              .onConflictDoNothing();
            return result[0];
          } finally {
            release();
          }
        })();
    return {
      match,
      vectorRank: index + 1,
      profileHash,
      cached: cachedJudgment,
      judgment,
    };
  });
}

// Ranking across vectors from different models is meaningless — abort
// hard when stored embeddings don't match the configured model.
async function assertNoModelMix(configuredModel: string): Promise<void> {
  const rows = await getDb()
    .selectDistinct({ model: candidates.embeddingModel })
    .from(candidates)
    .where(
      and(
        isNotNull(candidates.embedding),
        // `is distinct from` also catches embeddings with a NULL model.
        sql`${candidates.embeddingModel} is distinct from ${configuredModel}`,
      ),
    );
  if (rows.length > 0) {
    const models = rows.map((r) => r.model).join(", ");
    throw new Error(
      `Stored embeddings were created with "${models}" but configured is "${configuredModel}" — run: bun run db:embed`,
    );
  }
}
