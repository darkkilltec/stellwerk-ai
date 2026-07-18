// Pure, DB-free pieces of the evaluation-run feature — kept separate so
// progress math and ranking are unit-testable without a worker.

export type ItemStatus = "pending" | "done" | "error";

export function summarizeItems(statuses: ItemStatus[]): {
  total: number;
  done: number;
  error: number;
  pending: number;
  percent: number;
} {
  const total = statuses.length;
  const done = statuses.filter((s) => s === "done").length;
  const error = statuses.filter((s) => s === "error").length;
  const pending = total - done - error;
  const percent = total === 0 ? 100 : Math.round(((done + error) / total) * 100);
  return { total, done, error, pending, percent };
}

export function rankItems<
  T extends { candidateName: string; score: number | null },
>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      (b.score ?? -1) - (a.score ?? -1) ||
      a.candidateName.localeCompare(b.candidateName),
  );
}
