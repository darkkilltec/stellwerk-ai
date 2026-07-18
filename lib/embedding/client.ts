import { EMBEDDING_DIMENSIONS } from "@/db/schema";
import {
  postJson,
  ProviderError,
  type ProviderErrorKind,
} from "@/lib/providers/http";

export type EmbeddingProvider = "openai" | "ollama" | "voyage";

export type EmbeddingConfig = {
  provider: EmbeddingProvider;
  model: string;
  apiKey?: string; // openai, voyage
  baseUrl?: string; // ollama only
};

export { ProviderError as EmbeddingError };
export type EmbeddingErrorKind = ProviderErrorKind;

// Retrieval-optimized models embed documents and queries differently;
// providers that support it (voyage) get the hint passed through.
export type EmbedKind = "document" | "query";

export async function embedMany(
  texts: string[],
  kind: EmbedKind,
  cfg: EmbeddingConfig,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const vectors = await requestEmbeddings(texts, kind, cfg);
  if (vectors.length !== texts.length) {
    throw new ProviderError(
      "api",
      `Provider returned ${vectors.length} embeddings for ${texts.length} inputs`,
    );
  }
  for (const vector of vectors) {
    if (vector.length !== EMBEDDING_DIMENSIONS) {
      throw new ProviderError(
        "dimension",
        `Model "${cfg.model}" returns ${vector.length} dimensions, expected ${EMBEDDING_DIMENSIONS} — ` +
          `pick a ${EMBEDDING_DIMENSIONS}-dimension model (openai text-embedding-3-* supports a dimensions parameter; ` +
          `for ollama use e.g. snowflake-arctic-embed2)`,
      );
    }
  }
  return vectors;
}

async function requestEmbeddings(
  texts: string[],
  kind: EmbedKind,
  cfg: EmbeddingConfig,
): Promise<number[][]> {
  switch (cfg.provider) {
    case "openai": {
      const body: Record<string, unknown> = {
        model: cfg.model,
        input: texts,
      };
      // Only the text-embedding-3 family accepts a dimensions override.
      if (cfg.model.startsWith("text-embedding-3")) {
        body.dimensions = EMBEDDING_DIMENSIONS;
      }
      const data = await postJson(
        "https://api.openai.com/v1/embeddings",
        body,
        { Authorization: `Bearer ${cfg.apiKey ?? ""}` },
      );
      return (data as { data: { embedding: number[] }[] }).data.map(
        (d) => d.embedding,
      );
    }
    case "voyage": {
      const data = await postJson(
        "https://api.voyageai.com/v1/embeddings",
        {
          model: cfg.model,
          input: texts,
          input_type: kind,
        },
        { Authorization: `Bearer ${cfg.apiKey ?? ""}` },
      );
      return (data as { data: { embedding: number[] }[] }).data.map(
        (d) => d.embedding,
      );
    }
    case "ollama": {
      const baseUrl = (cfg.baseUrl ?? "http://localhost:11434").replace(
        /\/$/,
        "",
      );
      const data = await postJson(`${baseUrl}/api/embed`, {
        model: cfg.model,
        input: texts,
      });
      return (data as { embeddings: number[][] }).embeddings;
    }
  }
}
