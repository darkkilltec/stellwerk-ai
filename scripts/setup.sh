#!/bin/sh
# Einmal-Setup für stellwerk-ai: prüft Voraussetzungen, legt .env an,
# startet die Datenbank, füllt Demo-Daten ein und öffnet die App im
# Browser. Mehrfaches Ausführen ist ungefährlich (idempotent).
# SETUP_NO_START=1 überspringt Browser + Dev-Server (für Tests/CI).
set -e
cd "$(dirname "$0")/.."

fail() {
  echo ""
  echo "✗ $1"
  echo "  → $2"
  exit 1
}

echo "── stellwerk-ai Setup ──────────────────────────────"

# 1. Voraussetzungen
command -v bun >/dev/null 2>&1 || fail \
  "Bun ist nicht installiert (das Programm, das die App ausführt)." \
  "Installieren: https://bun.sh — danach dieses Script erneut starten."
if command -v docker >/dev/null 2>&1; then RUNTIME=docker
elif command -v podman >/dev/null 2>&1; then RUNTIME=podman
else fail \
  "Weder Docker noch Podman gefunden (damit läuft die Datenbank)." \
  "Eines von beiden installieren: https://docs.docker.com/get-docker/ oder https://podman.io/docs/installation"
fi
echo "✓ Bun und $RUNTIME gefunden"

# 2. .env anlegen (nie überschreiben)
if [ ! -f .env ]; then
  PASSWORD=$(bun -e "console.log(crypto.randomUUID().slice(0, 13))")
  sed "s/^APP_PASSWORD=$/APP_PASSWORD=$PASSWORD/" .env.example > .env
  echo "✓ .env angelegt"
  echo ""
  echo "  ┌─────────────────────────────────────────────┐"
  echo "  │  Dein Login-Passwort: $PASSWORD  │"
  echo "  │  (steht auch in der Datei .env)             │"
  echo "  └─────────────────────────────────────────────┘"
  echo ""
else
  echo "✓ .env existiert bereits (bleibt unverändert)"
fi

# 3. Abhängigkeiten
if [ ! -d node_modules ]; then
  echo "… Installiere Abhängigkeiten (einmalig, dauert kurz)"
  bun install
fi
echo "✓ Abhängigkeiten installiert"

# 4. Datenbank starten + Migrationen
sh scripts/dev-db.sh || fail \
  "Die Datenbank ist nicht gestartet." \
  "Läuft $RUNTIME? Ist Port 5432 frei? (Sonst DB_PORT in .env setzen, siehe README.)"
echo "✓ Datenbank läuft"
bun run db:migrate >/dev/null 2>&1
echo "✓ Datenbank-Tabellen aktuell"

# 5. Demo-Daten (nur wenn die Datenbank noch fast leer ist)
bun run db:seed >/dev/null 2>&1 || true
COUNT=$(bun -e "
import { getDb, closeDb } from './lib/db';
import { candidates } from './db/schema';
console.log(await getDb().\$count(candidates));
await closeDb();")
if [ "$COUNT" -lt 50 ]; then
  echo "… Erzeuge Demo-Daten (300 Kandidaten, 60 Jobs)"
  bun run db:demo-data >/dev/null 2>&1
  echo "✓ Demo-Daten angelegt"
else
  echo "✓ Genug Daten vorhanden ($COUNT Kandidaten) — überspringe Demo-Daten"
fi

echo ""
echo "── Fertig! ─────────────────────────────────────────"
echo "  Die App startet jetzt auf http://localhost:3000"
echo "  Login-Passwort: siehe APP_PASSWORD in der Datei .env"
echo ""
echo "  Tipp: Für die KI-Funktionen (Matching-Scores, Anonymisierung,"
echo "  Interview-Leitfäden) danach einmal ausführen:"
echo "     bun run setup:ai        (lokale KI, kostenlos, ~5,5 GB Download)"
echo "  oder API-Keys in der App unter Einstellungen hinterlegen."
echo "────────────────────────────────────────────────────"

if [ "${SETUP_NO_START:-}" = "1" ]; then
  echo "(SETUP_NO_START=1 — Server-Start übersprungen)"
  exit 0
fi

# 6. Browser öffnen (sobald der Server antwortet) und Server starten
(
  i=0
  while [ $i -lt 60 ]; do
    if curl -s -o /dev/null http://localhost:3000/ 2>/dev/null; then
      (xdg-open http://localhost:3000 2>/dev/null || open http://localhost:3000 2>/dev/null) || true
      exit 0
    fi
    sleep 1; i=$((i + 1))
  done
) &
exec bun x next dev
