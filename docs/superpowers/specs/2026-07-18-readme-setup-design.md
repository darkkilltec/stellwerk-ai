# Design: HR-taugliche README (de/en) + One-Shot-Setup-Scripts

Datum: 2026-07-18
Status: im Chat freigegeben (Umsetzung direkt im Anschluss, per Nutzer-Entscheid ohne separates Plan-Dokument)

## Ziel

Eine HR-Person ohne Entwicklerhintergrund kann das Projekt mit drei
Befehlen lauffähig bekommen (oder weiß präzise, welche Hilfe sie holen
muss). GitHub zeigt eine deutsche README mit englischer Variante.

## Entscheidungen

- README.md = Deutsch (Hauptansicht), README.en.md = Englisch, wechselseitig verlinkt.
- `bun run setup` (Basis, ohne KI-Config lauffähig) + `bun run setup:ai` (optional, lokales Ollama).
- Script-Meldungen deutsch, einfache Sprache.

## Umfang

1. **`scripts/setup.sh`** (`bun run setup`):
   - Prüft `bun` und Container-Runtime (docker ODER podman); fehlt etwas → verständliche Meldung + Install-Link, Exit 1.
   - `.env` fehlt → aus `.env.example` kopieren, `APP_PASSWORD` mit Zufallswert füllen und deutlich ausgeben. Vorhandene `.env` wird NIE angefasst.
   - `bun install` falls `node_modules` fehlt.
   - DB via `scripts/dev-db.sh`, dann `bun run db:migrate`.
   - `bun run db:seed`; Demo-Daten (`db:demo-data`) nur, wenn aktuell < 50 Kandidaten (Idempotenz-Guard, Zählung via bun-Einzeiler).
   - Browser öffnen (xdg-open/open, non-fatal) und `next dev` starten. `SETUP_NO_START=1` überspringt Browser+Server (für Tests/CI).
2. **`scripts/setup-ai.sh`** (`bun run setup:ai`):
   - Prüft Ollama auf `http://localhost:11434` (curl); fehlt → Anleitung + Link ollama.com/download, Exit 1.
   - Warnung „~5,5 GB Download", dann Pull `snowflake-arctic-embed2` + `qwen2.5:7b` (No-op wenn vorhanden).
   - `bun run db:configure -- --provider ollama --model snowflake-arctic-embed2`.
   - Neues Mini-CLI **`db/configure-rerank.ts`** (`bun run db:configure-rerank`, analog db/configure.ts, gleicher test-gated Pfad `testAndSaveRerankConfig`) mit `--provider ollama --model qwen2.5:7b`.
   - `bun run db:embed`.
3. **`package.json`**: Scripts `setup`, `setup:ai`, `db:configure-rerank`.
4. **`README.md` (de)**: Sprachumschalter; „Was ist das?" (nicht-technisch); Features inkl. Resume-Upload/Anonymisierung, Interview-Leitfäden, Bewertungsläufe; „In 10 Minuten startklar" (Voraussetzungen mit Links, drei Befehle); „Ohne lokale KI" (Keys im Settings-UI); Troubleshooting-Tabelle; „Für Entwickler:innen" mit den gestrafften bestehenden technischen Inhalten (Config-Architektur, Evals, Hybrid-Retrieval, Schema/Migrationen, Stack).
5. **`README.en.md`**: gleiche Struktur englisch; die bisherigen englischen Technik-Texte leben hier weiter.

## Nicht im Scope

- Windows-Support der Scripts (WSL wird in der README erwähnt).
- Interaktive Provider-Abfrage; Cloud-Provider-Automation (Keys → Settings-UI).
- CI-Anpassungen.

## Verifikation

- `SETUP_NO_START=1 sh scripts/setup.sh` mit gestoppter DB: läuft durch, `.env` unverändert, Guard überspringt Demo-Daten.
- `sh scripts/setup-ai.sh` gegen laufendes Ollama: Configs re-validiert (Test-Gates), embed idempotent („skipped").
- Beide READMEs: Links/Anker prüfen, Befehle stimmen mit package.json überein.
