# Resume-Upload mit Anonymisierung + Interview-Leitfaden — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PDF/TXT/MD-Lebenslauf hochladen → Text extrahieren → per LLM anonymisieren und strukturieren → Kandidaten-Formular vorbefüllen → bestehender Speicher-/Embedding-Pfad; plus Interview-Leitfaden-Button im Matching-Ergebnis, der Fragen gezielt auf die `missingRequirements` des Verdikts richtet.

**Architecture:** Zwei-Phasen mit Vorschau. Eine neue Server Action `parseResume` extrahiert (unpdf) und ruft das LLM über die vorhandene Rerank-Provider-Config auf; das Ergebnis füllt kontrollierte Formularfelder, der Nutzer prüft, der unveränderte `createCandidate`-Pfad speichert und embedded. Ein generischer JSON-Completion-Helper wird aus dem Rerank-Client extrahiert und von Judge, Resume-Parser und Interview-Generator geteilt.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19 (`useActionState`), Bun (+ `bun:test`), Drizzle/Postgres (unverändert), `unpdf` (neu).

**Spec:** `docs/superpowers/specs/2026-07-17-resume-upload-design.md`

## Global Constraints

- **KEINE Branches, KEINE Commits durch Agenten** — der Nutzer committet selbst. Am Ende jedes Tasks nur die vorgeschlagene Commit-Message ausgeben.
- Next.js 16 mit Breaking Changes: Vor Code an einer unbekannten Next-API die passende Doku in `node_modules/next/dist/docs/` lesen (AGENTS.md). Die für diesen Plan relevanten Fakten sind bereits verifiziert: Server-Action-Body-Limit heißt `experimental.serverActions.bodySizeLimit` (Default 1 MB, multipart-Overhead einrechnen); Server Actions werden pro Client sequenziell dispatcht; jede Action braucht eigenen Auth-Check.
- UI-Texte immer in **beiden** Locales (`de` und `en`) in `lib/i18n/dictionaries.ts`; Fehler als Codes, nie als rohe Strings ins UI.
- Der rohe (nicht anonymisierte) Resume-Text darf **niemals** automatisch ins Profilfeld oder in die DB gelangen — auch nicht im Fehlerfall.
- Der Kandidaten-Name gehört ausschließlich ins `name`-Feld (vom Embedding ausgeschlossen via `composeCandidateText`); Prompts an Judge/Interview-Generator bleiben namensblind.
- Typecheck: `bunx tsc --noEmit`. Lint: `bun run lint`. Unit-Tests: `bun test lib/resume` (bun:test, neu in diesem Plan — es gibt bisher keine Unit-Test-Infrastruktur im Repo, `bun test` läuft ohne Konfiguration).
- LLM-Zugang ausschließlich über die vorhandene Rerank-Config (`getValidatedRerankSettings()`); deren `systemPrompt`-Override (Prompt-Lab) gilt NUR für den Judge und darf Parser/Interview-Generator nicht beeinflussen.

## File Structure

- **Create** `lib/providers/complete.ts` — generischer provider-dispatchter JSON-Chat-Call (aus `lib/reranking/client.ts` extrahiert).
- **Modify** `lib/reranking/client.ts` — `requestJudgment` delegiert an `completeJson`; Verhalten identisch.
- **Create** `lib/resume/parse.ts` — Anonymisierungs-/Struktur-Prompt, Response-Parsing, `parseResumeText`.
- **Create** `lib/resume/parse.test.ts` — Unit-Tests (Parsing + Prompt-Invarianten).
- **Create** `lib/resume/interview.ts` — Interview-Prompt, Response-Parsing, `generateInterviewGuide`.
- **Create** `lib/resume/interview.test.ts` — Unit-Tests.
- **Modify** `app/actions.ts` — Server Actions `parseResume`, `generateInterviewQuestions`.
- **Modify** `next.config.ts` — Body-Limit `6mb`.
- **Modify** `app/components/create-forms.tsx` — Upload-Zone + kontrollierte Felder in `NewCandidateForm`.
- **Modify** `app/candidates/page.tsx` — `uploadEnabled` (aus `isRerankConfigured()`) durchreichen.
- **Modify** `app/components/rerank-stream-list.tsx` — Interview-Button + Inline-Anzeige.
- **Modify** `app/matching/page.tsx` — `jobText` an `RerankStreamList` durchreichen.
- **Modify** `lib/i18n/dictionaries.ts` — Sektionen `upload` und `matching.interview*` (de + en).

---

### Task 1: Generischer JSON-Completion-Helper (`lib/providers/complete.ts`)

**Files:**
- Create: `lib/providers/complete.ts`
- Modify: `lib/reranking/client.ts` (Funktion `requestJudgment`, ca. Zeile 96–163)

**Interfaces:**
- Consumes: `postJson`, `ProviderError` aus `lib/providers/http.ts` (existiert).
- Produces: `completeJson(cfg: ChatConfig, systemPrompt: string, userPrompt: string, ollamaSchema: object, maxTokens?: number): Promise<string>` und `type ChatConfig = { provider: "anthropic" | "ollama" | "openai"; model: string; apiKey?: string; baseUrl?: string }`. Tasks 2, 4 und 5 hängen von exakt diesen Signaturen ab. `RerankConfig` ist strukturell ein `ChatConfig` (plus `systemPrompt`) und kann direkt übergeben werden.

- [ ] **Step 1: `lib/providers/complete.ts` anlegen**

Der Provider-Dispatch ist der bisherige Body von `requestJudgment` in `lib/reranking/client.ts:96-163`, parametrisiert um `systemPrompt`, `ollamaSchema` und `maxTokens`:

