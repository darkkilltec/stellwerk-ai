#!/bin/sh
# Richtet die KI-Funktionen komplett lokal ein (kostenlos, ohne API-Keys):
# lädt zwei Ollama-Modelle, konfiguriert Embedding + Bewertungs-KI über
# die test-abgesicherten Pfade der App und berechnet die Embeddings.
# Voraussetzung: Ollama läuft (https://ollama.com/download).
set -e
cd "$(dirname "$0")/.."

OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
EMBED_MODEL="snowflake-arctic-embed2"
JUDGE_MODEL="qwen2.5:7b"

fail() {
  echo ""
  echo "✗ $1"
  echo "  → $2"
  exit 1
}

echo "── stellwerk-ai Lokale-KI-Setup ────────────────────"

command -v bun >/dev/null 2>&1 || fail \
  "Bun ist nicht installiert." "Erst 'bun run setup' ausführen (siehe README)."

curl -s --max-time 3 "$OLLAMA_URL/api/tags" >/dev/null 2>&1 || fail \
  "Ollama ist nicht erreichbar (das Programm, das die KI-Modelle lokal ausführt)." \
  "Installieren und starten: https://ollama.com/download — danach dieses Script erneut ausführen."
echo "✓ Ollama läuft ($OLLAMA_URL)"

echo ""
echo "  Lade jetzt zwei KI-Modelle herunter (zusammen ~5,5 GB)."
echo "  Bereits vorhandene Modelle werden übersprungen."
echo ""

for MODEL in "$EMBED_MODEL" "$JUDGE_MODEL"; do
  echo "… Modell $MODEL"
  curl -s "$OLLAMA_URL/api/pull" -d "{\"model\":\"$MODEL\"}" \
    | tr ',' '\n' | grep -o '"status":"[^"]*"' | uniq | tail -1 >/dev/null
  curl -s "$OLLAMA_URL/api/tags" | grep -q "$MODEL" || fail \
    "Modell $MODEL konnte nicht geladen werden." \
    "Internetverbindung prüfen und erneut versuchen ('ollama pull $MODEL' zeigt Details)."
  echo "✓ Modell $MODEL bereit"
done

echo "… Konfiguriere Embedding-Modell (mit Live-Test)"
bun run db:configure -- --provider ollama --model "$EMBED_MODEL" || fail \
  "Embedding-Konfiguration fehlgeschlagen." \
  "Läuft die Datenbank? ('bun run setup' zuerst ausführen)"

echo "… Konfiguriere Bewertungs-KI (mit Live-Test, dauert einen Moment)"
bun run db:configure-rerank -- --provider ollama --model "$JUDGE_MODEL" || fail \
  "Konfiguration der Bewertungs-KI fehlgeschlagen." \
  "Läuft die Datenbank? ('bun run setup' zuerst ausführen)"

echo "… Berechne Embeddings für alle Kandidaten und Jobs"
bun run db:embed

echo ""
echo "── Fertig! Alle KI-Funktionen sind aktiv. ──────────"
echo "  App neu laden (http://localhost:3000) und unter"
echo "  'Matching' einen Job auswählen."
echo "────────────────────────────────────────────────────"
