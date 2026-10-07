# Aktueller Projektstand

## Projekt

RheinWerk Service-Dashboard: geschützter Mitarbeiterbereich `/dashboard` in der RheinWerk-Website mit Supabase. Roadmap v1 mit 10 Phasen und 30 Tasks. Fortschritt 40,38 % (Gewicht 42 von 104).

## Aktive Phase

Phasen 0–2 sind abgeschlossen. Nächste: Phase 3 (Demodaten) und Phase 4 (Dashboard-Grundgerüst).

## Aktive Aufgabe

Keine.

## Zuletzt abgeschlossen

`task-2-5`: Szenariotests (Spezifikation 1, 2, 3, 4, 7), API-Tests mit echten Logins (`npm run test:api`) inkl. gleichzeitiger Buchungen über HTTP, datenunabhängige pgTAP-Tests (`npm run test:db`, 384/384), Integrationsoperation `confirm_message_sent` (nur service_role) und `request_events.seq`. Dokumentation: `docs/testing.md`.

## Bereite nächste Aufgaben

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
- Einsatzplanung serialisiert pro Techniker per Advisory-Lock; Verfügbarkeitsänderungen nehmen dieselbe Sperre. Reservierend sind nur `scheduled`/`in_progress`.
- Rechnungsentwurf ist eine Vorschau; die Ausstellung baut die Positionen neu und sperrt danach alle Arbeitspositionen der Anfrage.
- Tests: `npm run test:db` (pgTAP, datenunabhängig) und `npm run test:api` (nur lokal, echte Logins); siehe `docs/testing.md`.

## Bekannte Probleme

- `supabase db lint` meldet `warning extra` zu Composite-OUT-Parametern der Hilfsfunktionen `private.lock_visit`, `lock_work_entry`, `lock_invoice`, `lock_outgoing_message` (stilistisch, ohne Auswirkung).
- Kein Supabase-Cloud-Projekt verknüpft; für das spätere Deployment nötig (`supabase login`, `supabase link`).
- Lokale Entwicklung setzt laufendes Docker und `supabase start` voraus; `.env.local` mit Werten aus `supabase status`.

## Empfohlener nächster Schritt

`task-3-1` (Bootstrap der Demo-Nutzer) starten; alternativ `task-4-1` (Anmeldung und Navigation).
