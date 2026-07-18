import { describe, expect, test } from "bun:test";
import { ProviderError } from "@/lib/providers/http";
import {
  INTERVIEW_SYSTEM_PROMPT,
  parseInterviewResponse,
} from "./interview";

describe("parseInterviewResponse", () => {
  test("parses grouped questions", () => {
    const result = parseInterviewResponse(
      '{"technical": ["T1?"], "experience": ["E1?", "E2?"], "gaps": ["G1?"]}',
    );
    expect(result).toEqual({
      technical: ["T1?"],
      experience: ["E1?", "E2?"],
      gaps: ["G1?"],
    });
  });

  test("strips code fences and filters non-strings", () => {
    const result = parseInterviewResponse(
      '```json\n{"technical": ["T1?", 5], "experience": [], "gaps": []}\n```',
    );
    expect(result.technical).toEqual(["T1?"]);
  });

  test("accepts empty gaps group", () => {
    const result = parseInterviewResponse(
      '{"technical": ["T?"], "experience": ["E?"], "gaps": []}',
    );
    expect(result.gaps).toEqual([]);
  });

  test("throws ProviderError(parse) on non-JSON", () => {
    expect(() => parseInterviewResponse("nope")).toThrow(ProviderError);
  });

  test("throws ProviderError(parse) when every group is empty", () => {
    expect(() =>
      parseInterviewResponse('{"technical": [], "experience": [], "gaps": []}'),
    ).toThrow(ProviderError);
  });

  test("throws ProviderError(parse) on missing groups", () => {
    expect(() => parseInterviewResponse('{"technical": ["T?"]}')).toThrow(
      ProviderError,
    );
  });
});

describe("INTERVIEW_SYSTEM_PROMPT invariants", () => {
  test("stays name-blind", () => {
    expect(INTERVIEW_SYSTEM_PROMPT.toLowerCase()).toContain("das profil");
  });
  test("targets the missing requirements", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("MISSING REQUIREMENTS");
  });
  test("demands JSON-only grouped output", () => {
    for (const key of ['"technical"', '"experience"', '"gaps"']) {
      expect(INTERVIEW_SYSTEM_PROMPT).toContain(key);
    }
  });
});