```ts
import { postJson, ProviderError } from "@/lib/providers/http";

export type ChatProvider = "anthropic" | "ollama" | "openai";

export type ChatConfig = {
  provider: ChatProvider;
  model: string;
  apiKey?: string; // anthropic, openai
  baseUrl?: string; // ollama only
};

// One provider-dispatched chat call that must answer with a single JSON
// object — shared by the judge, the resume parser and the interview
// generator. `ollamaSchema` is enforced via ollama's `format` parameter;
// openai gets json_object mode, anthropic prompt discipline.
export async function completeJson(
  cfg: ChatConfig,
  systemPrompt: string,
  userPrompt: string,
  ollamaSchema: object,
  maxTokens = 500,
): Promise<string> {
  switch (cfg.provider) {
    case "anthropic": {
      const data = await postJson(
        "https://api.anthropic.com/v1/messages",
        {
          model: cfg.model,
          max_tokens: maxTokens,
          temperature: 0,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        },
        {
          "x-api-key": cfg.apiKey ?? "",
          "anthropic-version": "2023-06-01",
        },
      );
      const content = (data as { content: { type: string; text?: string }[] })
        .content;
      const text = content?.find((c) => c.type === "text")?.text;
      if (!text) throw new ProviderError("parse", "Empty model response");
      return text;
    }
    case "openai": {
      const data = await postJson(
        "https://api.openai.com/v1/chat/completions",
        {
          model: cfg.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        },
        { Authorization: `Bearer ${cfg.apiKey ?? ""}` },
      );
      const text = (
        data as { choices: { message: { content: string | null } }[] }
      ).choices?.[0]?.message?.content;
      if (!text) throw new ProviderError("parse", "Empty model response");
      return text;
    }
    case "ollama": {
      const baseUrl = (cfg.baseUrl ?? "http://localhost:11434").replace(
        /\/$/,
        "",
      );
      const data = await postJson(`${baseUrl}/api/chat`, {
        model: cfg.model,
        stream: false,
        format: ollamaSchema,
        options: { temperature: 0 },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });
      const text = (data as { message?: { content?: string } }).message
        ?.content;
      if (!text) throw new ProviderError("parse", "Empty model response");
      return text;
    }
  }
}
```

- [ ] **Step 2: `requestJudgment` in `lib/reranking/client.ts` auf den Helper umstellen**

Den kompletten `switch`-Body von `requestJudgment` ersetzen durch:

```ts
async function requestJudgment(
  prompt: string,
  cfg: RerankConfig,
): Promise<string> {
  return completeJson(
    cfg,
    cfg.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    prompt,
    JUDGMENT_SCHEMA,
  );
}
```

Oben in der Datei importieren: `import { completeJson } from "@/lib/providers/complete";`. Der Import von `postJson` in `client.ts` entfällt, wenn er sonst nirgends in der Datei benutzt wird (prüfen; `ProviderError` wird weiter für `parseJudgment` gebraucht).

- [ ] **Step 3: Typecheck und Lint**

Run: `bunx tsc --noEmit && bun run lint`
Expected: beide ohne Fehler (Warnungen zu unbenutzten Imports beheben).

- [ ] **Step 4: Commit-Message ausgeben (NICHT committen)**

Vorschlag: `refactor: extract provider-dispatched JSON completion into lib/providers/complete`

---

### Task 2: Resume-Parser `lib/resume/parse.ts` (TDD)

**Files:**
- Create: `lib/resume/parse.ts`
- Test: `lib/resume/parse.test.ts`

**Interfaces:**
- Consumes: `completeJson`, `ChatConfig` aus `lib/providers/complete.ts` (Task 1); `ProviderError` aus `lib/providers/http.ts`.
- Produces: `type ParsedResume = { name: string; profile: string }`, `parseResumeResponse(raw: string): ParsedResume` (pur, testbar), `parseResumeText(raw: string, cfg: ChatConfig): Promise<ParsedResume>`, `RESUME_SYSTEM_PROMPT: string`. Task 3 ruft `parseResumeText` auf.

- [ ] **Step 1: Failing Tests schreiben (`lib/resume/parse.test.ts`)**

```ts
import { describe, expect, test } from "bun:test";
import { ProviderError } from "@/lib/providers/http";
import { parseResumeResponse, RESUME_SYSTEM_PROMPT } from "./parse";

describe("parseResumeResponse", () => {
  test("parses a plain JSON object", () => {
    const result = parseResumeResponse(
      '{"name": "Erika Musterfrau", "profile": "Kurzprofil:\\nBackend."}',
    );
    expect(result).toEqual({
      name: "Erika Musterfrau",
      profile: "Kurzprofil:\nBackend.",
    });
  });

  test("strips markdown code fences", () => {
    const result = parseResumeResponse(
      '```json\n{"name": "A", "profile": "B"}\n```',
    );
    expect(result).toEqual({ name: "A", profile: "B" });
  });

  test("trims name and profile", () => {
    const result = parseResumeResponse(
      '{"name": "  A  ", "profile": "  B  "}',
    );
    expect(result).toEqual({ name: "A", profile: "B" });
  });

  test("accepts a missing name as empty string", () => {
    const result = parseResumeResponse('{"name": "", "profile": "B"}');
    expect(result.name).toBe("");
  });

  test("throws ProviderError(parse) on non-JSON", () => {
    expect(() => parseResumeResponse("not json")).toThrow(ProviderError);
  });

  test("throws ProviderError(parse) on empty profile", () => {
    expect(() => parseResumeResponse('{"name": "A", "profile": "  "}')).toThrow(
      ProviderError,
    );
  });

  test("throws ProviderError(parse) on missing fields", () => {
    expect(() => parseResumeResponse('{"name": "A"}')).toThrow(ProviderError);
  });
});

describe("RESUME_SYSTEM_PROMPT invariants", () => {
  // The anonymization contract lives in the prompt — pin its load-bearing
  // parts so a prompt edit that drops a rule fails loudly.
  test("demands the structured German sections", () => {
    for (const section of [
      "Kurzprofil",
      "Skills",
      "Berufserfahrung",
      "Ausbildung",
      "Sprachen",
    ]) {
      expect(RESUME_SYSTEM_PROMPT).toContain(section);
    }
  });

  test("forbids the protected attributes in the profile text", () => {
    for (const term of [
      "name",
      "address",
      "birth",
      "gender",
      "nationality",
      "religion",
      "company names",
    ]) {
      expect(RESUME_SYSTEM_PROMPT.toLowerCase()).toContain(term);
    }
  });

  test("demands JSON-only output with name and profile keys", () => {
    expect(RESUME_SYSTEM_PROMPT).toContain('"name"');
    expect(RESUME_SYSTEM_PROMPT).toContain('"profile"');
  });
});
```

