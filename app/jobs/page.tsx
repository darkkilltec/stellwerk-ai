import { asc } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { jobs } from "@/db/schema";
import { NewJobForm } from "@/app/components/create-forms";
import { isAuthenticated } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getDictionary } from "@/lib/i18n";

export default async function JobsPage() {
  if (!(await isAuthenticated())) {
    redirect("/");
  }
  const dict = await getDictionary();
  const t = dict.jobs;
  const rows = await getDb()
    .select({
      id: jobs.id,
      title: jobs.title,
      company: jobs.company,
      description: jobs.description,
      embeddingModel: jobs.embeddingModel,
    })
    .from(jobs)
    .orderBy(asc(jobs.title));

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <NewJobForm t={dict.forms} tj={t} />
      <h1 className="text-xs font-medium uppercase tracking-wider text-muted">
        {t.heading} <span className="font-mono">({rows.length})</span>
      </h1>
      {rows.length === 0 ? (
        <p className="font-mono text-sm text-muted">{t.empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {rows.map((row) => (
            <li key={row.id} className="flex items-start gap-4 p-4">
              <span
                className={`mt-1.5 inline-block size-1.5 shrink-0 rounded-full ${row.embeddingModel ? "bg-ok" : "bg-danger"}`}
                title={row.embeddingModel ?? undefined}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {row.title}
                  {row.company && (
                    <span className="ml-2 font-normal text-muted">
                      {row.company}
                    </span>
                  )}
                </p>
                <p className="mt-1 line-clamp-2 text-sm text-muted">
                  {row.description}
                </p>
              </div>
              <Link
                href={`/matching?job=${row.id}`}
                className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-muted hover:text-foreground"
              >
                {dict.matching.jobSubmit}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
