"use client";

import { useActionState, useState } from "react";
import type { SettingsSaveState } from "@/app/actions";
import type { Dictionary } from "@/lib/i18n";

type CurrentConfig = {
  provider: string;
  model: string;
  baseUrl: string | null;
  hasKey: boolean;
} | null;

// One form for every provider-config section (embedding, re-ranking):
// same test-gated flow, parameterized by action, providers, placeholders.
export function SettingsForm({
  t,
  current,
  action: saveAction,
  providers,
  modelPlaceholders,
}: {
  t: Dictionary["settings"];
  current: CurrentConfig;
  action: (
    prev: SettingsSaveState,
    formData: FormData,
  ) => Promise<SettingsSaveState>;
  providers: string[];
  modelPlaceholders: Record<string, string>;
}) {
  const [state, action, pending] = useActionState(saveAction, undefined);
  const [provider, setProvider] = useState(current?.provider ?? providers[0]);
  const needsKey = provider !== "ollama";
  const sameProvider = current?.provider === provider;

  const inputClass =
    "rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-muted";

  return (
    <form action={action} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm text-muted">{t.provider}</legend>
        <div className="flex overflow-hidden rounded-md border border-border text-sm">
          {providers.map((p) => (
            <label
              key={p}
              className={`flex-1 cursor-pointer px-3 py-2 text-center transition-colors ${
                provider === p
                  ? "bg-foreground text-background"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <input
                type="radio"
                name="provider"
                value={p}
                checked={provider === p}
                onChange={() => setProvider(p)}
                className="sr-only"
              />
              {p}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-2 text-sm text-muted">
        {t.model}
        <input
          name="model"
          type="text"
          required
          defaultValue={sameProvider ? current?.model : ""}
          placeholder={modelPlaceholders[provider]}
          className={`${inputClass} font-mono text-[13px]`}
        />
      </label>

      {needsKey && (
        <label className="flex flex-col gap-2 text-sm text-muted">
          {t.apiKey}
          <input
            name="apiKey"
            type="password"
            required={!(sameProvider && current?.hasKey)}
            placeholder={
              sameProvider && current?.hasKey ? `••••••  ${t.apiKeyStored}` : ""
            }
            className={inputClass}
          />
        </label>
      )}

      {provider === "ollama" && (
        <label className="flex flex-col gap-2 text-sm text-muted">
          {t.baseUrl}
          <input
            name="baseUrl"
            type="url"
            defaultValue={
              (sameProvider ? current?.baseUrl : null) ??
              "http://localhost:11434"
            }
            className={`${inputClass} font-mono text-[13px]`}
          />
        </label>
      )}

      {state?.status === "error" && (
        <div
          className="rounded-md border border-danger/40 p-3 text-sm"
          role="alert"
        >
          <p className="text-danger">
            {t.errors[state.kind]} — {t.notSaved}
          </p>
          {state.detail && (
            <p className="mt-1 break-all font-mono text-xs text-muted">
              {state.detail}
            </p>
          )}
        </div>
      )}
      {state?.status === "saved" && (
        <p className="flex items-center gap-2 text-sm" role="status">
          <span className="inline-block size-1.5 shrink-0 rounded-full bg-ok" />
          {t.saved} ({state.latencyMs}ms)
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity disabled:opacity-50"
      >
        {pending ? t.testing : t.submit}
      </button>
    </form>
  );
}