- [ ] **Step 2: Tests laufen lassen — sie müssen fehlschlagen**

Run: `bun test lib/resume`
Expected: FAIL — `Cannot find module './parse'` (o. ä.).

- [ ] **Step 3: `lib/resume/parse.ts` implementieren**

```ts
import {
  completeJson,
  type ChatConfig,
} from "@/lib/providers/complete";
import { ProviderError } from "@/lib/providers/http";

export type ParsedResume = {
  name: string;
  profile: string;
};

// Anonymization contract for uploaded resumes. Mirrors the judge prompt's
// protected attributes (lib/reranking/client.ts) — the profile text feeds
// the embedding, the tsvector AND the judge, so nothing identifying may
// survive this step. The name goes into the separate name field only,
// which composeCandidateText already excludes from the embedding.
export const RESUME_SYSTEM_PROMPT = [
  "You turn raw resume/CV text into an anonymized, structured candidate profile for a recruiting matching system.",
  "Respond with ONLY a JSON object, no other text:",
  '{"name": "<full name of the candidate, empty string if not found>", "profile": "<anonymized structured profile text in German>"}',
  "The profile text MUST be written in German, regardless of the resume language.",
  "Structure the profile text with exactly these sections, each heading on its own line, in this order; omit a section entirely if the resume has no content for it:",
  "Kurzprofil: 2-3 sentences summarizing seniority, field and focus.",
  "Skills: comma-separated concrete skills, tools and technologies, taken verbatim from the resume.",
  "Berufserfahrung: one line per role — role title, industry and duration (e.g. 'Backend-Entwickler, E-Commerce, 3 Jahre').",
  "Ausbildung: degrees and certifications.",
  "Sprachen: languages with proficiency level.",
  "Anonymization is mandatory. The profile text MUST NOT contain: the candidate's name or initials, postal address, e-mail address, phone number, links or usernames, birth date or age, gender, marital or family status, nationality or origin, religion, photos or references to them, company names, names of schools or universities.",
  "The name field is the ONLY place for the candidate's name.",
  "Never invent information — every skill, role and duration must come from the resume text.",
].join("\n");

const RESUME_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    profile: { type: "string" },
  },
  required: ["name", "profile"],
} as const;

// Guards against megabyte-scale extracted text blowing the LLM context;
// 20k chars ≈ 8-10 resume pages, more than any sane CV.
const MAX_RESUME_CHARS = 20_000;

export function parseResumeResponse(raw: string): ParsedResume {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new ProviderError(
      "parse",
      `Model did not return valid JSON: ${cleaned.slice(0, 120)}…`,
    );
  }
  const obj = parsed as { name?: unknown; profile?: unknown };
  if (
    typeof obj.name !== "string" ||
    typeof obj.profile !== "string" ||
    obj.profile.trim() === ""
  ) {
    throw new ProviderError(
      "parse",
      `Resume JSON missing name/profile: ${cleaned.slice(0, 120)}`,
    );
  }
  return { name: obj.name.trim(), profile: obj.profile.trim() };
}

export async function parseResumeText(
  raw: string,
  cfg: ChatConfig,
): Promise<ParsedResume> {
  const text = raw.trim().slice(0, MAX_RESUME_CHARS);
  if (text === "") {
    throw new ProviderError("parse", "Empty resume text");
  }
  const response = await completeJson(
    cfg,
    RESUME_SYSTEM_PROMPT,
    `RESUME TEXT:\n${text}`,
    RESUME_SCHEMA,
    2000,
  );
  return parseResumeResponse(response);
}
```

- [ ] **Step 4: Tests laufen lassen — grün**

Run: `bun test lib/resume`
Expected: PASS (alle Tests).

- [ ] **Step 5: Typecheck + Lint**

Run: `bunx tsc --noEmit && bun run lint`
Expected: keine Fehler.

- [ ] **Step 6: Commit-Message ausgeben (NICHT committen)**

Vorschlag: `feat: resume parser — anonymizing structured extraction via rerank LLM config`

---

### Task 3: Server Action `parseResume` + Body-Limit + `unpdf`

**Files:**
- Modify: `app/actions.ts` (neue Action ans Dateiende, neue Imports oben)
- Modify: `next.config.ts`
- Modify: `package.json` (via `bun add unpdf`)

