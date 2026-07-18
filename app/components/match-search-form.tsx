"use client";

import { useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n";

type JobOption = { id: string; title: string; company: string | null };

// One search card for HR users: two clearly separated tabs (job / free
// text), one search button. Picking a job searches immediately; the AI
// evaluation is a separate step on the result list.
export function MatchSearchForm({
  t,
  jobOptions,
  defaultJob,
  defaultQuery,
}: {
  t: Dictionary["matching"];
  jobOptions: JobOption[];
  defaultJob?: string;
  defaultQuery?: string;
}) {
  const [tab, setTab] = useState<"job" | "text">(
    defaultQuery ? "text" : "job",
  );
  const formRef = useRef<HTMLFormElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  function submitIfJobSelected() {
    if (tab === "job" && selectRef.current?.value) {
      formRef.current?.requestSubmit();
    }
  }

  const tabClass = (active: boolean) =>
    `flex-1 cursor-pointer px-3 py-2 text-center text-sm transition-colors ${
      active ? "bg-foreground text-background" : "text-muted hover:text-foreground"
    }`;

  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <div
        role="tablist"
        className="mb-4 flex overflow-hidden rounded-md border border-border"
      >
        <button
          type="button"
          role="tab"
          onClick={() => setTab("job")}
          aria-selected={tab === "job"}
          className={tabClass(tab === "job")}
        >
          {t.tabJob}
        </button>
        <button
          type="button"
          role="tab"
          onClick={() => setTab("text")}
          aria-selected={tab === "text"}
          className={tabClass(tab === "text")}
        >
          {t.tabText}
        </button>
      </div>

      <form ref={formRef} method="get" className="flex flex-col gap-4">
        {tab === "job" ? (
          <select
            ref={selectRef}
            name="job"
            defaultValue={defaultJob ?? ""}
            onChange={submitIfJobSelected}
            className="rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-muted"
          >
            <option value="" disabled>
              {t.selectJobPlaceholder}
            </option>
            {jobOptions.map((job) => (
              <option key={job.id} value={job.id}>
                {job.company ? `${job.title} — ${job.company}` : job.title}
              </option>
            ))}
          </select>
        ) : (
          <textarea
            name="q"
            rows={5}
            required
            defaultValue={defaultQuery ?? ""}
            placeholder={t.freeTextPlaceholder}
            className="rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-muted"
          />
        )}

        <button
          type="submit"
          className="self-start rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          {t.jobSubmit}
        </button>
      </form>
    </section>
  );
}
