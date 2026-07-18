"use client";

import { useActionState, useState } from "react";
import {
  createCandidate,
  createJob,
  parseResume,
  type CreateState,
  type ParseResumeState,
} from "@/app/actions";
import type { Dictionary } from "@/lib/i18n";

const inputClass =
  "rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-muted";

function CreateFeedback({
  state,
  t,
}: {
  state: CreateState;
  t: Dictionary["forms"];
}) {
  if (!state) return null;
  if (state.status === "created") {
    return (
      <p className="flex items-center gap-2 text-sm" role="status">
        <span className="inline-block size-1.5 shrink-0 rounded-full bg-ok" />
        {t.created}
      </p>
    );
  }
  if (state.status === "createdNoEmbedding") {
    return (
      <div className="rounded-md border border-danger/40 p-3 text-sm" role="alert">
        <p className="text-danger">{t.createdNoEmbedding}</p>
        <p className="mt-1 break-all font-mono text-xs text-muted">
          {state.detail}
        </p>
        <p className="mt-1 font-mono text-xs text-muted">{t.healHint}</p>
      </div>
    );
  }
  return (
    <p className="text-sm text-danger" role="alert">
      {state.kind === "validation" ? t.validation : t.unauthorized}
    </p>
  );
}

function UploadFeedback({
  state,
  tu,
}: {
  state: ParseResumeState;
  tu: Dictionary["upload"];
}) {
  if (!state) return null;
  if (state.status === "parsed") {
    return (
      <p className="flex items-center gap-2 text-sm" role="status">
        <span className="inline-block size-1.5 shrink-0 rounded-full bg-ok" />
        {tu.parsed}
      </p>
    );
  }
  const label =
    state.kind === "validation"
      ? tu.invalidFile
      : state.kind === "notConfigured"
        ? tu.notConfigured
        : state.kind === "emptyFile"
          ? tu.emptyFile
          : tu.failed;
  return (
    <div className="rounded-md border border-danger/40 p-3 text-sm" role="alert">
      <p className="text-danger">{label}</p>
      {state.detail && (
        <p className="mt-1 break-all font-mono text-xs text-muted">
          {state.detail}
        </p>
      )}
    </div>
  );
}

export function NewCandidateForm({
  t,
  tc,
  tu,
  uploadEnabled,
}: {
  t: Dictionary["forms"];
  tc: Dictionary["candidates"];
  tu: Dictionary["upload"];
  uploadEnabled: boolean;
}) {
  const [state, action, pending] = useActionState(createCandidate, undefined);
  const [parseState, parseAction, parsing] = useActionState(
    parseResume,
    undefined,
  );
  const [name, setName] = useState("");
  const [profile, setProfile] = useState("");
  // Phase two of the upload flow: the parsed result fills the fields for
  // human review; the user edits freely before createCandidate persists.
  // Adjusted during render (not in an effect) per React's guidance for
  // syncing state from a changed value — avoids the extra render an
  // effect-based setState would cause, and satisfies
  // react-hooks/set-state-in-effect.
  const [syncedParseState, setSyncedParseState] = useState(parseState);
  if (parseState !== syncedParseState) {
    setSyncedParseState(parseState);
    if (parseState?.status === "parsed") {
      setName(parseState.name);
      setProfile(parseState.profile);
    }
  }
  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted">
        {tc.newHeading}
      </h2>
      <form action={parseAction} className="mb-4 flex flex-col gap-3">
        <label className="flex flex-col gap-2 text-sm text-muted">
          {tu.heading}
          <input
            name="resume"
            type="file"
            accept=".pdf,.txt,.md"
            required
            disabled={!uploadEnabled}
            className={`${inputClass} file:mr-3 file:rounded file:border-0 file:bg-foreground file:px-2 file:py-1 file:text-xs file:text-background`}
          />
        </label>
        <p className="text-xs text-muted">
          {uploadEnabled ? tu.hint : tu.notConfigured}
        </p>
        <UploadFeedback state={parseState} tu={tu} />
        <button
          type="submit"
          disabled={!uploadEnabled || parsing}
          className="self-start rounded-md border border-border px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-50"
        >
          {parsing ? tu.parsing : tu.button}
        </button>
      </form>
      <form action={action} className="flex flex-col gap-3">
        <label className="flex flex-col gap-2 text-sm text-muted">
          {tc.name}
          <input
            name="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm text-muted">
          {tc.profileLabel}
          <textarea
            name="profile"
            rows={8}
            required
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            className={inputClass}
          />
        </label>
        <CreateFeedback state={state} t={t} />
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity disabled:opacity-50"
        >
          {pending ? t.creating : t.create}
        </button>
      </form>
    </section>
  );
}

export function NewJobForm({
  t,
  tj,
}: {
  t: Dictionary["forms"];
  tj: Dictionary["jobs"];
}) {
  const [state, action, pending] = useActionState(createJob, undefined);
  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted">
        {tj.newHeading}
      </h2>
      <form action={action} className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <label className="flex min-w-48 flex-1 flex-col gap-2 text-sm text-muted">
            {tj.title}
            <input name="title" type="text" required className={inputClass} />
          </label>
          <label className="flex min-w-48 flex-1 flex-col gap-2 text-sm text-muted">
            {tj.companyOptional}
            <input name="company" type="text" className={inputClass} />
          </label>
        </div>
        <label className="flex flex-col gap-2 text-sm text-muted">
          {tj.description}
          <textarea
            name="description"
            rows={4}
            required
            className={inputClass}
          />
        </label>
        <CreateFeedback state={state} t={t} />
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity disabled:opacity-50"
        >
          {pending ? t.creating : t.create}
        </button>
      </form>
    </section>
  );
}
