import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  cancelEvaluationRun,
  resumeEvaluationRun,
} from "@/app/actions";
import { BackLink } from "@/app/components/back-link";
import { RunPoller } from "@/app/components/run-poller";
import { InterviewSection } from "@/app/components/rerank-stream-list";
import { scoreTier } from "@/app/components/score-tier";
import { evaluationItems, evaluationRuns, jobs } from "@/db/schema";
import { isAuthenticated } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  rankItems,
  summarizeItems,
  type ItemStatus,
} from "@/lib/evaluation/helpers";
import { getDictionary, type Dictionary } from "@/lib/i18n";

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

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAuthenticated())) {
    redirect("/");
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    notFound();
  }
  const dict = await getDictionary();
  const t = dict.runs;
  const db = getDb();
  const [run] = await db
    .select()
    .from(evaluationRuns)
    .where(eq(evaluationRuns.id, id));
  if (!run) {
    notFound();
  }
  const items = await db
    .select()
    .from(evaluationItems)
    .where(eq(evaluationItems.runId, id))
    .orderBy(asc(evaluationItems.candidateName));
  const progress = summarizeItems(items.map((i) => i.status as ItemStatus));
  const running = run.status === "running";
  const resumable =
    (run.status === "running" || run.status === "failed") &&
    progress.pending > 0;
  const badge = statusBadge(t, run.status);
  const jobTitle = run.jobId
    ? (
        await db
          .select({ title: jobs.title })
          .from(jobs)
          .where(eq(jobs.id, run.jobId))
      )[0]?.title
    : undefined;
  const ranked = rankItems(items.filter((item) => item.status === "done"));
  const failed = items.filter((item) => item.status === "error");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <RunPoller active={running} />
      <BackLink href="/runs" label={t.heading} />

      <section className="rounded-lg border border-border bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
            {jobTitle ?? t.freeTextQuery}
          </h1>
          <span className="flex items-center gap-2 text-xs text-muted">
            <span
              className={`inline-block size-2 shrink-0 rounded-full ${badge.cls}`}
            />
            {badge.label}
          </span>
        </div>
        <p className="mt-2 line-clamp-3 text-xs text-muted">{run.queryText}</p>
        <div className="mt-4 flex items-center gap-3">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
            <span
              className="block h-full rounded-full bg-foreground transition-all"
              style={{ width: `${progress.percent}%` }}
            />
          </span>
          <span className="shrink-0 font-mono text-xs text-muted">
            {progress.done + progress.error}/{progress.total}
            {progress.error > 0 && ` · ${progress.error} ${t.errorsLabel}`}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
          <span>
            {t.startedAt}: {run.createdAt.toLocaleString()}
          </span>
          {run.finishedAt && (
            <span>
              {t.finishedAt}: {run.finishedAt.toLocaleString()}
            </span>
          )}
          <span>
            {t.modelLabel}: <span className="font-mono">{run.model}</span>
          </span>
          {running && (
            <form action={cancelEvaluationRun}>
              <input type="hidden" name="runId" value={run.id} />
              <button
                type="submit"
                className="rounded-md border border-border px-2 py-1 font-medium transition-colors hover:border-muted"
              >
                {t.cancel}
              </button>
            </form>
          )}
          {resumable && (
            <form action={resumeEvaluationRun}>
              <input type="hidden" name="runId" value={run.id} />
              <button
                type="submit"
                className="rounded-md border border-border px-2 py-1 font-medium transition-colors hover:border-muted"
              >
                {t.resume}
              </button>
            </form>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface">
        <h2 className="border-b border-border p-4 text-xs font-medium uppercase tracking-wider text-muted">
          {t.ranking} <span className="font-mono">({ranked.length})</span>
        </h2>
        <ol className="divide-y divide-border">
          {ranked.map((item, index) => {
            const tier = scoreTier(dict.matching, item.score ?? 0);
            return (
              <li key={item.id} className="p-4">
                <div className="flex items-center gap-4">
                  <span className="w-6 shrink-0 font-mono text-sm text-muted">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {item.candidateId ? (
                      <Link
                        href={`/candidates/${item.candidateId}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {item.candidateName}
                      </Link>
                    ) : (
                      item.candidateName
                    )}
                  </span>
                  <span
                    className="flex w-24 shrink-0 items-center justify-end gap-2 text-right font-mono text-[13px]"
                    title={tier.label}
                  >
                    <span
                      className={`inline-block size-2 shrink-0 rounded-full ${tier.dot}`}
                      aria-label={tier.label}
                    />
                    {dict.matching.score} {Math.round(item.score ?? 0)}
                  </span>
                </div>
                <div className="mt-2 pl-10 text-xs text-muted">
                  {item.reasoning && <p>{item.reasoning}</p>}
                  {item.missingRequirements.length > 0 && (
                    <p className="mt-1">
                      <span className="font-medium">
                        {dict.matching.missing}:
                      </span>{" "}
                      {item.missingRequirements.join(" · ")}
                    </p>
                  )}
                  {item.candidateId && (
                    <InterviewSection
                      t={dict.matching}
                      candidateId={item.candidateId}
                      jobText={run.queryText}
                      missing={item.missingRequirements}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {failed.length > 0 && (
        <section className="rounded-lg border border-danger/40 bg-surface">
          <h2 className="border-b border-border p-4 text-xs font-medium uppercase tracking-wider text-danger">
            {t.errorItemsHeading}{" "}
            <span className="font-mono">({failed.length})</span>
          </h2>
          <ul className="divide-y divide-border">
            {failed.map((item) => (
              <li key={item.id} className="flex items-baseline gap-4 p-4">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {item.candidateName}
                </span>
                <span className="break-all font-mono text-xs text-muted">
                  {item.error}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
