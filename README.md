# stellwerk-ai

🇩🇪 Deutsch · [🇬🇧 English](README.en.md)

![CI](https://github.com/darkkilltec/stellwerk-ai/actions/workflows/ci.yml/badge.svg)

**KI-gestütztes Kandidaten-Matching für Recruiting-Teams — fair by design.**

stellwerk-ai findet zu einer Stellenausschreibung die passendsten Kandidat:innen aus der eigenen Datenbank — und erklärt jede Bewertung: Score, Begründung und was im Profil konkret fehlt. Namen, Herkunft, Alter oder Familienstand sieht die KI dabei nie: Lebensläufe werden beim Import automatisch anonymisiert, und die Bewertung arbeitet strikt namensblind. Ein eingebauter Bias-Check beweist das nach.

## Was kann die App?

- **Matching:** Job auswählen (oder frei beschreiben) → Kandidaten-Ranking in Sekunden, mit Ähnlichkeits-Score aus semantischer Suche + Volltextsuche.
- **KI-Bewertung:** Auf Knopfdruck bewertet eine KI jeden Treffer wie ein strenger, fairer Recruiter — mit Score (0–100), 2-Sätze-Begründung und der Liste fehlender Anforderungen. Ergebnisse streamen live in die Seite.
- **Lebenslauf-Upload:** PDF hochladen → Text wird extrahiert, **anonymisiert** (Name, Kontakt, Alter, Familienstand, Firmennamen raus) und strukturiert ins Formular übernommen — zur Prüfung, bevor gespeichert wird.
- **Interview-Leitfäden:** Pro Kandidat:in generiert die KI gezielte Interviewfragen — inklusive Fragen zu genau den Lücken, die die Bewertung gefunden hat.
- **Bewertungsläufe:** Die *gesamte* Kandidaten-Datenbank für einen Job bewerten lassen — läuft im Hintergrund weiter (auch bei geschlossenem Browser), mit Fortschrittsanzeige, dauerhaft gespeicherter Rangliste und Lauf-Historie. Wiederholungsläufe sind dank Cache in Sekunden fertig.
- **Prompt-Labor:** Der Bewertungs-Prompt ist Konfiguration, nicht Code — änderbar im UI, abgesichert durch feste Testfälle.

## In 10 Minuten startklar

Du brauchst einmalig zwei kostenlose Programme (Installation je ~2 Minuten):

| Programm | Wofür | Download |
|---|---|---|
| **Bun** | führt die App aus | [bun.sh](https://bun.sh) |
| **Docker** *oder* **Podman** | führt die Datenbank aus | [Docker](https://docs.docker.com/get-docker/) · [Podman](https://podman.io/docs/installation) |

Dann im Terminal (unter Windows: WSL verwenden):

```bash
git clone https://github.com/darkkilltec/stellwerk-ai.git
cd stellwerk-ai
bun run setup
```

Das war's — das Setup prüft alles, legt Demo-Daten an (300 Kandidaten, 60 Jobs), zeigt dir dein Login-Passwort und öffnet die App im Browser. Es ist gefahrlos mehrfach ausführbar.

### KI-Funktionen aktivieren

Die KI braucht entweder ein lokales Modell (kostenlos) oder einen API-Key:

**Variante A — komplett lokal, kostenlos** (empfohlen zum Ausprobieren). Einmalig [Ollama](https://ollama.com/download) installieren und starten, dann:

```bash
bun run setup:ai
```

Lädt zwei KI-Modelle (~5,5 GB), richtet alles ein und testet es. Danach funktionieren Matching-Scores, Anonymisierung, Interview-Leitfäden und Bewertungsläufe — alles auf deinem Rechner, keine Daten verlassen ihn.

**Variante B — Cloud-Anbieter** (bessere Qualität): In der App anmelden → **Einstellungen** → Embedding-Provider und Bewertungs-KI mit deinem API-Key einrichten (Anthropic, OpenAI oder Voyage). Jede Konfiguration wird vor dem Speichern live getestet. Danach einmal `bun run db:embed` ausführen.

## Wenn etwas hakt

| Problem | Lösung |
|---|---|
| `bun: command not found` | Bun installieren ([bun.sh](https://bun.sh)), Terminal neu öffnen |
| „Weder Docker noch Podman gefunden" | Eines von beiden installieren (Links oben) und starten |
| „Die Datenbank ist nicht gestartet" / Port 5432 belegt | In der Datei `.env` die Zeile `#DB_PORT=5433` einkommentieren und `DATABASE_URL` auf denselben Port ändern |
| „Ollama ist nicht erreichbar" | [Ollama](https://ollama.com/download) installieren und starten, dann `bun run setup:ai` erneut |
| Passwort vergessen | Steht in der Datei `.env` (Zeile `APP_PASSWORD=…`) |
| Matching zeigt „Kein Judge-LLM konfiguriert" | KI-Funktionen aktivieren (siehe oben) |

Nichts geholfen? [Issue aufmachen](https://github.com/darkkilltec/stellwerk-ai/issues) — mit der Fehlermeldung aus dem Terminal.

## Für Entwickler:innen

Next.js (App Router) + Bun + Postgres 17 mit [pgvector](https://github.com/pgvector/pgvector), vollständig containerisiert. CI fährt bei jedem Push den kompletten Reviewer-Pfad: frischer Checkout, `docker compose up`, Migrationen, Seed, struktureller Bias-Check, Embedding- und Matching-Mechanik gegen einen committeten Mock-Provider, Produktions-Image-Build.

### Tägliche Entwicklung

Die Datenbank läuft immer im Container, die App nativ (schneller Hot-Reload). `bun dev` startet die DB (Docker oder Podman, mit echtem Ready-Check) und dann Next:

```bash
bun dev
```

`docker compose up --build` ist der Smoke-Test für den Reviewer-Pfad — regelmäßig laufen lassen.

### Schema & Migrationen

Schema in `db/schema.ts` (Drizzle). Migrationen in `db/migrations/` werden beim Serverstart automatisch angewendet (`instrumentation.ts`) — in Dev wie im Container.

```bash
bun run db:generate    # Migration aus Schema-Änderungen erzeugen
bun run db:seed        # Demo-Kandidaten/-Jobs (idempotent)
bun run db:demo-data   # synthetisches Volumen (300/60, deterministisch via --seed)
bun run db:studio      # DB durchstöbern
```

### KI-Konfiguration & Evals

```bash
# Provider konfigurieren (test-gated — gespeichert wird nur, was live funktioniert):
bun run db:configure -- --provider ollama --model snowflake-arctic-embed2
bun run db:configure-rerank -- --provider ollama --model qwen2.5:7b
bun run db:embed       # alle Zeilen embedden (idempotent, heilt nach Modellwechsel)

bun run eval:matching  # Golden-Set-Retrieval (Rang, Similarity, Margin)
bun run eval:recall    # Recall@10 der Hybrid-Suche
bun run eval:reranking # Zwei-Stufen-Pipeline inkl. Regressions-Check
bun run eval:judge     # Judge-Konsistenz auf fixen Fällen
bun run eval:bias      # kontrafaktischer Fairness-Check
```

**Config-Architektur:** Infrastruktur-Config (`DATABASE_URL`) lebt im ENV; Anwendungs-Config (Provider, Modell, API-Key) liegt verschlüsselt (AES-256-GCM) in der DB hinter einem Test-Gate — UI und CLI teilen denselben Schreibpfad. `db:embed` speichert Modell + Quell-Hash pro Zeile; Modellwechsel werden erkannt, `eval:matching` verweigert Rankings über gemischte Modelle.

**Hybrid-Retrieval:** pgvector-Cosine-Suche fusioniert mit Postgres-Volltextsuche via Reciprocal Rank Fusion — eine SQL-Query, keine Extra-Infrastruktur. `eval:recall` misst genau das: den Anteil tatsächlich qualifizierter Kandidaten, der die Top 10 erreicht, die der Judge sieht.

**Bewertungs-Pipeline:** Verdikte werden nach Inhalt + Modell + Prompt-Hash gecacht (`rerank_cache`); jede Prompt-Änderung (auch im Prompt-Labor unter `/settings/prompt`) invalidiert automatisch. Bewertungsläufe (`/runs`) legen zusätzlich dauerhafte Verdikt-Kopien in `evaluation_items` ab — das Archiv überlebt Prompt- und Modellwechsel. Der Hintergrund-Worker nimmt unterbrochene Läufe beim Serverstart selbst wieder auf.

**Anonymisierung strukturell:** Kandidaten-Namen und Firmennamen erreichen weder Embeddings noch den Judge (`composeCandidateText`, namensblinde Prompts); der Resume-Parser entfernt zusätzlich alle geschützten Attribute aus dem Profiltext. `eval:bias` beweist beides kontrafaktisch.

### Stack-Notizen

- `pgvector/pgvector:pg17`-Image; Extension via `db/init/01-extensions.sql` beim ersten Start.
- App-Image: Multi-Stage-Build auf `oven/bun` mit Next.js `output: "standalone"`.
- Embeddings: `vector(1024)`-Spalten mit HNSW-Cosine-Indizes (`EMBEDDING_DIMENSIONS` in `db/schema.ts`).
- `.env` ist git-ignored; `.env.example` dokumentiert alle Variablen. Secrets erreichen den Container zur Laufzeit via `env_file`.
- Ollama aus `docker compose` heraus: `http://host.docker.internal:11434` statt `localhost`.