**Interfaces:**
- Consumes: `parseResumeText` aus `lib/resume/parse.ts` (Task 2); `getValidatedRerankSettings` aus `lib/settings.ts`; `isAuthenticated` aus `lib/auth.ts`; `ProviderError`, `ProviderErrorKind` aus `lib/providers/http.ts`; `extractText`/`getDocumentProxy` aus `unpdf` (dynamischer Import).
- Produces: `parseResume(_prev: ParseResumeState, formData: FormData): Promise<ParseResumeState>` mit
  `type ParseResumeState = { status: "parsed"; name: string; profile: string } | { status: "error"; kind: "validation" | "unauthorized" | "notConfigured" | "emptyFile" | ProviderErrorKind; detail?: string } | undefined`.
  Task 4 (UI) konsumiert exakt diese Zustände. Formular-Feldname der Datei: `resume`.

- [ ] **Step 1: Dependency installieren**

Run: `bun add unpdf`
Expected: `unpdf` erscheint unter `dependencies` in `package.json`.

- [ ] **Step 2: Body-Limit in `next.config.ts` anheben**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server build for the Docker image.
  output: "standalone",
  experimental: {
    serverActions: {
      // Resume upload: 5 MB file cap + multipart framing overhead.
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
```

- [ ] **Step 3: Action in `app/actions.ts` ergänzen**

Imports oben ergänzen:

```ts
import { ProviderError, type ProviderErrorKind } from "@/lib/providers/http";
import { parseResumeText } from "@/lib/resume/parse";
```

Ans Dateiende:

```ts
export type ParseResumeState =
  | { status: "parsed"; name: string; profile: string }
  | {
      status: "error";
      kind:
        | "validation"
        | "unauthorized"
        | "notConfigured"
        | "emptyFile"
        | ProviderErrorKind;
      detail?: string;
    }
  | undefined;

const RESUME_MAX_BYTES = 5 * 1024 * 1024;

// Phase one of the two-phase upload flow: extract + anonymize into the
// form for human review. Nothing is persisted here — createCandidate
// stays the only write path. The raw resume text never reaches the
// client: only the LLM's anonymized result is returned.
export async function parseResume(
  _prev: ParseResumeState,
  formData: FormData,
): Promise<ParseResumeState> {
  if (!(await isAuthenticated())) {
    return { status: "error", kind: "unauthorized" };
  }
  const file = formData.get("resume");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", kind: "validation" };
  }
  if (file.size > RESUME_MAX_BYTES) {
    return { status: "error", kind: "validation" };
  }
  const lower = file.name.toLowerCase();
  let text: string;
  try {
    if (lower.endsWith(".pdf")) {
      // Dynamic import: unpdf only loads for actual PDF uploads, not on
      // every actions.ts evaluation.
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(
        new Uint8Array(await file.arrayBuffer()),
      );
      ({ text } = await extractText(pdf, { mergePages: true }));
    } else if (lower.endsWith(".txt") || lower.endsWith(".md")) {
      text = await file.text();
    } else {
      return { status: "error", kind: "validation" };
    }
  } catch (e) {
    return {
      status: "error",
      kind: "emptyFile",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
  if (text.trim() === "") {
    return { status: "error", kind: "emptyFile" };
  }
  let cfg: RerankConfig;
  try {
    cfg = await getValidatedRerankSettings();
  } catch (e) {
    return {
      status: "error",
      kind: "notConfigured",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
  try {
    const parsed = await parseResumeText(text, cfg);
    return { status: "parsed", ...parsed };
  } catch (e) {
    if (e instanceof ProviderError) {
      return { status: "error", kind: e.kind, detail: e.message };
    }
    return { status: "error", kind: "api", detail: String(e) };
  }
}
```

Hinweis: `getValidatedRerankSettings` liefert einen `RerankConfig` inklusive Judge-`systemPrompt`-Override — der stört nicht, weil `parseResumeText` seinen eigenen System-Prompt explizit an `completeJson` übergibt.

- [ ] **Step 4: Typecheck + Lint + bestehende Tests**

Run: `bunx tsc --noEmit && bun run lint && bun test lib/resume`
Expected: alles grün.

- [ ] **Step 5: Commit-Message ausgeben (NICHT committen)**

Vorschlag: `feat: parseResume server action — pdf/txt/md upload to anonymized profile`

---

### Task 4: Upload-UI in `NewCandidateForm` + Dictionary

**Files:**
- Modify: `app/components/create-forms.tsx` (nur `NewCandidateForm` und Imports; `NewJobForm` und `CreateFeedback` bleiben unverändert)
- Modify: `app/candidates/page.tsx`
- Modify: `lib/i18n/dictionaries.ts` (neue Sektion `upload` in `de` UND `en`)

**Interfaces:**
- Consumes: `parseResume`, `ParseResumeState` aus `app/actions.ts` (Task 3); `isRerankConfigured` aus `lib/settings.ts`.
- Produces: `NewCandidateForm({ t, tc, tu, uploadEnabled })` — neue Props `tu: Dictionary["upload"]`, `uploadEnabled: boolean`.

- [ ] **Step 1: Dictionary-Sektion `upload` ergänzen**

In `lib/i18n/dictionaries.ts` im `de`-Objekt nach der `forms`-Sektion:

```ts
upload: {
  heading: "Lebenslauf hochladen",
  hint: "PDF, TXT oder MD, max. 5 MB — der Text wird extrahiert, anonymisiert und strukturiert und landet zur Prüfung im Formular.",
  button: "Extrahieren & anonymisieren",
  parsing: "Analysiere …",
  parsed: "Anonymisiertes Profil übernommen — bitte prüfen, dann anlegen.",
  notConfigured: "Kein Judge-LLM konfiguriert — unter Einstellungen → KI-Bewertung einrichten.",
  emptyFile: "Aus der Datei ließ sich kein Text extrahieren (gescanntes PDF?).",
  invalidFile: "Bitte eine PDF-, TXT- oder MD-Datei bis 5 MB wählen.",
  failed: "Analyse fehlgeschlagen:",
},
```

Im `en`-Objekt an gleicher Stelle:

```ts
upload: {
  heading: "Upload resume",
  hint: "PDF, TXT or MD, max. 5 MB — the text is extracted, anonymized and structured, then placed in the form for review.",
  button: "Extract & anonymize",
  parsing: "Analyzing …",
  parsed: "Anonymized profile filled in — review it, then create.",
  notConfigured: "No judge LLM configured — set it up under Settings → AI evaluation.",
  emptyFile: "No text could be extracted from the file (scanned PDF?).",
  invalidFile: "Please choose a PDF, TXT or MD file up to 5 MB.",
  failed: "Analysis failed:",
},
```

(`Dictionary` ist als `typeof de` abgeleitet — `en` bekommt durch die Typannotation `const en: Dictionary` automatisch einen Fehler, wenn Keys fehlen. Prüfen, ob das Muster in der Datei so ist, und dem folgen.)

- [ ] **Step 2: `NewCandidateForm` umbauen**

`app/components/create-forms.tsx` — Imports erweitern und `NewCandidateForm` ersetzen (Rest der Datei unverändert):

```tsx
"use client";

import { useActionState, useEffect, useState } from "react";
import {
  createCandidate,
  createJob,
  parseResume,
  type CreateState,
  type ParseResumeState,
} from "@/app/actions";
import type { Dictionary } from "@/lib/i18n";
```

```tsx
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
  useEffect(() => {
    if (parseState?.status === "parsed") {
      setName(parseState.name);
      setProfile(parseState.profile);
    }
  }, [parseState]);
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
```

Wichtig: zwei **geschwisterliche** `<form>`-Elemente (verschachtelte Forms sind invalides HTML). Die Felder `name`/`profile` sind jetzt kontrolliert; das Create-Formular funktioniert unverändert über `formData`.

- [ ] **Step 3: `app/candidates/page.tsx` — Props durchreichen**

Import ergänzen: `import { isRerankConfigured } from "@/lib/settings";`
Im Component-Body nach `const t = dict.candidates;`:

```ts
const uploadEnabled = await isRerankConfigured();
```

Aufruf ändern zu:

```tsx
<NewCandidateForm
  t={dict.forms}
  tc={t}
  tu={dict.upload}
  uploadEnabled={uploadEnabled}
/>
```

- [ ] **Step 4: Typecheck + Lint**

Run: `bunx tsc --noEmit && bun run lint`
Expected: keine Fehler (insbesondere: `en`-Dictionary vollständig).

- [ ] **Step 5: Manuelle Sichtprüfung**

Run: `bun run dev` (startet auch die DB via docker compose), dann `http://localhost:3000/candidates` öffnen (Login mit `APP_PASSWORD` aus `.env`).
Expected: Upload-Zone über dem Formular; ohne validierte Rerank-Config ist sie deaktiviert und zeigt den `notConfigured`-Hinweis. Mit Config: eine `.txt`-Datei mit Lebenslauf-Text hochladen → Felder füllen sich mit anonymisiertem Profil (kein Name, keine Kontaktdaten im Profiltext, Name im Namensfeld) → „Anlegen" speichert und embedded wie bisher.

- [ ] **Step 6: Commit-Message ausgeben (NICHT committen)**

Vorschlag: `feat: resume upload zone with anonymized preview in NewCandidateForm`

---

### Task 5: Interview-Generator `lib/resume/interview.ts` (TDD)

**Files:**
- Create: `lib/resume/interview.ts`
- Test: `lib/resume/interview.test.ts`

**Interfaces:**
- Consumes: `completeJson`, `ChatConfig` aus `lib/providers/complete.ts`; `ProviderError` aus `lib/providers/http.ts`.
- Produces: `type InterviewGuide = { technical: string[]; experience: string[]; gaps: string[] }`, `parseInterviewResponse(raw: string): InterviewGuide`, `generateInterviewGuide(jobText: string, profileText: string, missingRequirements: string[], cfg: ChatConfig): Promise<InterviewGuide>`, `INTERVIEW_SYSTEM_PROMPT: string`. Task 6 konsumiert `generateInterviewGuide` und `InterviewGuide`.

- [ ] **Step 1: Failing Tests schreiben (`lib/resume/interview.test.ts`)**

```ts
import { describe, expect, test } from "bun:test";
import { ProviderError } from "@/lib/providers/http";
import {
  INTERVIEW_SYSTEM_PROMPT,
  parseInterviewResponse,
} from "./interview";

describe("parseInterviewResponse", () => {
  test("parses grouped questions", () => {
    const result = parseInterviewResponse(
      '{"technical": ["T1?"], "experience": ["E1?", "E2?"], "gaps": ["G1?"]}',
    );
    expect(result).toEqual({
      technical: ["T1?"],
      experience: ["E1?", "E2?"],
      gaps: ["G1?"],
    });
  });

  test("strips code fences and filters non-strings", () => {
    const result = parseInterviewResponse(
      '```json\n{"technical": ["T1?", 5], "experience": [], "gaps": []}\n```',
    );
    expect(result.technical).toEqual(["T1?"]);
  });

  test("accepts empty gaps group", () => {
    const result = parseInterviewResponse(
      '{"technical": ["T?"], "experience": ["E?"], "gaps": []}',
    );
    expect(result.gaps).toEqual([]);
  });

  test("throws ProviderError(parse) on non-JSON", () => {
    expect(() => parseInterviewResponse("nope")).toThrow(ProviderError);
  });

  test("throws ProviderError(parse) when every group is empty", () => {
    expect(() =>
      parseInterviewResponse('{"technical": [], "experience": [], "gaps": []}'),
    ).toThrow(ProviderError);
  });

  test("throws ProviderError(parse) on missing groups", () => {
    expect(() => parseInterviewResponse('{"technical": ["T?"]}')).toThrow(
      ProviderError,
    );
  });
});

describe("INTERVIEW_SYSTEM_PROMPT invariants", () => {
  test("stays name-blind", () => {
    expect(INTERVIEW_SYSTEM_PROMPT.toLowerCase()).toContain("das profil");
  });
  test("targets the missing requirements", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("MISSING REQUIREMENTS");
  });
  test("demands JSON-only grouped output", () => {
    for (const key of ['"technical"', '"experience"', '"gaps"']) {
      expect(INTERVIEW_SYSTEM_PROMPT).toContain(key);
    }
  });
});
```

- [ ] **Step 2: Tests laufen lassen — sie müssen fehlschlagen**

Run: `bun test lib/resume/interview.test.ts`
Expected: FAIL — Modul nicht gefunden.

- [ ] **Step 3: `lib/resume/interview.ts` implementieren**

```ts
import {
  completeJson,
  type ChatConfig,
} from "@/lib/providers/complete";
import { ProviderError } from "@/lib/providers/http";

export type InterviewGuide = {
  technical: string[];
  experience: string[];
  gaps: string[];
};

// Interview guide generator: turns job + anonymized profile + the judge's
// missing requirements into targeted questions. Name-blind like the judge
// — it only ever sees the anonymized profile text.
export const INTERVIEW_SYSTEM_PROMPT = [
  "You prepare a recruiter for an interview: from a job posting, an anonymized candidate profile and a list of requirements the profile does not cover, you generate targeted interview questions.",
  "Respond with ONLY a JSON object, no other text:",
  '{"technical": ["<question>", ...], "experience": ["<question>", ...], "gaps": ["<question>", ...]}',
  "Write the questions in the language of the job posting.",
  "technical: 2-3 questions probing the depth of the profile's core skills that matter most for this job.",
  "experience: 2 questions about concrete past work relevant to the job's responsibilities.",
  "gaps: one question per entry in MISSING REQUIREMENTS, each verifying whether the gap is real or just unstated in the profile. If MISSING REQUIREMENTS is empty, return an empty gaps array.",
  "5-7 questions in total across all groups. Every question must reference concrete skills, tools or responsibilities from the texts — no generic questions like 'What are your strengths?'.",
  "Refer to the person neutrally as 'das Profil' / 'the profile' — never assume or invent a name or gender.",
].join("\n");

const INTERVIEW_SCHEMA = {
  type: "object",
  properties: {
    technical: { type: "array", items: { type: "string" } },
    experience: { type: "array", items: { type: "string" } },
    gaps: { type: "array", items: { type: "string" } },
  },
  required: ["technical", "experience", "gaps"],
} as const;

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((q): q is string => typeof q === "string");
}

export function parseInterviewResponse(raw: string): InterviewGuide {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new ProviderError(
      "parse",
      `Model did not return valid JSON: ${cleaned.slice(0, 120)}…`,
    );
  }
  const obj = parsed as {
    technical?: unknown;
    experience?: unknown;
    gaps?: unknown;
  };
  const technical = stringArray(obj.technical);
  const experience = stringArray(obj.experience);
  const gaps = stringArray(obj.gaps);
  if (technical === null || experience === null || gaps === null) {
    throw new ProviderError(
      "parse",
      `Interview JSON missing question groups: ${cleaned.slice(0, 120)}`,
    );
  }
  if (technical.length + experience.length + gaps.length === 0) {
    throw new ProviderError("parse", "Interview guide came back empty");
  }
  return { technical, experience, gaps };
}

export async function generateInterviewGuide(
  jobText: string,
  profileText: string,
  missingRequirements: string[],
  cfg: ChatConfig,
): Promise<InterviewGuide> {
  const prompt = [
    `JOB POSTING:\n${jobText}`,
    `CANDIDATE PROFILE (anonymized):\n${profileText}`,
    `MISSING REQUIREMENTS (from the fit evaluation):\n${
      missingRequirements.length > 0
        ? missingRequirements.map((m) => `- ${m}`).join("\n")
        : "(none)"
    }`,
  ].join("\n\n");
  const response = await completeJson(
    cfg,
    INTERVIEW_SYSTEM_PROMPT,
    prompt,
    INTERVIEW_SCHEMA,
    1000,
  );
  return parseInterviewResponse(response);
}
```

- [ ] **Step 4: Tests laufen lassen — grün**

Run: `bun test lib/resume`
Expected: PASS (parse- und interview-Tests).

- [ ] **Step 5: Typecheck + Lint**

Run: `bunx tsc --noEmit && bun run lint`
Expected: keine Fehler.

- [ ] **Step 6: Commit-Message ausgeben (NICHT committen)**

Vorschlag: `feat: interview guide generator targeting judged gaps`

---

### Task 6: Action `generateInterviewQuestions` + Button im Matching-Ergebnis

**Files:**
- Modify: `app/actions.ts`
- Modify: `app/components/rerank-stream-list.tsx`
- Modify: `app/matching/page.tsx` (Aufruf `RerankStreamList` in `RerankedSection`, ca. Zeile 154–165)
- Modify: `lib/i18n/dictionaries.ts` (Keys in der `matching`-Sektion, de UND en)

**Interfaces:**
- Consumes: `generateInterviewGuide`, `InterviewGuide` aus `lib/resume/interview.ts` (Task 5); `candidates` aus `db/schema.ts`; `getDb` aus `lib/db.ts`; `getValidatedRerankSettings` aus `lib/settings.ts`.
- Produces: Action `generateInterviewQuestions(_prev: InterviewState, formData: FormData): Promise<InterviewState>` mit
  `type InterviewState = { status: "generated"; guide: InterviewGuide } | { status: "error"; kind: "validation" | "unauthorized" | "notConfigured" | ProviderErrorKind; detail?: string } | undefined`.
  FormData-Felder: `candidateId` (uuid), `jobText` (string), `missing` (JSON-Array-String). `RerankStreamList` bekommt die neue Prop `jobText: string`.

- [ ] **Step 1: Action in `app/actions.ts` ergänzen**

Imports ergänzen:

```ts
import { eq } from "drizzle-orm";
import {
  generateInterviewGuide,
  type InterviewGuide,
} from "@/lib/resume/interview";
```

(`candidates`, `getDb`, `getValidatedRerankSettings` sind bereits importiert.)

Ans Dateiende:

```ts
export type InterviewState =
  | { status: "generated"; guide: InterviewGuide }
  | {
      status: "error";
      kind: "validation" | "unauthorized" | "notConfigured" | ProviderErrorKind;
      detail?: string;
    }
  | undefined;

// On-demand interview guide for one judged match. The client sends the
// job text and the verdict's missing requirements (display data it
// already holds); the profile is re-read from the DB by id, so the
// prompt only ever contains the stored anonymized profile — name-blind
// like the judge.
export async function generateInterviewQuestions(
  _prev: InterviewState,
  formData: FormData,
): Promise<InterviewState> {
  if (!(await isAuthenticated())) {
    return { status: "error", kind: "unauthorized" };
  }
  const candidateId = formData.get("candidateId");
  const jobText = formData.get("jobText");
  const missingRaw = formData.get("missing");
  if (
    typeof candidateId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(candidateId) ||
    typeof jobText !== "string" ||
    jobText.trim() === ""
  ) {
    return { status: "error", kind: "validation" };
  }
  let missing: string[] = [];
  if (typeof missingRaw === "string" && missingRaw !== "") {
    try {
      const parsed: unknown = JSON.parse(missingRaw);
      if (Array.isArray(parsed)) {
        missing = parsed.filter((m): m is string => typeof m === "string");
      }
    } catch {
      // Malformed display data — proceed without gap targeting.
    }
  }
  const [candidate] = await getDb()
    .select({ profile: candidates.profile })
    .from(candidates)
    .where(eq(candidates.id, candidateId));
  if (!candidate) {
    return { status: "error", kind: "validation" };
  }
  let cfg: RerankConfig;
  try {
    cfg = await getValidatedRerankSettings();
  } catch (e) {
    return {
      status: "error",
      kind: "notConfigured",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
  try {
    const guide = await generateInterviewGuide(
      jobText.trim(),
      candidate.profile,
      missing,
      cfg,
    );
    return { status: "generated", guide };
  } catch (e) {
    if (e instanceof ProviderError) {
      return { status: "error", kind: e.kind, detail: e.message };
    }
    return { status: "error", kind: "api", detail: String(e) };
  }
}
```

- [ ] **Step 2: Dictionary-Keys ergänzen**

In `lib/i18n/dictionaries.ts`, `de.matching` am Ende der Sektion:

```ts
interviewButton: "Interviewleitfaden",
interviewGenerating: "Erstelle Leitfaden …",
interviewTechnical: "Fachlich",
interviewExperience: "Erfahrung",
interviewGaps: "Lücken prüfen",
interviewFailed: "Leitfaden fehlgeschlagen:",
```

`en.matching` spiegelbildlich:

```ts
interviewButton: "Interview guide",
interviewGenerating: "Generating guide …",
interviewTechnical: "Technical",
interviewExperience: "Experience",
interviewGaps: "Probe the gaps",
interviewFailed: "Guide failed:",
```

- [ ] **Step 3: `RerankStreamList` erweitern**

`app/components/rerank-stream-list.tsx`:

Imports ergänzen: `useActionState` aus react; `generateInterviewQuestions, type InterviewState` aus `@/app/actions`.

`RerankStreamList` bekommt die Prop `jobText: string` und reicht sie an `RowVerdictBody` → `VerdictBody` durch (Props-Signaturen entsprechend um `jobText: string` und `candidateId: string` erweitern; `candidateId` ist `rows[rowIndex].id`).

Am Ende von `VerdictBody` (nach dem `missingRequirements`-Absatz) einfügen:

```tsx
<InterviewSection
  t={t}
  candidateId={candidateId}
  jobText={jobText}
  missing={verdict.missingRequirements}
/>
```

Neue Komponente in derselben Datei:

```tsx
function InterviewSection({
  t,
  candidateId,
  jobText,
  missing,
}: {
  t: MatchingDict;
  candidateId: string;
  jobText: string;
  missing: string[];
}) {
  const [state, action, pending] = useActionState(
    generateInterviewQuestions,
    undefined,
  );
  if (state?.status === "generated") {
    const groups = [
      { label: t.interviewTechnical, questions: state.guide.technical },
      { label: t.interviewExperience, questions: state.guide.experience },
      { label: t.interviewGaps, questions: state.guide.gaps },
    ].filter((group) => group.questions.length > 0);
    return (
      <div className="mt-3 rounded-md border border-border bg-background p-3">
        {groups.map((group) => (
          <div key={group.label} className="mb-2 last:mb-0">
            <p className="text-[11px] font-medium uppercase tracking-wider">
              {group.label}
            </p>
            <ul className="mt-1 list-disc pl-4">
              {group.questions.map((question) => (
                <li key={question} className="mt-0.5">
                  {question}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }
  return (
    <form action={action} className="mt-2">
      <input type="hidden" name="candidateId" value={candidateId} />
      <input type="hidden" name="jobText" value={jobText} />
      <input type="hidden" name="missing" value={JSON.stringify(missing)} />
      {state?.status === "error" && (
        <p className="mb-1 text-danger" role="alert">
          {t.interviewFailed} {state.detail ?? state.kind}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border px-2 py-1 text-[11px] font-medium transition-opacity disabled:opacity-50"
      >
        {pending ? t.interviewGenerating : t.interviewButton}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: `app/matching/page.tsx` — `jobText` durchreichen**

In `RerankedSection` den `RerankStreamList`-Aufruf erweitern:

```tsx
<RerankStreamList
  t={t}
  jobText={queryText}
  rows={items.map((item) => ({
    id: item.match.id,
    name: item.match.name,
    similarity: item.match.similarity,
    vectorRank: item.vectorRank,
  }))}
  judgments={items.map((item) => item.judgment)}
/>
```

- [ ] **Step 5: Typecheck + Lint + Tests**

Run: `bunx tsc --noEmit && bun run lint && bun test lib/resume`
Expected: alles grün.

- [ ] **Step 6: Manuelle Sichtprüfung**

Run: `bun run dev`, `/matching` öffnen, Job wählen, „Liste bewerten" (rr=1).
Expected: Unter jedem eingetroffenen Verdikt erscheint der Button „Interviewleitfaden"; Klick zeigt nach kurzer Wartezeit gruppierte Fragen; bei Kandidaten mit `missingRequirements` zielt die Gruppe „Lücken prüfen" erkennbar auf genau diese Punkte. (Hinweis: Server Actions dispatchen pro Client sequenziell — zwei gleichzeitige Leitfaden-Klicks laufen nacheinander, das ist erwartetes Verhalten.)

- [ ] **Step 7: Commit-Message ausgeben (NICHT committen)**

Vorschlag: `feat: per-candidate interview guide button in reranked matching results`

---

### Task 7: End-to-End-Verifikation

**Files:**
- Keine Änderungen — reine Verifikation. Testfixture im Scratchpad anlegen, NICHT im Repo.

**Interfaces:**
- Consumes: alles aus Tasks 1–6.
- Produces: verifizierter Demo-Flow.

- [ ] **Step 1: Statische Checks komplett**

Run: `bunx tsc --noEmit && bun run lint && bun test lib/resume`
Expected: alles grün.

- [ ] **Step 2: Testfixture anlegen**

Eine Datei `lebenslauf-demo.txt` im Scratchpad (NICHT im Repo) mit einem fiktiven, PII-haltigen Lebenslauf, z. B.:

```
Max Mustermann
Musterstraße 12, 50667 Köln — max.mustermann@web.de — 0171 2345678
Geboren am 3.4.1991, verheiratet, deutsch

Berufserfahrung
2019–heute: Senior Backend-Entwickler, ShopRocket GmbH, Köln
  Node.js, TypeScript, PostgreSQL, Kubernetes; Team von 4 geführt
2015–2019: Softwareentwickler, DataWerk AG, Bonn
  Python, Django, Redis

Ausbildung
B.Sc. Informatik, Universität Bonn, 2015
Zertifikat: AWS Solutions Architect Associate

Sprachen: Deutsch (Muttersprache), Englisch (C1)
```

- [ ] **Step 3: Demo-Flow durchspielen**

Run: `bun run dev`; einloggen; unter `/settings` sicherstellen, dass Embedding- und Rerank-Config validiert sind (grüner Status).
Dann: `/candidates` → Fixture hochladen → prüfen:
1. Namensfeld = „Max Mustermann"; Profiltext enthält **weder** Namen, Adresse, E-Mail, Telefonnummer, Geburtsdatum, Familienstand, Nationalität **noch** Firmen-/Uni-Namen.
2. Profiltext hat die Sektionen Kurzprofil/Skills/Berufserfahrung/Ausbildung/Sprachen.
3. „Anlegen" → Erfolg „Angelegt und embedded"; Kandidat erscheint in der Liste mit grünem Punkt.
4. `/matching` → passenden Job wählen → Kandidat taucht im Ranking auf → „Liste bewerten" → Verdikt streamt → „Interviewleitfaden" → gruppierte, konkrete Fragen; Lücken-Fragen matchen die `missingRequirements`.
5. Fehlerpfad: eine leere `.txt` hochladen → Meldung `emptyFile`, Formularfelder bleiben leer/unverändert.

- [ ] **Step 4: Abschlussbericht an den Nutzer**

Ergebnis der Verifikation zusammenfassen (was geprüft wurde, was funktioniert, was offen ist) und die gesammelten Commit-Message-Vorschläge der Tasks 1–6 auflisten — der Nutzer committet selbst.
