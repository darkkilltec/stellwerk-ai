import { desc, inArray } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { evaluationItems, evaluationRuns, jobs } from "@/db/schema";
import { isAuthenticated } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getDictionary, type Dictionary } from "@/lib/i18n";
import { summarizeItems, type ItemStatus } from "@/lib/evaluation/helpers";

function statusBadge(t: Dictionary["runs"], status: string) {
  switch (status) {
    case "running":
      return { label: t.statusRunning, cls: "bg-warn" };
    case "done":
      return { label: t.statusDone, cls: "bg-ok" };
    case "cancelled":
      return { label: t.statusCancelled, cls: "bg-border" };
    default:
      return { label: t.statusFailed, cls: "bg-danger" };
  }
}

export default async function RunsPage() {
  if (!(await isAuthenticated())) {
    redirect("/");
  }
  const dict = await getDictionary();
  const t = dict.runs;
  const db = getDb();
  const runs = await db
    .select()
    .from(evaluationRuns)
    .orderBy(desc(evaluationRuns.createdAt));

  const jobIds = runs
    .map((run) => run.jobId)
    .filter((id): id is string => id !== null);
  const jobRows = jobIds.length
    ? await db
        .select({ id: jobs.id, title: jobs.title })
        .from(jobs)
        .where(inArray(jobs.id, jobIds))
    : [];
  const jobTitles = new Map(jobRows.map((j) => [j.id, j.title]));

  const itemRows = runs.length
    ? await db
        .select({
          runId: evaluationItems.runId,
          status: evaluationItems.status,
        })
        .from(evaluationItems)
        .where(
          inArray(
            evaluationItems.runId,
            runs.map((run) => run.id),
          ),
        )
    : [];
  const byRun = new Map<string, ItemStatus[]>();
  for (const row of itemRows) {
    const list = byRun.get(row.runId) ?? [];
    list.push(row.status as ItemStatus);
    byRun.set(row.runId, list);
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <h1 className="text-xs font-medium uppercase tracking-wider text-muted">
        {t.heading} <span className="font-mono">({runs.length})</span>
      </h1>
      {runs.length === 0 ? (
        <p className="font-mono text-sm text-muted">{t.empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {runs.map((run) => {
            const badge = statusBadge(t, run.status);
            const progress = summarizeItems(byRun.get(run.id) ?? []);
            return (
              <li key={run.id}>
                <Link
                  href={`/runs/${run.id}`}
                  className="flex items-center gap-4 p-4 transition-colors hover:bg-background"
                >
                  <span
                    className={`inline-block size-2 shrink-0 rounded-full ${badge.cls}`}
                    aria-label={badge.label}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {run.jobId
                        ? (jobTitles.get(run.jobId) ?? t.freeTextQuery)
                        : t.freeTextQuery}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {run.createdAt.toLocaleString()} · {badge.label}
                      {progress.error > 0 &&
                        ` · ${progress.error} ${t.errorsLabel}`}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted">
                    {progress.done + progress.error}/{run.total}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
