# Aktueller Projektstand

## Projekt

RheinWerk Service-Dashboard: geschützter Mitarbeiterbereich `/dashboard` in der RheinWerk-Website mit Supabase. Roadmap v1 mit 10 Phasen und 30 Tasks. Fortschritt 25,00 % (Gewicht 26 von 104).

## Aktive Phase

Phase 2: Kontrollierte Operationen (`phase-2`).

## Aktive Aufgabe

Keine.

## Zuletzt abgeschlossen

`task-2-1`: RPCs `assign_dispatcher`, `mark_needs_review`, `mark_awaiting_customer`, `resume_analysis`, `correct_analysis`, `complete_intake`, `reopen_intake`, `reject_request`, `cancel_request`, `change_deadline` mit Rollen-/Zugriffs-/Versionsprüfung (Fehlercodes 42501, RW409, RW422) und atomarem Audit; Erstabschluss-Snapshot per Trigger unveränderlich. pgTAP 201/201, REST-API-Prüfung, lint, typecheck und build erfolgreich.

## Bereite nächste Aufgaben

- `task-2-2`: Einsatzplanung und Einsatzstatus.
- `task-3-1`: Bootstrap der Demo-Nutzer.
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

- Alle Enums der Spezifikation entstehen in einer eigenen Migration; Tabellen aktivieren RLS sofort (Deny-by-default), Richtlinien folgen in task-1-5.
- SQL-Tests mit pgTAP unter `supabase/tests/database/`, Ausführung `supabase test db`.
- Anfragenummern vergibt ausschließlich die Datenbank (Trigger), das Jahr folgt `created_at` in `settings.timezone`; `request_events` ist per Trigger append-only.
- Zugehörigkeit zur selben Anfrage wird über `UNIQUE (id, request_id)` und zusammengesetzte Fremdschlüssel garantiert; Überschneidungen aktiver Einsätze verhindert ein Exclusion Constraint (`btree_gist`).
- RLS gewährt nur Lesen; Schreiben ausschließlich über kontrollierte `security definer`-Operationen (Phase 2). Neue Tabellen müssen RLS aktivieren und Standardrechte von `anon`/`authenticated` entziehen.
- Kontrollierte Operationen: `security definer`-RPCs mit `expected_version`; Fehlercodes `42501` (Berechtigung), `RW409` (Versionskonflikt), `RW422` (Zustand/Eingabe). Siehe `docs/database.md`.

## Bekannte Probleme

- Kein Supabase-Cloud-Projekt verknüpft; für das spätere Deployment nötig (`supabase login`, `supabase link`).
- Lokale Entwicklung setzt laufendes Docker und `supabase start` voraus; `.env.local` mit Werten aus `supabase status`.

## Empfohlener nächster Schritt

`task-2-2` (Einsatzplanung und Einsatzstatus) starten und Phase 2 fortsetzen.
