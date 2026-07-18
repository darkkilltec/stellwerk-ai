import {
  ProviderError,
  type ProviderErrorKind,
} from "@/lib/providers/http";
import { completeJson } from "@/lib/providers/complete";

export type RerankProvider = "anthropic" | "ollama" | "openai";

export type RerankConfig = {
  provider: RerankProvider;
  model: string;
  apiKey?: string; // anthropic, openai
  baseUrl?: string; // ollama only
  // Judge system prompt override (settings/prompt lab); falls back to
  // DEFAULT_SYSTEM_PROMPT. The judgment cache is keyed by its hash.
  systemPrompt?: string;
};

export { ProviderError as RerankError };
export type RerankErrorKind = ProviderErrorKind;

export type Judgment = {
  score: number; // 0–100 fit
  reasoning: string;
  missingRequirements: string[];
};

// The judge prompt deliberately receives no candidate name — stage two of
// the matching pipeline stays as name-blind as the embedding stage.
// Editable via the prompt lab (/settings/prompt); this is the default and
// the reset target. The judgment cache is keyed by the active prompt's
// hash, so any change — here or in the lab — invalidates old verdicts.
export const DEFAULT_SYSTEM_PROMPT = [
  "You are a strict, fair technical recruiter evaluating how well a candidate profile fits a job posting.",
  "Respond with ONLY a JSON object, no other text:",
  '{"score": <0-100>, "reasoning": "<1-2 sentences, in the language of the job posting>", "missing_requirements": ["<requirement the profile does not cover>", ...]}',
  "Scoring guide: 90-100 excellent direct fit; 70-89 strong fit with minor gaps; 40-69 partial fit; 0-39 weak fit or different field.",
  "The score MUST be consistent with missing_requirements. Work in this order: first identify the posting's core requirements (words like 'zwingend', 'erforderlich', 'must have' mark them as core), then check each against the profile. If ANY core requirement is missing, the score cannot exceed 69. If MOST or ALL core requirements are missing, the score must be below 40 — regardless of how strong the profile is in other fields.",
  "The reasoning must name the 2-3 concrete skills or experiences that decide the verdict, taken verbatim from the texts (e.g. 'Jetpack Compose und App-Store-Releases decken die Kernanforderungen ab'). Generic statements like 'has the required skills and experience' are not acceptable.",
  "Refer to the person neutrally as 'das Profil' / 'the profile' — the profile is anonymized, never assume or invent a gender.",
  "missing_requirements may ONLY contain requirements that are explicitly stated in the JOB POSTING and not covered by the profile. Never invent requirements the posting does not mention, and never list things from the profile. If the profile covers everything the posting asks for, missing_requirements MUST be [] — an empty list is the expected answer for a good fit.",
  "Judge only what the texts say. Skills, experience and the job's requirements are the ONLY criteria.",
  "Personal attributes — age, gender, family or parental status, origin, nationality, religion, disability — are strictly irrelevant: they must not raise or lower the score or appear in missing_requirements, even when the profile mentions them explicitly.",
].join("\n");

function userPrompt(jobText: string, profileText: string): string {
  return `JOB POSTING:\n${jobText}\n\nCANDIDATE PROFILE (anonymized):\n${profileText}`;
}

const JUDGMENT_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number" },
    reasoning: { type: "string" },
    missing_requirements: { type: "array", items: { type: "string" } },
  },
  required: ["score", "reasoning", "missing_requirements"],
} as const;

export async function judgeFit(
  jobText: string,
  profileText: string,
  cfg: RerankConfig,
): Promise<Judgment> {
  const raw = await requestJudgment(
    userPrompt(jobText, profileText),
    cfg,
  );
  return parseJudgment(raw);
}

// Judges candidates with a small concurrency pool. Local ollama processes
// requests serially, so parallel requests only sit in its queue while
// their timeout is already running — one at a time is strictly better
// there. Hosted APIs benefit from a few in flight.
export async function judgeFitMany(
  jobText: string,
  profiles: string[],
  cfg: RerankConfig,
  concurrency = cfg.provider === "ollama" ? 1 : 3,
): Promise<Judgment[]> {
  const results: Judgment[] = new Array(profiles.length);
  let next = 0;
  async function worker() {
    while (next < profiles.length) {
      const index = next++;
      results[index] = await judgeFit(jobText, profiles[index], cfg);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, profiles.length) }, worker),
  );
  return results;
}

async function requestJudgment(
  prompt: string,
  cfg: RerankConfig,
): Promise<string> {
  return completeJson(
    cfg,
    cfg.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    prompt,
    JUDGMENT_SCHEMA,
  );
}

function parseJudgment(raw: string): Judgment {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new ProviderError(
      "parse",
      `Model did not return valid JSON: ${cleaned.slice(0, 120)}…`,
    );
  }
  const obj = parsed as {
    score?: unknown;
    reasoning?: unknown;
    missing_requirements?: unknown;
  };
  if (typeof obj.score !== "number" || typeof obj.reasoning !== "string") {
    throw new ProviderError(
      "parse",
      `Judgment JSON missing score/reasoning: ${cleaned.slice(0, 120)}`,
    );
  }
  return {
    score: Math.max(0, Math.min(100, obj.score)),
    reasoning: obj.reasoning,
    missingRequirements: Array.isArray(obj.missing_requirements)
      ? obj.missing_requirements.filter((m): m is string => typeof m === "string")
      : [],
  };
}
