import { count } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { candidates, jobs, settings } from "@/db/schema";
import { saveRerankSettings, saveSettings } from "@/app/actions";
import { BackLink } from "@/app/components/back-link";
import { DbStatusCard } from "@/app/components/db-status-card";
import { SettingsForm } from "@/app/components/settings-form";
import { isAuthenticated } from "@/lib/auth";
import { getDb, getDbStatus, type DbStatus } from "@/lib/db";
import { getDictionary, getLocale, type Locale } from "@/lib/i18n";

function LastTested({
  label,
  at,
  latencyMs,
  locale,
}: {
  label: string;
  at: Date | null;
  latencyMs: number | null;
  locale: Locale;
}) {
  if (!at) return null;
  return (
    <p className="mb-4 text-xs text-muted">
      {label}:{" "}
      <span className="font-mono">
        {at.toLocaleString(locale)} ({latencyMs}ms)
      </span>
    </p>
  );
}

export default async function SettingsPage() {
  if (!(await isAuthenticated())) {
    redirect("/");
  }
  const dict = await getDictionary();
  const t = dict.settings;
  const locale = await getLocale();
  const db = getDb();
  const [config] = await db.select().from(settings);
  const [candidateStats] = await db
    .select({ total: count(), embedded: count(candidates.embedding) })
    .from(candidates);
  const [jobStats] = await db
    .select({ total: count(), embedded: count(jobs.embedding) })
    .from(jobs);
  let status: DbStatus | null = null;
  let statusError: string | null = null;
  try {
    status = await getDbStatus();
  } catch (e) {
    statusError = e instanceof Error ? e.message : String(e);
  }

  return (
    <main className="flex flex-1 flex-col items-center gap-6 p-8">
      <div className="w-full max-w-md">
        <BackLink href="/matching" label={dict.nav.matching} />
      </div>

      <section className="w-full max-w-md rounded-lg border border-border bg-surface p-6">
        <h2 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted">
          {t.heading}
        </h2>
        <LastTested
          label={t.lastTested}
          at={config?.lastTestedAt ?? null}
          latencyMs={config?.lastTestLatencyMs ?? null}
          locale={locale}
        />
        <SettingsForm
          t={t}
          action={saveSettings}
          providers={["ollama", "openai", "voyage"]}
          modelPlaceholders={{
            ollama: "snowflake-arctic-embed2",
            openai: "text-embedding-3-small",
            voyage: "voyage-3",
          }}
          current={
            config
              ? {
                  provider: config.provider,
                  model: config.embeddingModel,
                  baseUrl: config.baseUrl,
                  hasKey: !!config.apiKeyEncrypted,
                }
              : null
          }
        />
        <p className="mt-4 text-xs text-muted">
          {t.coverage}:{" "}
          <span className="font-mono">
            {candidateStats.embedded}/{candidateStats.total}
          </span>{" "}
          {dict.nav.candidates} ·{" "}
          <span className="font-mono">
            {jobStats.embedded}/{jobStats.total}
          </span>{" "}
          {dict.nav.jobs}
        </p>
        <p className="mt-2 text-xs text-muted">{t.reEmbedHint}</p>
      </section>

      <section className="w-full max-w-md rounded-lg border border-border bg-surface p-6">
        <h2 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted">
          {t.rerankHeading}
        </h2>
        <p className="mb-4 text-xs text-muted">{t.rerankNote}</p>
        <LastTested
          label={t.lastTested}
          at={config?.rerankLastTestedAt ?? null}
          latencyMs={config?.rerankLastTestLatencyMs ?? null}
          locale={locale}
        />
        <SettingsForm
          t={t}
          action={saveRerankSettings}
          providers={["ollama", "anthropic", "openai"]}
          modelPlaceholders={{
            ollama: "qwen2.5:7b-instruct",
            anthropic: "claude-haiku-4-5",
            openai: "gpt-4o-mini",
          }}
          current={
            config?.rerankProvider && config.rerankModel
              ? {
                  provider: config.rerankProvider,
                  model: config.rerankModel,
                  baseUrl: config.rerankBaseUrl,
                  hasKey: !!config.rerankApiKeyEncrypted,
                }
              : null
          }
        />
      </section>

      <section className="w-full max-w-md rounded-lg border border-border bg-surface p-6">
        <h2 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted">
          {dict.promptLab.heading}
        </h2>
        <p className="mb-4 text-xs text-muted">{dict.promptLab.note}</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-xs text-muted">
            <span
              className={`inline-block size-1.5 shrink-0 rounded-full ${config?.rerankSystemPrompt ? "bg-warn" : "bg-ok"}`}
            />
            {config?.rerankSystemPrompt
              ? dict.promptLab.customActive
              : dict.promptLab.defaultActive}
          </span>
          <Link
            href="/settings/prompt"
            className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background"
          >
            {dict.promptLab.open}
          </Link>
        </div>
      </section>

      <div className="w-full max-w-md">
        <DbStatusCard status={status} error={statusError} dict={dict} />
      </div>
    </main>
  );
}
