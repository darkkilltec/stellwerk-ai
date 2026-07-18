import { describe, expect, test } from "bun:test";
import { rankItems, summarizeItems } from "./helpers";

describe("summarizeItems", () => {
  test("counts statuses and percent of settled items", () => {
    expect(
      summarizeItems(["done", "done", "error", "pending"]),
    ).toEqual({ total: 4, done: 2, error: 1, pending: 1, percent: 75 });
  });

  test("empty run is 100 percent settled", () => {
    expect(summarizeItems([])).toEqual({
      total: 0,
      done: 0,
      error: 0,
      pending: 0,
      percent: 100,
    });
  });

  test("all pending is 0 percent", () => {
    expect(summarizeItems(["pending", "pending"]).percent).toBe(0);
  });
});

describe("rankItems", () => {
  test("sorts by score desc, name asc on ties, null score last", () => {
    const ranked = rankItems([
      { candidateName: "Zoe", score: 70 },
      { candidateName: "Anna", score: 90 },
      { candidateName: "Ben", score: 70 },
      { candidateName: "Nora", score: null },
    ]);
    expect(ranked.map((r) => r.candidateName)).toEqual([
      "Anna",
      "Ben",
      "Zoe",
      "Nora",
    ]);
  });

  test("does not mutate the input array", () => {
    const input = [
      { candidateName: "B", score: 1 },
      { candidateName: "A", score: 2 },
    ];
    rankItems(input);
    expect(input[0].candidateName).toBe("B");
  });
});
