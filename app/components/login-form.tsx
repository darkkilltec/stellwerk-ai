"use client";

import { useActionState } from "react";
import { login } from "@/app/actions";
import type { Dictionary } from "@/lib/i18n";

export function LoginForm({
  t,
  devPassword,
}: {
  t: Dictionary["login"];
  devPassword?: string;
}) {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <section className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
      <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted">
        {t.heading}
      </h2>
      <form action={action} className="flex flex-col gap-3">
        <label className="text-sm text-muted" htmlFor="password">
          {t.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          // Prefilled in local development (value never ships in prod
          // builds) — signing in is a single click, but the auth flow
          // itself stays exercised.
          defaultValue={devPassword ?? ""}
          className="rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-muted"
        />
        {state?.error && (
          <p className="text-sm text-danger" role="alert">
            {t[state.error]}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="mt-1 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity disabled:opacity-50"
        >
          {pending ? t.pending : t.submit}
        </button>
      </form>
      {devPassword && (
        <p className="mt-4 border-t border-dashed border-border pt-3 text-xs text-muted">
          {t.devHint}{" "}
          <code className="rounded bg-background px-1.5 py-0.5 font-mono">
            {devPassword}
          </code>
        </p>
      )}
    </section>
  );
}
