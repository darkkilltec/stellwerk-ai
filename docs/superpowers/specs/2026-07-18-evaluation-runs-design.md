# Design: Bewertungsläufe — alle Kandidaten im Hintergrund bewerten

Datum: 2026-07-18
Status: Entwurf (im Chat freigegeben, schriftliche Review ausstehend)

## Ziel

HR kann für einen ausgewählten Job oder einen Freitext-Query einen
Hintergrund-Lauf starten, der ALLE Kandidaten (~600 in der Demo) per LLM
bewertet — nicht nur die Top-10 aus dem Vektor-Retrieval. Läufe sind
adressierbar, überleben Seitenwechsel und Server-Neustarts, und ihre
Ergebnisse bleiben dauerhaft erhalten (auch wenn sich später Prompt,
Modell oder Kandidatenprofile ändern).

Erfolgskriterium Demo: Lauf über die Kandidaten-DB starten, Seite
schließen, später zurückkommen → Fortschritt/fertige Rangliste mit
Begründungen und Interview-Button; ein Wiederholungslauf ist dank Cache
in Sekunden fertig.

## Entscheidungen (aus dem Brainstorming)

- ~600 Kandidaten, Demo-Kontext. Zeitgesteuerte (tägliche/wöchentliche)
  Läufe sind explizit OUT OF SCOPE.
- UI: eigener Bereich mit Historie (Navigation „Bewertungsläufe", Liste
  + Detailseite), Start-Button auf der Matching-Seite.
- Architektur: **DB-Queue + In-Process-Worker** (Variante A). Kein
  separater Worker-Prozess, keine Streaming-Route.
- `evaluation_items` sind Verdikt-KOPIEN (Archiv), `rerank_cache` bleibt
  der invalidierbare Arbeitsspeicher.

## 1. Datenmodell (db/schema.ts, neue Migration)

`evaluation_runs`:
- `id` uuid PK
- `jobId` uuid nullable (FK jobs, set null bei Job-Löschung) — null bei Freitext
- `queryText` text notNull — Snapshot des bewerteten Jobtexts
- `model` text notNull, `promptHash` text notNull — womit bewertet wurde
- `status` text notNull: `running` | `done` | `cancelled` | `failed`
- `total` integer notNull
- `createdAt`, `finishedAt` timestamptz

`evaluation_items`:
- `id` uuid PK
- `runId` uuid FK evaluation_runs, cascade delete
- `candidateId` uuid (FK candidates, set null bei Löschung)
- `candidateName` text notNull — Snapshot, Lauf bleibt ohne Kandidat lesbar
- `status` text notNull: `pending` | `done` | `error`
- `score` real nullable, `reasoning` text nullable,
  `missingRequirements` jsonb string[] default []
- `error` text nullable
- `judgedAt` timestamptz nullable
- Unique-Index (`runId`, `candidateId`); Index auf (`runId`, `status`).

## 2. Worker (lib/evaluation/worker.ts)

- `startEvaluationWorker(runId)`: fire-and-forget async Loop im
  Next-Prozess. Ein modulweites In-Process-Set (`activeRuns`) verhindert
  doppelte Worker für denselben Run.
- Ablauf pro Iteration: Batch Pending-Items laden (Reihenfolge:
  candidateName asc) → pro Item Cache-Lookup in `rerank_cache`
  (jobHash/profileHash/model/promptHash wie in lib/matching.ts) →
  Hit: Verdikt kopieren ohne LLM-Call; Miss: `judgeFit` + Cache-Write
  (gleiche Semantik wie judgeRetrievedStreamed) → Item auf `done`
  (score/reasoning/missing/judgedAt) bzw. `error` (Fehlertext; bei
  parse-Kind OHNE Detail — gleiche PII-Regel wie beim Resume-Upload).
- Concurrency wie `judgeFitMany`: ollama 1, sonst 3.
- Nach jedem Batch: Run-Status prüfen — `cancelled` → sofort stoppen.
- Keine Pending-Items mehr → Run `done` + `finishedAt` (Item-Fehler
  brechen den Lauf NICHT ab; die Fehlerzahl zeigt das UI). Wirft der
  Worker selbst unerwartet (z. B. DB weg) → Run `failed` mit letztem
  Fehler im Log; Items bleiben, „Fortsetzen" möglich.
- Ein Kandidatenprofil wird beim Anlegen der Items NICHT kopiert; der
  Worker lädt das Profil beim Bewerten. Kandidat zwischenzeitlich
  gelöscht → Item `error` „Kandidat gelöscht".

## 3. Resume / Crash-Sicherheit

- Prozess stirbt → Run bleibt `running` mit Pending-Items in der DB.
- Boot-Hook: instrumentation.ts (nach runMigrations) lädt alle Runs mit
  `status = running`, die noch Pending-Items haben, und startet ihre
  Worker neu. Runs mit `running` OHNE Pending-Items werden zu `done`
  aufgeräumt.
