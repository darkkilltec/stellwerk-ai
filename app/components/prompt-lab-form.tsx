"use client";

import { useActionState } from "react";
import { promptLab, type PromptLabState } from "@/app/actions";
import type { Dictionary } from "@/lib/i18n";

const inputClass =
  "rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-muted";

function CaseResults({
  state,
  t,
}: {
  state: PromptLabState;
  t: Dictionary["promptLab"];
}) {
  if (!state || state.status === "error" || state.status === "reset") {
    return null;
  }
  return (
    <div className="rounded-md border border-border">
      <p className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted">
        {t.caseResults}
      </p>
      <ul className="divide-y divide-border">
        {state.results.map((r) => (
          <li key={r.name} className="flex items-start gap-2 px-3 py-2 text-sm">
            <span
              className={`mt-1.5 inline-block size-1.5 shrink-0 rounded-full ${r.problem === null ? "bg-ok" : "bg-danger"}`}
            />
            <span className="min-w-0">
              <span className="font-medium">{r.name}</span>{" "}
              <span className="font-mono text-[13px] text-muted">
                {r.score !== null && `Score ${Math.round(r.score)}`}
                {r.missing.length > 0 && ` · [${r.missing.join(", ")}]`}
              </span>
              {r.problem && (
                <span className="block text-xs text-danger">{r.problem}</span>
              )}
            </span>
          </li>
        ))}
        {state.custom && (
          <li className="px-3 py-2 text-sm">
            <span className="text-xs font-medium uppercase tracking-wider text-muted">
              {t.customResult}
            </span>
            <p className="mt-1 font-mono text-[13px]">
              Score {Math.round(state.custom.score)}
              {state.custom.missing.length > 0 &&
                ` · [${state.custom.missing.join(", ")}]`}
            </p>
            <p className="mt-1 text-xs text-muted">{state.custom.reasoning}</p>
          </li>
        )}
      </ul>
    </div>
  );
}

export function PromptLabForm({
  t,
  currentPrompt,
  isCustom,
}: {
  t: Dictionary["promptLab"];
  currentPrompt: string;
  isCustom: boolean;
}) {
  const [state, action, pending] = useActionState(promptLab, undefined);

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span
          className={`inline-block size-1.5 shrink-0 rounded-full ${isCustom ? "bg-warn" : "bg-ok"}`}
        />
        {isCustom ? t.customActive : t.defaultActive}
      </div>

      <label className="flex flex-col gap-2 text-sm text-muted">
        {t.editorLabel}
        <textarea
          name="prompt"
          rows={16}
          required
          defaultValue={currentPrompt}
          className={`${inputClass} font-mono text-[13px] leading-5`}
        />
      </label>

      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-sm text-muted">
          {t.customHeading}
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-2 text-sm text-muted">
            {t.customJob}
            <textarea name="customJob" rows={2} className={inputClass} />
          </label>
          <label className="flex flex-col gap-2 text-sm text-muted">
            {t.customProfile}
            <textarea name="customProfile" rows={2} className={inputClass} />
          </label>
        </div>
      </details>

      {state?.status === "error" && (
        <p className="text-sm text-danger" role="alert">
          {t.validation}
          {state.detail && (
            <span className="mt-1 block break-all font-mono text-xs text-muted">
              {state.detail}
            </span>
          )}
        </p>
      )}
      {state?.status === "gateFailed" && (
        <p className="text-sm text-danger" role="alert">
          {t.gateFailed}
        </p>
      )}
      {state?.status === "saved" && (
        <p className="flex items-center gap-2 text-sm" role="status">
          <span className="inline-block size-1.5 shrink-0 rounded-full bg-ok" />
          {t.saved}
        </p>
      )}
      {state?.status === "reset" && (
        <p className="flex items-center gap-2 text-sm" role="status">
          <span className="inline-block size-1.5 shrink-0 rounded-full bg-ok" />
          {t.resetDone}
        </p>
      )}

      <CaseResults state={state} t={t} />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          name="intent"
          value="save"
          disabled={pending}
          className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity disabled:opacity-50"
        >
          {pending ? t.testing : t.save}
        </button>
        <button
          type="submit"
          name="intent"
          value="test"
          disabled={pending}
          className="rounded-md border border-border px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50"
        >
          {t.test}
        </button>
        <button
          type="submit"
          name="intent"
          value="reset"
          disabled={pending || !isCustom}
          className="rounded-md border border-border px-3 py-2 text-sm text-muted transition-colors hover:text-foreground disabled:opacity-40"
        >
          {t.reset}
        </button>
      </div>
    </form>
  );
}
