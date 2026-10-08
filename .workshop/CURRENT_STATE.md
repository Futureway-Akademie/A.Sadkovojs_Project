# Aktueller Projektstand

## Projekt

RheinWerk Service-Dashboard: geschützter Mitarbeiterbereich `/dashboard` in der RheinWerk-Website mit Supabase. Roadmap v1 mit 10 Phasen und 31 Tasks. Fortschritt 83,96 % (Gewicht 89 von 106, 26 von 31 Tasks).

## Aktive Phase

Phasen 0–6 sind abgeschlossen. Phase 7 (Analytik) ist begonnen: die Datenbankfunktionen stehen, Manager-Übersicht und Diagramme folgen. Startbar außerdem Phase 8 (Verwaltung) und `task-9-1`.

## Aktive Aufgabe

Keine.

## Zuletzt abgeschlossen

`task-7-1`: Analytik in der Datenbank (Migration `20261008090000_analytics.sql`): `analytics_window`, `analytics_kpis`, `analytics_series`, `analytics_queue_history`, `analytics_automation`, `analytics_team`; security invoker, nur aktive Manager/Admins. Lese-Richtlinien mit vorgezogener Manager/Admin-Prüfung (gleiche Bedeutung, deutlich schneller). Definitionen in `docs/database.md`.

## Bereite nächste Aufgaben

- `task-7-2`: Manager-Übersicht.
- `task-8-1`: Benutzer, Tarife, Arbeitszeiten und Einstellungen.
- `task-9-1`: Kennzahlen-Wörterbuch und n8n-Vertrag.

## Blockiert

Nichts.

## Wichtige Entscheidungen

- Analytik: Vergleich über dieselbe verstrichene Zeit ab Beginn des Vorzeitraums, begrenzt auf dessen Ende; Ereignis-Kennzahlen nach eigenem Zeitstempel, Momentaufnahmen am Periodenende; `change_percent` nie bei Null-Basis. Warteschlangenhistorie aus `request_events` rekonstruiert.
- Rechnungs-PDF wird bei jedem Abruf deterministisch aus Positionen und Snapshots der ausgestellten Rechnung erzeugt (`lib/invoice-pdf.ts`, `pdf-lib`), nicht gespeichert; Entwürfe haben kein PDF. Für echte Rechnungen wäre eine Archivierung bei Ausstellung nötig.
- Gestaltung des PDFs folgt der Maßtabelle in `docs/design/RheinWerk Rechnungsvorlage.html`; Schriften unter `assets/fonts/` (OFL), eingebettet mit festen Namen für byte-identische Ausgabe.
- Website-Code wird aus `05_Export/RheinWerk Industrieservice Website` übernommen; das Dashboard entsteht im selben Next.js-Projekt.
- Quelle der Website: `FuzzCube/rheinwerk-industrieservice`, Commit `39d9936`, ohne Git-Historie übernommen.
- Markenname RheinWerk statt „Rheinberg“ aus der Spezifikation.
- Der Formularpfad zu Make bleibt unverändert; der künftige n8n-Vertrag wird nur dokumentiert.
- Entwicklung gegen lokales Supabase (`supabase start`); Schemaänderungen nur als Migrationen unter `supabase/migrations/`, spätere Übernahme in die Cloud per `supabase db push`.
- `proxy.ts` erneuert nur die Sitzung (nur `/dashboard`, `/login`, `/auth/*`) und setzt `Cache-Control: private, no-store`; Zugriffsschutz in jeder Dashboard-Seite (`lib/auth/session.ts`) und über RLS.
- Einsatzfotos: Server lädt in den privaten Bucket (`visits/<request>/<visit>/`), `add_visit_photo` registriert mit Nutzerrechten; bei Fehler wird die Datei gelöscht. Limit 11 MB für Server Actions und Proxy.
- Techniker-Seiten filtern zusätzlich zu RLS auf die eigene `technician_id` (RLS zeigt sonst fremde Einsätze auf aktuellen Anfragen).
- Einsatzplanung mit eigener Kalenderansicht (keine Bibliothek); Zeiten über `lib/berlin-time.ts` in Europe/Berlin.
- Prüfaktionen als Server Actions, je Aktion genau eine RPC mit angezeigter `version`, danach `refresh()`; kein Senden-Knopf, Warteschlange ≠ Versand.
- Dispatcher-Warteschlangen als View `public.dispatcher_queue` mit `security_invoker`; Regeln und Sortierung in `docs/database.md`.
- Anfrageseite liest alle Abschnitte mit Nutzerrechten (nie Admin-Client); Dokumente werden durch die App gestreamt (`/dashboard/anfragen/[id]/dokumente/[attachmentId]`). Supabase-Clients sind mit `lib/supabase/database.types.ts` typisiert (`npm run db:types` nach Schemaänderungen).
- UI-Bausteine unter `components/dashboard/ui/`, Formatierung `lib/format.ts`, Status `lib/status.ts`, Speichervertrag `lib/forms.ts`; kein segmentweites `loading.tsx` (würde Zugriffs-Weiterleitungen streamen), Laden per `Suspense` je Seite.
- Website und Dashboard in Route Groups `(site)`/`(dashboard)`; Bereiche, Startseiten und erlaubte Rollen zentral in `lib/auth/roles.ts`.

