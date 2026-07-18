import { redirect } from "next/navigation";
import { settings } from "@/db/schema";
import { BackLink } from "@/app/components/back-link";
import { PromptLabForm } from "@/app/components/prompt-lab-form";
import { isAuthenticated } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getDictionary } from "@/lib/i18n";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/reranking/client";

export default async function PromptLabPage() {
  if (!(await isAuthenticated())) {
    redirect("/");
  }
  const dict = await getDictionary();
  const t = dict.promptLab;
  const [config] = await getDb().select().from(settings);
  const currentPrompt = config?.rerankSystemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <BackLink href="/settings" label={dict.settings.toSettings} />
      <section className="rounded-lg border border-border bg-surface p-6">
        <h1 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted">
          {t.heading}
        </h1>
        <p className="mb-4 text-xs text-muted">{t.note}</p>
        <PromptLabForm
          t={t}
          currentPrompt={currentPrompt}
          isCustom={!!config?.rerankSystemPrompt}
        />
      </section>
    </main>
  );
}
