# Tests

Alle Prüfungen laufen gegen den lokalen Supabase-Stack. Voraussetzungen: Docker, `supabase start`, `.env.local` mit den Werten aus `supabase status` (siehe `.env.example`).

## Befehle

| Befehl | Prüft | Dauer |
| --- | --- | --- |
| `npm run lint` | ESLint | Sekunden |
| `npm run typecheck` | TypeScript | Sekunden |
| `npm run build` | Produktions-Build | ca. 30 s |
| `npm run test:db` | pgTAP-Tests unter `supabase/tests/database/` (`supabase test db`) | Sekunden |
| `npm run test:api` | Direkte REST-, RPC- und Storage-Aufrufe mit echten Logins, gleichzeitige Buchungen über HTTP (`scripts/test-api.mjs`) | ca. 10 s |
| `npm run supabase:check` | Verbindung zum Supabase-Projekt | Sekunden |
| `supabase db lint` | Schema-Linter (plpgsql_check) | Sekunden |

Nach Schemaänderungen zuerst `supabase db reset` (wendet alle Migrationen neu an), dann `npm run test:db`.

## Datenbanktests (`npm run test:db`)

Jede Datei läuft in einer Transaktion mit `ROLLBACK` und hinterlässt keine Daten. Rollen werden mit `set local role` und simulierten JWT-Claims (`request.jwt.claims`) gewechselt. Die Tests zählen nur ihre eigenen Fixtures (feste UUIDs `00000000-0000-0000-0000-…`) und verwenden für Nummernkreise freie Jahre; sie laufen deshalb auch auf einer Datenbank mit Demo- oder API-Testdaten.

| Datei | Inhalt |
| --- | --- |
| `master_data.test.sql` | Stammdaten, CHECK-Constraints |
| `requests_and_events.test.sql` | Anfragenummer, Idempotenz, Unveränderlichkeit, append-only Ereignisse |
| `messages_automation_attachments.test.sql` | Nachrichten, Automatisierungsläufe, Anhänge |
| `visits_work_invoices.test.sql` | Einsätze, Überschneidungsschutz, Arbeitspositionen, Rechnungen, Rundung |
| `rls.test.sql` | Leserechte aller Rollen, Storage |
| `intake_operations.test.sql` | Erstbearbeitung, Zuweisung, Fristen |
| `visit_operations.test.sql` | Einsatzplanung, Verfügbarkeit, Einsatzstatus |
| `work_operations.test.sql` | Arbeitspositionen, Abschluss der Anfrage |
| `invoice_message_operations.test.sql` | Rechnungen, Zahlungen, E-Mail-Warteschlange, Zuordnung |
| `scenarios.test.sql` | Durchgehende Szenarien 1, 2, 3, 4 und 7 der Spezifikation |

## API-Tests (`npm run test:api`)

Legt pro Lauf eigene Nutzer über die Auth-Admin-API an (`api-…-<lauf>@example.com`), meldet sie mit Passwort an und prüft über die öffentliche API:

- **Szenario 1:** `anon` liest und ruft nichts auf; Techniker B liest weder Anfrage noch Dokument-Metadaten von A und lädt dessen Datei nicht herunter; direkte PATCH-/INSERT-Aufrufe mit gefälschtem Autor scheitern; keine Selbstbeförderung; Dispatcher A erreicht keine Anfrage von B; inaktive Profile handeln nicht; nur die Integration bestätigt E-Mail-Versand.
- **Szenario 2 (Nebenläufigkeit über HTTP):** 10 gleichzeitige `schedule_visit`-Aufrufe für dasselbe Zeitfenster ergeben genau eine Buchung und 9 × `RW410`; in 10 Durchläufen wird jeweils gleichzeitig gebucht und eine Abwesenheit eingetragen – nie gelingen beide.

Das Skript bricht ab, wenn `NEXT_PUBLIC_SUPABASE_URL` nicht auf `127.0.0.1`/`localhost` zeigt. Testdaten bleiben in der lokalen Datenbank, bis `supabase db reset` sie entfernt; wiederholte Läufe stören sich nicht.

## Szenarien der Spezifikation (Abschnitt 10)

| Szenario | Abgedeckt durch |
| --- | --- |
| 1 Berechtigungen | `rls.test.sql`, `scenarios.test.sql`, `test:api` |
| 2 Planung, Konflikte, Nebenläufigkeit | `visit_operations.test.sql`, `scenarios.test.sql`, `test:api` |
| 3 Warten auf Teile, Folgeeinsatz, Abschluss | `scenarios.test.sql`, `work_operations.test.sql` |
| 4 Abrechnung, Wartung, Tarifänderung, Warteschlange, Versand nach Zahlung | `invoice_message_operations.test.sql`, `scenarios.test.sql` |
| 5 Automatisierungskennzahlen, 100 × 5 Minuten | folgt mit Analytik (task-7-1) und Fixtures (task-3-3) |
| 6 Periodenvergleiche, Nullbasis | folgt mit Analytik (task-7-1) |
| 7 Historie aus Ereignissen, Fristen, Wiedereröffnung, Stornierung | `intake_operations.test.sql`, `scenarios.test.sql` |
| 8 Responsive-Prüfung | folgt mit den Oberflächen (Phasen 4–6, task-9-2) |
