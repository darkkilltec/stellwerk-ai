"use client";

import { useActionState } from "react";
import { startEvaluationRun, type StartRunState } from "@/app/actions";
import type { Dictionary } from "@/lib/i18n";

// Start card for a full-database evaluation run. Success redirects to
// /runs/<id> from the action, so only error states render here.
export function StartRunForm({
  t,
  jobParam,
  query,
  total,
  cached,
}: {
  t: Dictionary["runs"];
  jobParam?: string;
  query?: string;
  total: number;
  cached: number;
}) {
  const [state, action, pending] = useActionState<StartRunState, FormData>(
    startEvaluationRun,
    undefined,
  );
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <form action={action} className="flex flex-wrap items-center gap-4">
        {jobParam && <input type="hidden" name="job" value={jobParam} />}
        {query && <input type="hidden" name="q" value={query} />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {total} {t.candidatesLabel}
            {cached > 0 && (
              <span className="text-muted"> · {cached} {t.cachedInfo}</span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted">{t.startHint}</p>
          {state?.status === "error" && (
            <p className="mt-1 text-xs text-danger" role="alert">
              {state.kind === "notConfigured" ? t.notConfigured : t.validation}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity disabled:opacity-50"
        >
          {pending ? t.startPending : t.startButton}
        </button>
      </form>
    </section>
  );
}