- Alle Enums der Spezifikation entstehen in einer eigenen Migration; Tabellen aktivieren RLS sofort (Deny-by-default), Richtlinien folgen in task-1-5.
- SQL-Tests mit pgTAP unter `supabase/tests/database/`, Ausführung `supabase test db`.
- Anfragenummern vergibt ausschließlich die Datenbank (Trigger), das Jahr folgt `created_at` in `settings.timezone`; `request_events` ist per Trigger append-only.
- Zugehörigkeit zur selben Anfrage wird über `UNIQUE (id, request_id)` und zusammengesetzte Fremdschlüssel garantiert; Überschneidungen aktiver Einsätze verhindert ein Exclusion Constraint (`btree_gist`).
- RLS gewährt nur Lesen; Schreiben ausschließlich über kontrollierte `security definer`-Operationen (Phase 2). Neue Tabellen müssen RLS aktivieren und Standardrechte von `anon`/`authenticated` entziehen.
- Kontrollierte Operationen: `security definer`-RPCs mit `expected_version`; Fehlercodes `42501` (Berechtigung), `RW409` (Versionskonflikt), `RW422` (Zustand/Eingabe). Siehe `docs/database.md`.
- Einsatzplanung serialisiert pro Techniker per Advisory-Lock; Verfügbarkeitsänderungen nehmen dieselbe Sperre. Reservierend sind nur `scheduled`/`in_progress`.
- Rechnungsentwurf ist eine Vorschau; die Ausstellung baut die Positionen neu und sperrt danach alle Arbeitspositionen der Anfrage.
- Tests: `npm run test:db` (pgTAP, datenunabhängig), `npm run test:api` (nur lokal, echte Logins), `npm run test:auth` (Login und Bereichsschutz über HTTP, laufende App), `npm run test:unit` und `npm run test:ui` (headless Chrome, laufende App); siehe `docs/testing.md`.
- Demo-Nutzer werden über die Admin-API angelegt und per `app_metadata.demo_seed` als Seed-Eigentum markiert; Rollen stehen ausschließlich in `profiles`.
- Demo-Seed: Generierung in Node (deterministisch, Zeit-Simulation mit Stichzeitpunkt), Schreiben atomar in SQL; Seed-Eigentum über `is_demo` und `private.demo_seed_records`.
- Demo-Basiswert der manuellen Erstbearbeitung: 15 Minuten (Nutzerentscheidung, abweichend von 5 Minuten der Spezifikation).

## Bekannte Probleme

- `supabase db lint` meldet `warning extra` zu Composite-OUT-Parametern der Hilfsfunktionen `private.lock_visit`, `lock_work_entry`, `lock_invoice`, `lock_outgoing_message` (stilistisch, ohne Auswirkung).
- Kein Supabase-Cloud-Projekt verknüpft; für das spätere Deployment nötig (`supabase login`, `supabase link`).
- `npm run test:api` und `npm run test:ui` legen Testnutzer und Testanfragen an. Die Anfragen (`is_demo`) entfernt `npm run demo:seed`; die Testnutzer erscheinen lokal in Namenslisten, bis `supabase db reset` sie entfernt.
- Port 3000 kann lokal von einem anderen Projekt belegt sein; App dann z. B. mit `npx next start -p 3100` und `APP_URL=http://127.0.0.1:3100` für `test:auth`/`test:ui` starten.
- Lokale Entwicklung setzt laufendes Docker und `supabase start` voraus; `.env.local` mit Werten aus `supabase status`.

## Empfohlener nächster Schritt

`task-7-2` (Manager-Übersicht) auf Basis der neuen Analytik-Funktionen; danach `task-7-3` (Diagramme).
