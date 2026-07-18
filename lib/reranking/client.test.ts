import { describe, expect, test } from "bun:test";
import { enforceScoreConsistency, GAP_SCORE_CEILINGS } from "./client";

// The judge's score must never contradict its own missing-requirements
// list. Small models drift here, and prompt-side penalty rules backfire
// (they incentivize shorter gap lists) — so the guard lives in code.
describe("enforceScoreConsistency", () => {
  test("no gaps: score passes through", () => {
    expect(enforceScoreConsistency(95, [])).toBe(95);
    expect(enforceScoreConsistency(100, [])).toBe(100);
  });

  test("one gap caps at 84", () => {
    expect(enforceScoreConsistency(90, ["a"])).toBe(84);
    expect(enforceScoreConsistency(80, ["a"])).toBe(80);
  });

  test("two gaps cap at 74", () => {
    expect(enforceScoreConsistency(89, ["a", "b"])).toBe(74);
  });

  test("three or more gaps cap at 59", () => {
    expect(enforceScoreConsistency(89, ["a", "b", "c"])).toBe(59);
    expect(enforceScoreConsistency(95, ["a", "b", "c", "d", "e"])).toBe(59);
  });

  test("scores below the ceiling are never raised", () => {
    expect(enforceScoreConsistency(20, ["a", "b", "c"])).toBe(20);
    expect(enforceScoreConsistency(0, [])).toBe(0);
  });

  test("ceilings are monotonically decreasing", () => {
    for (let i = 1; i < GAP_SCORE_CEILINGS.length; i++) {
      expect(GAP_SCORE_CEILINGS[i]).toBeLessThan(GAP_SCORE_CEILINGS[i - 1]);
    }
  });
});
