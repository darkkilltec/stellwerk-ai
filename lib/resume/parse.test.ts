import { describe, expect, test } from "bun:test";
import { ProviderError } from "@/lib/providers/http";
import { parseResumeResponse, RESUME_SYSTEM_PROMPT } from "./parse";

describe("parseResumeResponse", () => {
  test("parses a plain JSON object", () => {
    const result = parseResumeResponse(
      '{"name": "Erika Musterfrau", "profile": "Kurzprofil:\\nBackend."}',
    );
    expect(result).toEqual({
      name: "Erika Musterfrau",
      profile: "Kurzprofil:\nBackend.",
    });
  });

  test("strips markdown code fences", () => {
    const result = parseResumeResponse(
      '```json\n{"name": "A", "profile": "B"}\n```',
    );
    expect(result).toEqual({ name: "A", profile: "B" });
  });

  test("trims name and profile", () => {
    const result = parseResumeResponse(
      '{"name": "  A  ", "profile": "  B  "}',
    );
    expect(result).toEqual({ name: "A", profile: "B" });
  });

  test("accepts a missing name as empty string", () => {
    const result = parseResumeResponse('{"name": "", "profile": "B"}');
    expect(result.name).toBe("");
  });

  test("throws ProviderError(parse) on non-JSON", () => {
    expect(() => parseResumeResponse("not json")).toThrow(ProviderError);
  });

  test("throws ProviderError(parse) on empty profile", () => {
    expect(() => parseResumeResponse('{"name": "A", "profile": "  "}')).toThrow(
      ProviderError,
    );
  });

  test("throws ProviderError(parse) on missing fields", () => {
    expect(() => parseResumeResponse('{"name": "A"}')).toThrow(ProviderError);
  });
});

describe("RESUME_SYSTEM_PROMPT invariants", () => {
  // The anonymization contract lives in the prompt — pin its load-bearing
  // parts so a prompt edit that drops a rule fails loudly.
  test("demands the structured German sections", () => {
    for (const section of [
      "Kurzprofil",
      "Skills",
      "Berufserfahrung",
      "Ausbildung",
      "Sprachen",
    ]) {
      expect(RESUME_SYSTEM_PROMPT).toContain(section);
    }
  });

  test("forbids the protected attributes in the profile text", () => {
    for (const term of [
      "name",
      "address",
      "birth",
      "gender",
      "nationality",
      "religion",
      "company names",
    ]) {
      expect(RESUME_SYSTEM_PROMPT.toLowerCase()).toContain(term);
    }
  });

  test("demands JSON-only output with name and profile keys", () => {
    expect(RESUME_SYSTEM_PROMPT).toContain('"name"');
    expect(RESUME_SYSTEM_PROMPT).toContain('"profile"');
  });
});
