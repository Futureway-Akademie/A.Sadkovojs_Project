# Aktueller Projektstand

## Projekt

RheinWerk Service-Dashboard: geschützter Mitarbeiterbereich `/dashboard` in der RheinWerk-Website mit Supabase. Roadmap v1 mit 10 Phasen und 30 Tasks. Fortschritt 3,85 % (Gewicht 4 von 104).

## Aktive Phase

Phase 0 (Grundlage) ist abgeschlossen. Nächste Phasen: Phase 1 (Datenbankschema) und Phase 4 (Dashboard-Grundgerüst).

## Aktive Aufgabe

Keine.

## Zuletzt abgeschlossen

`task-0-2`: Supabase-Clients (Browser, Server, Admin), Proxy für Sitzungscookies und Umgebungsvariablen; Verbindung zum lokalen Supabase-Stack geprüft; lint, typecheck und build erfolgreich.

## Bereite nächste Aufgaben

- `task-1-1`: Enums und Stammdaten-Tabellen.
- `task-4-1`: Routenstruktur, Anmeldung und Navigation.

## Blockiert

Nichts.

## Wichtige Entscheidungen

- Website-Code wird aus `05_Export/RheinWerk Industrieservice Website` übernommen; das Dashboard entsteht im selben Next.js-Projekt.
- Quelle der Website: `FuzzCube/rheinwerk-industrieservice`, Commit `39d9936`, ohne Git-Historie übernommen.
- Markenname RheinWerk statt „Rheinberg“ aus der Spezifikation.
- Der Formularpfad zu Make bleibt unverändert; der künftige n8n-Vertrag wird nur dokumentiert.
- Entwicklung gegen lokales Supabase (`supabase start`); Schemaänderungen nur als Migrationen unter `supabase/migrations/`, spätere Übernahme in die Cloud per `supabase db push`.
- `proxy.ts` erneuert nur die Sitzung (nur `/dashboard`, `/login`, `/auth/*`); Zugriffsschutz im Dashboard-Layout und über RLS.

## Bekannte Probleme

- Kein Supabase-Cloud-Projekt verknüpft; für das spätere Deployment nötig (`supabase login`, `supabase link`).
- Lokale Entwicklung setzt laufendes Docker und `supabase start` voraus; `.env.local` mit Werten aus `supabase status`.

## Empfohlener nächster Schritt

`task-1-1` (Enums und Stammdaten-Tabellen) starten; damit beginnt das Datenbankschema, auf dem die meisten weiteren Tasks aufbauen.
