import {
  completeJson,
  type ChatConfig,
} from "@/lib/providers/complete";
import { ProviderError } from "@/lib/providers/http";

export type ParsedResume = {
  name: string;
  profile: string;
};

// Anonymization contract for uploaded resumes. Mirrors the judge prompt's
// protected attributes (lib/reranking/client.ts) — the profile text feeds
// the embedding, the tsvector AND the judge, so nothing identifying may
// survive this step. The name goes into the separate name field only,
// which composeCandidateText already excludes from the embedding.
export const RESUME_SYSTEM_PROMPT = [
  "You turn raw resume/CV text into an anonymized, structured candidate profile for a recruiting matching system.",
  "Respond with ONLY a JSON object, no other text:",
  '{"name": "<full name of the candidate, empty string if not found>", "profile": "<anonymized structured profile text in German>"}',
  "The profile text MUST be written in German, regardless of the resume language.",
  "Structure the profile text with exactly these sections, each heading on its own line, in this order; omit a section entirely if the resume has no content for it:",
  "Kurzprofil: 2-3 sentences summarizing seniority, field and focus.",
  "Skills: comma-separated concrete skills, tools and technologies, taken verbatim from the resume.",
  "Berufserfahrung: one line per role — role title, industry and duration (e.g. 'Backend-Entwickler, E-Commerce, 3 Jahre'). NEVER the employer's name or city; replace the employer with its industry.",
  "Ausbildung: degrees and certifications — NEVER the school's or university's name.",
  "Sprachen: languages with proficiency level.",
  "Anonymization is mandatory. The profile text MUST NOT contain: the candidate's name or initials, postal address, e-mail address, phone number, links or usernames, birth date or age, gender, marital or family status, nationality or origin, religion, photos or references to them, company names, names of schools or universities.",
  "ALWAYS extract the candidate's full name into the name field — anonymization applies to the profile text, NOT to the name field. Leave name empty only if the resume truly contains no name.",
  "Never invent information — every skill, role and duration must come from the resume text.",
].join("\n");

const RESUME_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    profile: { type: "string" },
  },
  required: ["name", "profile"],
} as const;

// Guards against megabyte-scale extracted text blowing the LLM context;
// 20k chars ≈ 8-10 resume pages, more than any sane CV.
const MAX_RESUME_CHARS = 20_000;

export function parseResumeResponse(raw: string): ParsedResume {
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
  const obj = parsed as { name?: unknown; profile?: unknown };
  if (
    typeof obj.name !== "string" ||
    typeof obj.profile !== "string" ||
    obj.profile.trim() === ""
  ) {
    throw new ProviderError(
      "parse",
      `Resume JSON missing name/profile: ${cleaned.slice(0, 120)}`,
    );
  }
  return { name: obj.name.trim(), profile: obj.profile.trim() };
}

export async function parseResumeText(
  raw: string,
  cfg: ChatConfig,
): Promise<ParsedResume> {
  const text = raw.trim().slice(0, MAX_RESUME_CHARS);
  if (text === "") {
    throw new ProviderError("parse", "Empty resume text");
  }
  const response = await completeJson(
    cfg,
    RESUME_SYSTEM_PROMPT,
    `RESUME TEXT:\n${text}`,
    RESUME_SCHEMA,
    2000,
  );
  return parseResumeResponse(response);
}
