import { eq } from "drizzle-orm";
import { settings } from "@/db/schema";
import { decryptSecret, encryptSecret } from "./crypto";
import { getDb } from "./db";
import type { EmbeddingConfig } from "./embedding/client";
import { testEmbeddingConfig, type EmbeddingTestResult } from "./embedding/test";
import type { RerankConfig } from "./reranking/client";
import { testRerankConfig, type RerankTestResult } from "./reranking/test";

// The one write path for the embedding configuration — used by the CLI
// (db/configure.ts) and the settings wizard alike: test the config live,
// persist it (key encrypted) only when the test is green.
export async function testAndSaveEmbeddingConfig(
  cfg: EmbeddingConfig,
): Promise<EmbeddingTestResult> {
  const result = await testEmbeddingConfig(cfg);
  if (!result.ok) return result;
  const row = {
    provider: cfg.provider,
    embeddingModel: cfg.model,
    apiKeyEncrypted: cfg.apiKey ? encryptSecret(cfg.apiKey) : null,
    baseUrl: cfg.baseUrl ?? null,
    lastTestOk: true,
    lastTestedAt: new Date(),
    lastTestLatencyMs: result.latencyMs,
    lastTestError: null,
    updatedAt: new Date(),
  };
  await getDb()
    .insert(settings)
    .values({ id: 1, ...row })
    .onConflictDoUpdate({ target: settings.id, set: row });
  return result;
}

// Same test-gated write path for the second stage: a real judgment must
// succeed before the rerank config is persisted.
export async function testAndSaveRerankConfig(
  cfg: RerankConfig,
): Promise<RerankTestResult> {
  const result = await testRerankConfig(cfg);
  if (!result.ok) return result;
  const row = {
    rerankProvider: cfg.provider,
    rerankModel: cfg.model,
    rerankApiKeyEncrypted: cfg.apiKey ? encryptSecret(cfg.apiKey) : null,
    rerankBaseUrl: cfg.baseUrl ?? null,
    rerankLastTestOk: true,
    rerankLastTestedAt: new Date(),
    rerankLastTestLatencyMs: result.latencyMs,
    rerankLastTestError: null,
    updatedAt: new Date(),
  };
  const [existing] = await getDb()
    .select({ id: settings.id })
    .from(settings)
    .where(eq(settings.id, 1));
  if (!existing) {
    return {
      ok: false,
      kind: "api",
      error: "Configure the embedding provider first",
    };
  }
  await getDb().update(settings).set(row).where(eq(settings.id, 1));
  return result;
}

export async function getValidatedRerankSettings(): Promise<RerankConfig> {
  const db = getDb();
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  if (!row?.rerankProvider || !row.rerankModel) {
    throw new Error("No rerank configuration — set it up under Settings");
  }
  if (!row.rerankLastTestOk) {
    throw new Error(
      `Rerank configuration is not validated${row.rerankLastTestError ? ` (last error: ${row.rerankLastTestError})` : ""} — re-save it under Settings`,
    );
  }
  let apiKey: string | undefined;
  if (row.rerankApiKeyEncrypted) {
    try {
      apiKey = decryptSecret(row.rerankApiKeyEncrypted);
    } catch {
      await db
        .update(settings)
        .set({
          rerankLastTestOk: false,
          rerankLastTestError:
            "stored API key could not be decrypted (app secret changed?)",
          updatedAt: new Date(),
        })
        .where(eq(settings.id, 1));
      throw new Error(
        "Stored rerank API key could not be decrypted (app secret changed?) — re-save it under Settings",
      );
    }
  }
  return {
    provider: row.rerankProvider as RerankConfig["provider"],
    model: row.rerankModel,
    apiKey,
    baseUrl: row.rerankBaseUrl ?? undefined,
    systemPrompt: row.rerankSystemPrompt ?? undefined,
  };
}

// Prompt-lab write path; null resets to the code default. The caller is
// responsible for gating (consistency cases must pass first).
export async function updateRerankSystemPrompt(
  value: string | null,
): Promise<void> {
  await getDb()
    .update(settings)
    .set({ rerankSystemPrompt: value, updatedAt: new Date() })
    .where(eq(settings.id, 1));
}

export async function isRerankConfigured(): Promise<boolean> {
  const [row] = await getDb()
    .select({ ok: settings.rerankLastTestOk })
    .from(settings)
    .where(eq(settings.id, 1));
  return !!row?.ok;
}

// For the wizard: reuse the stored key when the user keeps the provider
// and leaves the key field empty. Returns undefined when there is no
// stored key for this provider or it can't be decrypted.
export async function getStoredApiKey(
  provider: string,
): Promise<string | undefined> {
  const [row] = await getDb().select().from(settings).where(eq(settings.id, 1));
  if (!row || row.provider !== provider || !row.apiKeyEncrypted) {
    return undefined;
  }
  try {
    return decryptSecret(row.apiKeyEncrypted);
  } catch {
    return undefined;
  }
}

export async function getStoredRerankApiKey(
  provider: string,
): Promise<string | undefined> {
  const [row] = await getDb().select().from(settings).where(eq(settings.id, 1));
  if (
    !row ||
    row.rerankProvider !== provider ||
    !row.rerankApiKeyEncrypted
  ) {
    return undefined;
  }
  try {
    return decryptSecret(row.rerankApiKeyEncrypted);
  } catch {
    return undefined;
  }
}

// Loads the singleton settings row and returns a usable embedding config.
// Throws with a actionable message when there is no config, the last test
// failed, or the stored key can't be decrypted (secret changed) — in the
// decrypt case the row is also marked invalid instead of crashing later.
export async function getValidatedSettings(): Promise<EmbeddingConfig> {
  const db = getDb();
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  if (!row) {
    throw new Error(
      "No embedding configuration — run: bun run db:configure -- --provider … --model …",
    );
  }
  if (!row.lastTestOk) {
    throw new Error(
      `Embedding configuration is not validated${row.lastTestError ? ` (last error: ${row.lastTestError})` : ""} — re-run db:configure`,
    );
  }
  let apiKey: string | undefined;
  if (row.apiKeyEncrypted) {
    try {
      apiKey = decryptSecret(row.apiKeyEncrypted);
    } catch {
      await db
        .update(settings)
        .set({
          lastTestOk: false,
          lastTestError:
            "stored API key could not be decrypted (app secret changed?)",
          updatedAt: new Date(),
        })
        .where(eq(settings.id, 1));
      throw new Error(
        "Stored API key could not be decrypted (app secret changed?) — re-run db:configure",
      );
    }
  }
  return {
    provider: row.provider as EmbeddingConfig["provider"],
    model: row.embeddingModel,
    apiKey,
    baseUrl: row.baseUrl ?? undefined,
  };
}