- Manueller Fallback: „Fortsetzen"-Button auf der Run-Seite (Action ruft
  startEvaluationWorker erneut; idempotent durch activeRuns-Set).

## 4. Server Actions (app/actions.ts)

- `startEvaluationRun(prev, formData)`: Auth → Query bestimmen (jobId
  ODER Freitext, wie Matching-Page) → Rerank-Config validieren
  (`notConfigured`-Fehler wie gehabt) → Run + ein Pending-Item pro
  Kandidat anlegen (ein Insert-Select) → Worker anstoßen →
  `redirect('/runs/<id>')`.
- `cancelEvaluationRun(runId)`: Auth → Status `cancelled` (nur wenn
  `running`), revalidate.
- `resumeEvaluationRun(runId)`: Auth → wenn Status `running` ODER
  `failed` und Pending-Items existieren: Status auf `running` setzen und
  Worker anstoßen (idempotent durch activeRuns-Set).
- Vorab-Kosteninfo: die Startfläche zeigt „N Kandidaten, davon ~k schon
  im Cache" (SQL: Join der Profil-Hashes gegen rerank_cache mit
  jobHash/model/promptHash des aktuellen Prompts).

## 5. UI

- Navigation: neuer Punkt „Bewertungsläufe" (`/runs`), de/en.
- `/runs`: Tabelle/Liste — Jobtitel bzw. Query-Auszug, Datum, Status-
  Badge, Fortschritt `done+error/total`, Fehlerzahl. Leerer Zustand mit
  Hinweis auf die Matching-Seite.
- `/runs/[id]`: Kopf (Query, Modell, Status, Fortschrittsbalken,
  Abbrechen-/Fortsetzen-Button), darunter Rangliste aller `done`-Items
  sortiert nach Score desc: gleiche Optik wie Matching (Score-Tiers,
  Reasoning, „Fehlend"-Zeile, Link zur Kandidaten-Detailseite) und der
  in Task 6 gebaute Interview-Button (`InterviewSection` mit `jobText`
  = `run.queryText`, `missing` aus dem Item). `error`-Items als eigene
  Sektion mit Fehlertext.
- Polling: kleine Client-Komponente — solange Status `running`:
  `setInterval` (~3s) → `router.refresh()`; stoppt bei Endstatus.
- Matching-Seite: Button „Alle Kandidaten bewerten" neben „Liste
  bewerten" (sichtbar wenn Rerank konfiguriert; startet mit demselben
  Job/Query wie die aktuelle Suche).

## 6. Fehlerbehandlung, i18n, Tests

- Fehlercodes wie im Bestand: `unauthorized`, `validation`,
  `notConfigured`; alle neuen Texte in BEIDEN Locales.
- PII-Regel: parse-Kind-Fehlertexte (zitieren rohe LLM-Completion)
  erscheinen nirgends — weder am Item noch im UI-Detail.
- Tests (bun:test): pure Helper — Fortschritts-/Statusableitung,
  Sortierung der Rangliste, Cache-Hit-Vorabzählung (SQL-frei testbarer
  Teil). Worker-Loop wird per E2E gegen Ollama verifiziert (Seed-Daten:
  Lauf → done → Rangliste; Zweitlauf → Cache-Hits, Sekunden).
- Verifikation: `bunx tsc --noEmit`, `bun run lint`, `bun test lib/`,
  `bun run db:generate` für die Migration.

## Nicht im Scope

- Zeitgesteuerte/wiederkehrende Läufe (Cron).
- Export (CSV/PDF).
- Fairness-Scheduling bei mehreren parallelen Läufen (erlaubt, aber
  unkoordiniert).
- Benachrichtigungen (Mail etc.) bei Lauf-Ende.
- Löschen einzelner Läufe (kann später kommen; cascade delete ist
  vorbereitet).

## Betroffene Dateien (Orientierung)

- `db/schema.ts` + neue Migration (drizzle-kit generate) — zwei Tabellen.
- `lib/evaluation/worker.ts` (neu) — Worker-Loop + Cache-Durchgriff.
- `lib/evaluation/helpers.ts` (neu, falls sinnvoll) — pure, testbare
  Fortschritts-/Zähl-Helper.
- `app/actions.ts` — start/cancel/resumeEvaluationRun.
- `app/runs/page.tsx`, `app/runs/[id]/page.tsx` (neu) — Liste + Detail.
- `app/components/run-*.tsx` (neu) — Poller, Fortschritt, Rangliste
  (Wiederverwendung von Score-Tier-Logik und InterviewSection aus
  rerank-stream-list.tsx — ggf. Score-Tier-Helper extrahieren).
- `app/components/header.tsx` — Nav-Punkt.
- `app/matching/page.tsx` / `match-search-form.tsx` — Start-Button.
- `instrumentation.ts` — Resume-Hook nach Migrationen.
- `lib/i18n/dictionaries.ts` — neue Sektion `runs` (de/en).
