import { asc } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { candidates } from "@/db/schema";
import { NewCandidateForm } from "@/app/components/create-forms";
import { isAuthenticated } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getDictionary } from "@/lib/i18n";
import { isRerankConfigured } from "@/lib/settings";

export default async function CandidatesPage() {
  if (!(await isAuthenticated())) {
    redirect("/");
  }
  const dict = await getDictionary();
  const t = dict.candidates;
  const uploadEnabled = await isRerankConfigured();
  const rows = await getDb()
    .select({
      id: candidates.id,
      name: candidates.name,
      profile: candidates.profile,
      embeddingModel: candidates.embeddingModel,
    })
    .from(candidates)
    .orderBy(asc(candidates.name));

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <NewCandidateForm
        t={dict.forms}
        tc={t}
        tu={dict.upload}
        uploadEnabled={uploadEnabled}
      />
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
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  <Link
                    href={`/candidates/${row.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {row.name}
                  </Link>
                </p>
                <p className="mt-1 line-clamp-2 text-sm text-muted">
                  {row.profile}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
