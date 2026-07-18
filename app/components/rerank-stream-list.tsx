"use client";

import Link from "next/link";
import {
  Component,
  Suspense,
  use,
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  generateInterviewQuestions,
  type InterviewState,
} from "@/app/actions";
import type { Dictionary } from "@/lib/i18n";
import type { Judgment } from "@/lib/reranking/client";
import { scoreTier } from "./score-tier";

type MatchingDict = Dictionary["matching"];

export type StreamRow = {
  id: string;
  name: string;
  similarity: number;
  vectorRank: number;
};

// Each verdict streams in on its own: rows start in vector order with
// skeletons, fill as the AI finishes them (top vector hits first), and
// once every verdict is in, the list re-sorts by score.
export function RerankStreamList({
  t,
  jobText,
  rows,
  judgments,
}: {
  t: MatchingDict;
  jobText: string;
  rows: StreamRow[];
  judgments: Promise<Judgment>[];
}) {
  const [scores, setScores] = useState<Map<number, number>>(new Map());
  const onSettled = useCallback((index: number, score: number | null) => {
    setScores((prev) => {
      if (prev.has(index)) return prev;
      const next = new Map(prev);
      next.set(index, score ?? -1);
      return next;
    });
  }, []);

  const allSettled = scores.size === rows.length;
  const order = useMemo(() => {
    const indexes = rows.map((_, i) => i);
    if (!allSettled) return indexes;
    return indexes.sort(
      (a, b) =>
        (scores.get(b) ?? -1) - (scores.get(a) ?? -1) ||
        rows[b].similarity - rows[a].similarity,
    );
  }, [allSettled, scores, rows]);

  return (
    <section className="rounded-lg border border-border bg-surface">
      <h2 className="border-b border-border p-4 text-xs font-medium uppercase tracking-wider text-muted">
        {t.results}
      </h2>
      {!allSettled && (
        <div className="flex items-center gap-3 border-b border-border bg-background px-4 py-3 text-sm text-muted">
          <span className="inline-block size-2 shrink-0 animate-pulse rounded-full bg-foreground" />
          {t.judgingHint}
        </div>
      )}
      <ol className="divide-y divide-border">
        {order.map((rowIndex, position) => {
          const row = rows[rowIndex];
          return (
            <li key={row.id} className="p-4">
              <div className="flex items-center gap-4">
                <span className="w-6 shrink-0 font-mono text-sm text-muted">
                  {position + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  <Link
                    href={`/candidates/${row.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {row.name}
                  </Link>
                </span>
                <RowVerdictScore
                  t={t}
                  row={row}
                  judgment={judgments[rowIndex]}
                  index={rowIndex}
                  onSettled={onSettled}
                />
              </div>
              <RowVerdictBody
                t={t}
                candidateId={row.id}
                jobText={jobText}
                judgment={judgments[rowIndex]}
                index={rowIndex}
                onSettled={onSettled}
              />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function RowVerdictScore({
  t,
  row,
  judgment,
  index,
  onSettled,
}: {
  t: MatchingDict;
  row: StreamRow;
  judgment: Promise<Judgment>;
  index: number;
  onSettled: (index: number, score: number | null) => void;
}) {
  return (
    <RowErrorBoundary index={index} onSettled={onSettled} fallback={null}>
      <Suspense
        fallback={
          <span className="h-2.5 w-16 shrink-0 animate-pulse rounded bg-border" />
        }
      >
        <ScoreValue t={t} row={row} judgment={judgment} />
      </Suspense>
    </RowErrorBoundary>
  );
}

function ScoreValue({
  t,
  row,
  judgment,
}: {
  t: MatchingDict;
  row: StreamRow;
  judgment: Promise<Judgment>;
}) {
  const verdict = use(judgment);
  const tier = scoreTier(t, verdict.score);
  return (
    <span
      className="flex w-24 shrink-0 items-center justify-end gap-2 text-right font-mono text-[13px]"
      title={`${tier.label} · ${t.vectorRank} ${row.vectorRank} · ${t.similarity} ${row.similarity.toFixed(3)}`}
    >
      <span
        className={`inline-block size-2 shrink-0 rounded-full ${tier.dot}`}
        aria-label={tier.label}
      />
      {t.score} {Math.round(verdict.score)}
    </span>
  );
}

function RowVerdictBody({
  t,
  candidateId,
  jobText,
  judgment,
  index,
  onSettled,
}: {
  t: MatchingDict;
  candidateId: string;
  jobText: string;
  judgment: Promise<Judgment>;
  index: number;
  onSettled: (index: number, score: number | null) => void;
}) {
  return (
    <RowErrorBoundary
      index={index}
      onSettled={onSettled}
      fallback={
        <p className="mt-2 pl-10 text-xs text-danger">{t.rerankFailed}</p>
      }
    >
      <Suspense
        fallback={
          <div className="mt-2 flex flex-col gap-1.5 pl-10">
            <span className="h-2.5 w-2/3 animate-pulse rounded bg-border" />
            <span className="h-2.5 w-2/5 animate-pulse rounded bg-border" />
          </div>
        }
      >
        <VerdictBody
          t={t}
          candidateId={candidateId}
          jobText={jobText}
          judgment={judgment}
          index={index}
          onSettled={onSettled}
        />
      </Suspense>
    </RowErrorBoundary>
  );
}

function VerdictBody({
  t,
  candidateId,
  jobText,
  judgment,
  index,
  onSettled,
}: {
  t: MatchingDict;
  candidateId: string;
  jobText: string;
  judgment: Promise<Judgment>;
  index: number;
  onSettled: (index: number, score: number | null) => void;
}) {
  const verdict = use(judgment);
  useEffect(() => {
    onSettled(index, verdict.score);
  }, [index, verdict.score, onSettled]);
  return (
    <div className="mt-2 pl-10 text-xs text-muted">
      <p>{verdict.reasoning}</p>
      {verdict.missingRequirements.length > 0 && (
        <p className="mt-1">
          <span className="font-medium">{t.missing}:</span>{" "}
          {verdict.missingRequirements.join(" · ")}
        </p>
      )}
      <InterviewSection
        t={t}
        candidateId={candidateId}
        jobText={jobText}
        missing={verdict.missingRequirements}
      />
    </div>
  );
}

export function InterviewSection({
  t,
  candidateId,
  jobText,
  missing,
}: {
  t: MatchingDict;
  candidateId: string;
  jobText: string;
  missing: string[];
}) {
  const [state, action, pending] = useActionState<InterviewState, FormData>(
    generateInterviewQuestions,
    undefined,
  );
  if (state?.status === "generated") {
    const groups = [
      { label: t.interviewTechnical, questions: state.guide.technical },
      { label: t.interviewExperience, questions: state.guide.experience },
      { label: t.interviewGaps, questions: state.guide.gaps },
    ].filter((group) => group.questions.length > 0);
    return (
      <div className="mt-3 rounded-md border border-border bg-background p-3">
        {groups.map((group) => (
          <div key={group.label} className="mb-2 last:mb-0">
            <p className="text-[11px] font-medium uppercase tracking-wider">
              {group.label}
            </p>
            <ul className="mt-1 list-disc pl-4">
              {group.questions.map((question) => (
                <li key={question} className="mt-0.5">
                  {question}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }
  return (
    <form action={action} className="mt-2">
      <input type="hidden" name="candidateId" value={candidateId} />
      <input type="hidden" name="jobText" value={jobText} />
      <input type="hidden" name="missing" value={JSON.stringify(missing)} />
      {state?.status === "error" && (
        <p className="mb-1 text-danger" role="alert">
          {t.interviewFailed} {state.detail ?? state.kind}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border px-2 py-1 text-[11px] font-medium transition-opacity disabled:opacity-50"
      >
        {pending ? t.interviewGenerating : t.interviewButton}
      </button>
    </form>
  );
}

class RowErrorBoundary extends Component<{
  index: number;
  onSettled: (index: number, score: number | null) => void;
  fallback: ReactNode;
  children: ReactNode;
}> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onSettled(this.props.index, null);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
