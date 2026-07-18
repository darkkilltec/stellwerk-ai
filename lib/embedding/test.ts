import {
  EmbeddingError,
  embedMany,
  type EmbeddingConfig,
  type EmbeddingErrorKind,
} from "./client";

export type EmbeddingTestResult =
  | { ok: true; latencyMs: number }
  | { ok: false; kind: EmbeddingErrorKind; error: string };

// The single test gate in front of every config write — used by
// db:configure today and by the settings wizard later, unchanged.
export async function testEmbeddingConfig(
  cfg: EmbeddingConfig,
): Promise<EmbeddingTestResult> {
  const start = performance.now();
  try {
    await embedMany(["ping"], "query", cfg);
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (e) {
    if (e instanceof EmbeddingError) {
      return { ok: false, kind: e.kind, error: e.message };
    }
    return { ok: false, kind: "api", error: String(e) };
  }
}
