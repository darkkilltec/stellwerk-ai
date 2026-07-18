import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { candidates } from "@/db/schema";
import { BackLink } from "@/app/components/back-link";
import { isAuthenticated } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getDictionary, getLocale } from "@/lib/i18n";

export default async function CandidateDetailPage({
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
  const locale = await getLocale();
  const [row] = await getDb()
    .select()
    .from(candidates)
    .where(eq(candidates.id, id));
  if (!row) {
    notFound();
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <BackLink href="/candidates" label={dict.candidates.heading} />
      <section className="rounded-lg border border-border bg-surface p-6">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h1 className="text-lg font-semibold tracking-tight">{row.name}</h1>
          <span className="flex items-center gap-2 font-mono text-xs text-muted">
            <span
              className={`inline-block size-1.5 shrink-0 rounded-full ${row.embeddingModel ? "bg-ok" : "bg-danger"}`}
            />
            {row.embeddingModel ?? "—"}
          </span>
        </div>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
          {dict.candidates.profile}
        </h2>
        <p className="whitespace-pre-wrap text-sm leading-6">{row.profile}</p>
        <p className="mt-4 text-xs text-muted">
          {row.createdAt.toLocaleString(locale)}
        </p>
      </section>
    </main>
  );
}
