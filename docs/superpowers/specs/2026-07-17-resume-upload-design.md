# Design: Resume-Upload mit Anonymisierung + Interview-Leitfaden

Datum: 2026-07-17
Status: Entwurf (vom Nutzer freigegeben im Chat, schriftliche Review ausstehend)

## Ziel

Demo-Feature für stellwerk-ai: Ein Lebenslauf (PDF) wird hochgeladen, der Text
extrahiert, per LLM anonymisiert und strukturiert, und füllt das
Kandidaten-Formular vor. Nach dem Speichern greift der bestehende
Embedding-Pfad. Zusätzlich generiert ein Button im Matching-Ergebnis einen
Interview-Leitfaden aus Job, Profil und den erkannten Lücken.

Erfolgskriterium: In der Demo sieht man „rohes PDF rein → anonymisiertes,
strukturiertes Profil raus → Match mit begründetem Score → gezielte
Interviewfragen" — ohne dass ein Klartext-Name je in Embedding oder
Judge-Prompt landet.

## Entscheidungen (aus dem Brainstorming)

- Scope: Variante „B angepasst" — Upload + Anonymisierung + Struktur-Parsing
  als vorbefüllter Formulartext, **keine** neuen DB-Spalten, **keine**
  Migration. Interview-Generator ist Teil des Scopes.
- Architektur: **Zwei-Phasen mit Vorschau.** Upload und Parse sind eine
  eigene Server Action; das Ergebnis wird im Formular angezeigt und vom
  Nutzer geprüft/editiert; das Anlegen läuft über den unveränderten
  `createCandidate`-Pfad.
- LLM-Zugang: Wiederverwendung der vorhandenen Rerank-Provider-Config
  (`getValidatedRerankSettings`), kein neues Settings-Feld.

## 1. Upload-Pipeline

Datenfluss:

1. `NewCandidateForm` (app/components/create-forms.tsx) bekommt eine
   Upload-Zone oberhalb der Felder. Akzeptiert `.pdf`, `.txt`, `.md`,
   Limit ~5 MB. Das Body-Limit für Server Actions wird in `next.config.ts`
   entsprechend angehoben (Next-16-Doku dazu vor Implementierung lesen —
   AGENTS.md-Pflicht).
2. Neue Server Action `parseResume` (app/actions.ts):
   - Auth-Check wie alle Actions.
   - Validierung: Dateityp, Größe.
   - Textextraktion: `unpdf` für PDF (reines JS, Bun-kompatibel,
     keine nativen Dependencies); `.txt`/`.md` direkt lesen.
   - Rerank-Config laden; ist keine konfiguriert, kommt ein eigener
     Fehlercode zurück und die UI verweist auf `/settings`.
   - Aufruf von `parseResumeText` (unten), Ergebnis an den Client.
3. Neues Modul `lib/resume/parse.ts`:
   - `parseResumeText(raw: string, cfg: RerankConfig): Promise<{ name: string; profile: string }>`
   - Ein LLM-Call (gleiches Provider-HTTP-Muster wie `judgeFit` in
     lib/reranking/client.ts, JSON-only-Antwort mit Schema-Validierung).
   - `profile` ist strukturierter deutscher Text mit festen Abschnitten:
     Kurzprofil / Skills / Berufserfahrung (Rollen + Jahre) / Ausbildung /
     Sprachen. Das füttert Embedding, tsvector und Judge besser als roher
     PDF-Text.
4. Client: Nach erfolgreichem Parse werden `name` und `profile` als
   kontrollierte Felder befüllt; der Nutzer prüft und editiert. Der
   Submit geht durch den **unveränderten** `createCandidate`-Pfad
   (Insert → `embedAndStore` → Degradierung zu Warnung bei
   Provider-Fehler, Heilung via `db:embed`).

## 2. Anonymisierung

- Die Regeln stehen im System-Prompt von `parseResumeText` und spiegeln
  die geschützten Attribute des Judge-Prompts: Name, Kontaktdaten,
  Adresse, Geburtsdatum, Geschlecht, Nationalität, Religion,
  Familienstand erscheinen **nicht** im Profiltext.
- Der Name wird extrahiert und wandert ausschließlich ins separate
  `name`-Feld. `composeCandidateText` (lib/embedding/compose.ts) schließt
  ihn heute schon vom Embedding aus — das bestehende Safeguard bleibt
  strukturell intakt, der Upload-Pfad reiht sich ein.
- Fehlerpfad: Schlägt der LLM-Call fehl oder liefert invalides JSON,
  zeigt die UI einen Fehler. Der rohe PDF-Text wird **niemals**
  automatisch ins Profilfeld übernommen (kein PII-Leck im Fehlerfall).

## 3. Interview-Leitfaden

- UI: Button pro Kandidat im `RerankStreamList`-Ergebnis, sichtbar sobald
  das Verdikt gestreamt ist. Die Matching-Page reicht den `queryText`
  (Jobtext) an die Liste durch.
- Neue Server Action `generateInterviewQuestions`:
  - Input: `candidateId`, Jobtext, `missingRequirements` aus dem Verdikt.
  - Lädt das Profil aus der DB, ein LLM-Call über dieselbe Rerank-Config,
    JSON-Antwort mit Schema-Validierung.
  - Output: 5–7 Fragen, gruppiert in fachlich / Erfahrung / Lücken.
    Die Lücken-Fragen zielen explizit auf die `missingRequirements`
    („Im Profil fehlt X — fragen Sie nach…").
  - Namensblind wie der Judge: Der Prompt erhält nur den anonymisierten
    Profiltext, nie den Namen.
- Anzeige: klappt inline unter dem Verdikt auf (Client-State in
  `RerankStreamList`), mit Lade-Skeleton im Stil der bestehenden.

## 4. Fehlerbehandlung, i18n, Tests

- Fehler als Codes (wie `CreateState`): `validation`, `unauthorized`,
  `notConfigured`, plus die Provider-Fehlerarten aus
  `lib/providers/http.ts`. Übersetzungen für de/en in
  `lib/i18n/dictionaries.ts`.
- Tests: Unit-Test für `lib/resume/parse.ts` nach dem Muster von
  `lib/reranking/test.ts` — JSON-Parsing/Validierung, und dass die
  Anonymisierungs-Regeln im Prompt verankert sind. Für den
  Interview-Generator analog ein Parsing-Test.
- Optional (nicht in diesem Scope): Eval, der prüft, dass der Klartext-Name
  nicht im anonymisierten Profil auftaucht (Erweiterung von evals/bias.ts).

## Nicht im Scope

- DOCX-Support.
- Neue DB-Spalten / Migrationen für strukturierte Skills.
- Streaming-Fortschrittsanzeige für den Parse-Schritt.
- Persistierung generierter Interview-Leitfäden.

## Neue Dependency

- `unpdf` (PDF-Textextraktion, pure JS).

## Betroffene Dateien (Orientierung)

- `app/components/create-forms.tsx` — Upload-Zone, kontrollierte Felder.
- `app/actions.ts` — `parseResume`, `generateInterviewQuestions`.
- `lib/resume/parse.ts` (neu) — Extraktions-/Anonymisierungs-Prompt + Parsing.
- `lib/resume/interview.ts` (neu) — Leitfaden-Prompt + Parsing.
- `app/components/rerank-stream-list.tsx` — Button + Inline-Anzeige.
- `app/matching/page.tsx` — `queryText` durchreichen.
- `lib/i18n/dictionaries.ts` — neue Texte de/en.
- `next.config.ts` — Body-Limit für Server Actions.
