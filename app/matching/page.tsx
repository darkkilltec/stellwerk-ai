import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { jobs } from "@/db/schema";
import { MatchSearchForm } from "@/app/components/match-search-form";
import { isAuthenticated } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { composeJobText } from "@/lib/embedding/compose";
import { getDictionary, type Dictionary } from "@/lib/i18n";
import { RerankStreamList } from "@/app/components/rerank-stream-list";
import { StartRunForm } from "@/app/components/start-run-form";
import { countCachedVerdicts } from "@/lib/evaluation/worker";
import {
  judgeRetrievedStreamed,
  matchCandidates,
  type Match,
} from "@/lib/matching";
import { isRerankConfigured } from "@/lib/settings";

type MatchingDict = Dictionary["matching"];

function SimilarityBar({ value }: { value: number }) {
  return (
    <span className="hidden h-1 w-32 shrink-0 overflow-hidden rounded-full bg-border sm:block">
      <span
        className="block h-full rounded-full bg-foreground"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </span>
  );
}

function RetrievalList({
  matches,
  t,
  judging,
  evaluateHref,
}: {
  matches: Match[];
  t: MatchingDict;
  judging?: boolean;
  evaluateHref?: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface">
      <h2 className="flex items-center justify-between gap-4 border-b border-border p-4 text-xs font-medium uppercase tracking-wider text-muted">
        {t.results}
        {evaluateHref && (
          <Link
            href={evaluateHref}
            title={t.rerankHelp}
            className="rounded-md bg-foreground px-3 py-1.5 font-sans text-xs font-medium normal-case tracking-normal text-background"
          >
            {t.evaluateList}
          </Link>
        )}
      </h2>
      {judging && (
        <div className="flex items-center gap-3 border-b border-border bg-background px-4 py-3 text-sm text-muted">
          <span className="inline-block size-2 shrink-0 animate-pulse rounded-full bg-foreground" />
          {t.judgingHint}
        </div>
      )}
      <ol className="divide-y divide-border">
        {matches.map((match, index) => (
          <li key={match.id} className="p-4">
            <div className="flex items-center gap-4">
              <span className="w-6 shrink-0 font-mono text-sm text-muted">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                <Link
                  href={`/candidates/${match.id}`}
                  className="underline-offset-2 hover:underline"
                >
                  {match.name}
                </Link>
              </span>
              <SimilarityBar value={match.similarity} />
              <span className="w-14 shrink-0 text-right font-mono text-[13px]">
                {match.similarity.toFixed(3)}
              </span>
            </div>
            {judging && (
              <div className="mt-2 flex flex-col gap-1.5 pl-10">
                <span className="h-2.5 w-2/3 animate-pulse rounded bg-border" />
                <span className="h-2.5 w-2/5 animate-pulse rounded bg-border" />
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ErrorBox({ label, detail }: { label: string; detail: string }) {
  return (
    <section
      className="rounded-lg border border-danger/40 bg-surface p-4 text-sm"
      role="alert"
    >
      <p className="text-danger">{label}</p>
      <p className="mt-1 break-all font-mono text-xs text-muted">{detail}</p>
    </section>
  );
}

// Builds one judgment promise per candidate (cache hits resolve
// instantly) and hands them to the client list, which streams each
// verdict as it lands and re-sorts once all are in. A failure before
// any judging keeps the vector ranking on screen.
async function RerankedSection({
  queryText,
  retrieved,
  t,
  retryHref,
}: {
  queryText: string;
  retrieved: Match[];
  t: MatchingDict;
  retryHref: string;
}) {
  let items: Awaited<ReturnType<typeof judgeRetrievedStreamed>> | null = null;
  let error: string | null = null;
  try {
    items = await judgeRetrievedStreamed(queryText, retrieved);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  if (error !== null || items === null) {
    return (
      <>
        <section
          className="rounded-lg border border-danger/40 bg-surface p-4 text-sm"
          role="alert"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-danger">{t.rerankFailed}</p>
            <Link
              href={retryHref}
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background"
            >
              {t.retryEvaluate}
            </Link>
          </div>
          <p className="mt-1 break-all font-mono text-xs text-muted">
            {error ?? "unknown"}
          </p>
        </section>
        <RetrievalList matches={retrieved} t={t} />
      </>
    );
  }
  return (
    <RerankStreamList
      t={t}
      jobText={queryText}
      rows={items.map((item) => ({
        id: item.match.id,
        name: item.match.name,
        similarity: item.match.similarity,
        vectorRank: item.vectorRank,
      }))}
      judgments={items.map((item) => item.judgment)}
    />
  );
}

function RankedResults({
  retrieved,
  queryText,
  useRerank,
  rerankHref,
  t,
}: {
  retrieved: Match[];
  queryText: string;
  useRerank: boolean;
  rerankHref?: string;
  t: MatchingDict;
}) {
  if (useRerank && rerankHref) {
    return (
      <Suspense fallback={<RetrievalList matches={retrieved} t={t} judging />}>
        <RerankedSection
          queryText={queryText}
          retrieved={retrieved}
          t={t}
          retryHref={rerankHref}
        />
      </Suspense>
    );
  }
  return (
    <RetrievalList matches={retrieved} t={t} evaluateHref={rerankHref} />
  );
}

// GET-based on purpose: a ranking is an addressable result
// (/matching?job=slug&rr=1), not client state.
export default async function MatchingPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; q?: string; rr?: string }>;
}) {
  if (!(await isAuthenticated())) {
    redirect("/");
  }
  const dict = await getDictionary();
  const t = dict.matching;
  const params = await searchParams;
  const db = getDb();

  const rerankAvailable = await isRerankConfigured();
  const useRerank = rerankAvailable && params.rr === "1";

  const jobOptions = await db
    .select({ id: jobs.id, title: jobs.title, company: jobs.company })
    .from(jobs)
    .orderBy(asc(jobs.title), asc(jobs.company));

  const query = params.q?.trim();
  const jobParam = params.job;
  let queryText: string | undefined = query;
  let resolvedJobId: string | undefined;
  let retrieved: Match[] | null = null;
  let error: string | null = null;

  if (query || jobParam) {
    try {
      if (!queryText && jobParam) {
        // The param is the job id; slug is accepted too so older
        // golden-set URLs keep working.
        const isUuid = /^[0-9a-f-]{36}$/i.test(jobParam);
        const [job] = await db
          .select()
          .from(jobs)
          .where(isUuid ? eq(jobs.id, jobParam) : eq(jobs.slug, jobParam));
        if (job) {
          resolvedJobId = job.id;
          queryText = composeJobText(job);
        }
      }
      if (queryText) {
        retrieved = await matchCandidates(queryText, 10);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  let runPrecount: { total: number; cached: number } | null = null;
  if (retrieved && queryText && rerankAvailable) {
    try {
      runPrecount = await countCachedVerdicts(queryText);
    } catch {
      runPrecount = null;
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <h1 className="text-xs font-medium uppercase tracking-wider text-muted">
        {t.heading}
      </h1>

      <MatchSearchForm
        t={t}
        jobOptions={jobOptions}
        defaultJob={jobParam}
        defaultQuery={query}
      />

      {error && <ErrorBox label={t.errorLabel} detail={error} />}

      {retrieved && queryText && (
        <>
          <RankedResults
            retrieved={retrieved}
            queryText={queryText}
            useRerank={useRerank}
            rerankHref={
              rerankAvailable
                ? `/matching?${new URLSearchParams(
                    query
                      ? { q: query, rr: "1" }
                      : { job: jobParam ?? "", rr: "1" },
                  ).toString()}`
                : undefined
            }
            t={t}
          />
          {runPrecount && (
            <StartRunForm
              t={dict.runs}
              jobParam={resolvedJobId}
              query={query}
              total={runPrecount.total}
              cached={runPrecount.cached}
            />
          )}
        </>
      )}
    </main>
  );
}
