import { RerankError, judgeFit, type RerankConfig } from "./client";
import type { RerankErrorKind } from "./client";

export type RerankTestResult =
  | { ok: true; latencyMs: number }
  | { ok: false; kind: RerankErrorKind; error: string };

// Test gate for the rerank config — a minimal real judgment must succeed
// (including JSON parsing) before anything is saved.
export async function testRerankConfig(
  cfg: RerankConfig,
): Promise<RerankTestResult> {
  const start = performance.now();
  try {
    await judgeFit(
      "Job: TypeScript developer for a web platform.",
      "Profile: 5 years of TypeScript and React experience.",
      cfg,
    );
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (e) {
    if (e instanceof RerankError) {
      return { ok: false, kind: e.kind, error: e.message };
    }
    return { ok: false, kind: "api", error: String(e) };
  }
}
