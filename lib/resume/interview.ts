import {
  completeJson,
  type ChatConfig,
} from "@/lib/providers/complete";
import { ProviderError } from "@/lib/providers/http";

export type InterviewGuide = {
  technical: string[];
  experience: string[];
  gaps: string[];
};

// Interview guide generator: turns job + anonymized profile + the judge's
// missing requirements into targeted questions. Name-blind like the judge
// — it only ever sees the anonymized profile text.
export const INTERVIEW_SYSTEM_PROMPT = [
  "You prepare a recruiter for an interview: from a job posting, an anonymized candidate profile and a list of requirements the profile does not cover, you generate targeted interview questions.",
  "Respond with ONLY a JSON object, no other text:",
  '{"technical": ["<question>", ...], "experience": ["<question>", ...], "gaps": ["<question>", ...]}',
  "Write the questions in the language of the job posting.",
  "technical: 2-3 questions probing the depth of the profile's core skills that matter most for this job.",
  "experience: 2 questions about concrete past work relevant to the job's responsibilities.",
  "gaps: one question per entry in MISSING REQUIREMENTS, each verifying whether the gap is real or just unstated in the profile. If MISSING REQUIREMENTS is empty, return an empty gaps array.",
  "5-7 questions in total across all groups. Every question must reference concrete skills, tools or responsibilities from the texts — no generic questions like 'What are your strengths?'.",
  "Refer to the person neutrally as 'das Profil' / 'the profile' — never assume or invent a name or gender.",
].join("\n");

const INTERVIEW_SCHEMA = {
  type: "object",
  properties: {
    technical: { type: "array", items: { type: "string" } },
    experience: { type: "array", items: { type: "string" } },
    gaps: { type: "array", items: { type: "string" } },
  },
  required: ["technical", "experience", "gaps"],
} as const;

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((q): q is string => typeof q === "string");
}

export function parseInterviewResponse(raw: string): InterviewGuide {
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
    technical?: unknown;
    experience?: unknown;
    gaps?: unknown;
  };
  const technical = stringArray(obj.technical);
  const experience = stringArray(obj.experience);
  const gaps = stringArray(obj.gaps);
  if (technical === null || experience === null || gaps === null) {
    throw new ProviderError(
      "parse",
      `Interview JSON missing question groups: ${cleaned.slice(0, 120)}`,
    );
  }
  if (technical.length + experience.length + gaps.length === 0) {
    throw new ProviderError("parse", "Interview guide came back empty");
  }
  return { technical, experience, gaps };
}

export async function generateInterviewGuide(
  jobText: string,
  profileText: string,
  missingRequirements: string[],
  cfg: ChatConfig,
): Promise<InterviewGuide> {
  const prompt = [
    `JOB POSTING:\n${jobText}`,
    `CANDIDATE PROFILE (anonymized):\n${profileText}`,
    `MISSING REQUIREMENTS (from the fit evaluation):\n${
      missingRequirements.length > 0
        ? missingRequirements.map((m) => `- ${m}`).join("\n")
        : "(none)"
    }`,
  ].join("\n\n");
  const response = await completeJson(
    cfg,
    INTERVIEW_SYSTEM_PROMPT,
    prompt,
    INTERVIEW_SCHEMA,
    1000,
  );
  return parseInterviewResponse(response);
}
