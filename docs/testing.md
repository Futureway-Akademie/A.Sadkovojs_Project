# Tests

Alle Prüfungen laufen gegen den lokalen Supabase-Stack. Voraussetzungen: Docker, `supabase start`, `.env.local` mit den Werten aus `supabase status` (siehe `.env.example`).

## Befehle

| Befehl | Prüft | Dauer |
| --- | --- | --- |
| `npm run lint` | ESLint | Sekunden |
| `npm run typecheck` | TypeScript | Sekunden |
| `npm run build` | Produktions-Build | ca. 30 s |
| `npm run test:unit` | Formatierung, Status- und Formularhilfen (`tests/unit/`, `node --test`) | Sekunden |
| `npm run test:db` | pgTAP-Tests unter `supabase/tests/database/` (`supabase test db`) | Sekunden |
| `npm run test:api` | Direkte REST-, RPC- und Storage-Aufrufe mit echten Logins, gleichzeitige Buchungen über HTTP (`scripts/test-api.mjs`) | ca. 10 s |
| `npm run test:auth` | Anmeldung, Rollen-Startseiten, Navigation, Bereichsschutz, Abmelden und Cache-Header über HTTP (`scripts/test-auth.mjs`); laufende App nötig | ca. 10 s |
| `npm run test:ui` | Headless Chrome: kein horizontales Scrollen bei 390/768/1440 px, Eingaben bleiben bei fehlgeschlagenem Speichern erhalten (`scripts/test-ui.mjs`); laufende App nötig | ca. 30 s |
| `npm run supabase:check` | Verbindung zum Supabase-Projekt | Sekunden |
| `npm run demo:verify` | Konsistenz des Demo-Seeds (`scripts/demo/verify-seed.sql`) | Sekunden |
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
| `dispatcher_queue.test.sql` | Warteschlangen der Dispatcher: Zuordnung, Sortierung, RLS |
| `savings_fixture.test.sql` | Prüf-Fixture 100 × 15 Minuten = 25 h (Szenario 5, Teil) |

## API-Tests (`npm run test:api`)

Legt pro Lauf eigene Nutzer über die Auth-Admin-API an (`api-…-<lauf>@example.com`), meldet sie mit Passwort an und prüft über die öffentliche API:

- **Szenario 1:** `anon` liest und ruft nichts auf; Techniker B liest weder Anfrage noch Dokument-Metadaten von A und lädt dessen Datei nicht herunter; direkte PATCH-/INSERT-Aufrufe mit gefälschtem Autor scheitern; keine Selbstbeförderung; Dispatcher A erreicht keine Anfrage von B; inaktive Profile handeln nicht; nur die Integration bestätigt E-Mail-Versand.
- **Szenario 2 (Nebenläufigkeit über HTTP):** 10 gleichzeitige `schedule_visit`-Aufrufe für dasselbe Zeitfenster ergeben genau eine Buchung und 9 × `RW410`; in 10 Durchläufen wird jeweils gleichzeitig gebucht und eine Abwesenheit eingetragen – nie gelingen beide.

Das Skript bricht ab, wenn `NEXT_PUBLIC_SUPABASE_URL` nicht auf `127.0.0.1`/`localhost` zeigt. Testdaten bleiben in der lokalen Datenbank, bis `supabase db reset` sie entfernt; wiederholte Läufe stören sich nicht.

## Anmelde-Tests (`npm run test:auth`)

Voraussetzung: lokaler Supabase-Stack, Demo-Nutzer (`npm run demo:users`) und laufende App (`npm run build && npm run start`; andere Adresse über `APP_URL`). Das Skript sendet das echte Login-Formular ohne JavaScript und prüft:

- je Demo-Rolle: Weiterleitung `/dashboard` → Startseite der Rolle, Name und Rollen-Navigation, keine Website-Kopfzeile, fremder Bereich → eigene Startseite, `/login` → `/dashboard`, unbekannter Pfad → Dashboard-404, Abmelden und danach kein Zugriff, `Cache-Control` privat und `no-store`;
- falsches Passwort und unbekannte Adresse: gleiche Meldung, keine Sitzung;
- Konto ohne Profil, deaktiviertes Profil und Deaktivierung während einer bestehenden Sitzung: kein Zugriff, Hinweis auf `/login`.

- Anfragen: Trefferzahl der Liste je Rolle stimmt mit der Datenbank überein (Manager alle, Dispatcher eigene, Techniker zugewiesene und mit eigenem Einsatz); Filter, Suche, ungültige Filterwerte und letzte Seite; Manager und Dispatcher sehen 10 Abschnitte, Techniker 8 ohne Erstbearbeitung und Korrespondenz und ohne Nachrichteninhalte im HTML; fremde und ungültige IDs ergeben 404;
- Warteschlangen: für alle drei Demo-Dispatcher entsprechen Anzahl und Reihenfolge jedes Tabs der View `dispatcher_queue`; Manager wird umgeleitet; automatisch bearbeitete, ungeplante Anfragen stehen in der Planung;
- Dokumente: Manager lädt die interne Notiz (`management`), der Dispatcher der Anfrage sieht und lädt sie nicht, anonym 401; der Techniker der Anfrage lädt ein operatives Dokument, ein anderer Techniker nicht.

Temporäre Konten (`e2e-…@example.com`) werden am Ende wieder gelöscht. Das Skript bricht ab, wenn App oder Supabase nicht lokal sind.

## Unit-Tests (`npm run test:unit`)

Laufen ohne App und Datenbank (`node --test` mit dem Test-Resolver `tests/unit/ts-resolve.mjs`, der TypeScript-Importe ohne Endung auflöst). Prüfen die Formatierung in `Europe/Berlin` einschließlich Zeitumstellung und Jahreswechsel, Beträge, Dauer, leere Werte, dass jeder Status Text und Ton hat sowie die Formular- und Fehlerhilfen und die Beschreibung der Verlaufsereignisse. Ergebnis ist unabhängig von der Zeitzone des Rechners (geprüft mit `TZ=America/New_York`).

## UI-Prüfung (`npm run test:ui`)

Voraussetzung wie bei `test:auth` sowie Google Chrome (anderer Pfad über `CHROME_PATH`). Das Skript meldet die Demo-Rollen über das echte Login-Formular an und steuert Chrome über das DevTools-Protokoll:

- alle Dashboard-Bereiche je Rolle sowie Anfrageliste, eine Anfrageseite (Manager, Techniker) und die Warteschlangen-Tabs (Dispatcher) bei 390×844, 768×1024 und 1440×900: Seitenbreite nicht größer als das Fenster;
- Formular unter `/dashboard/bausteine`: Validierungsfehler und simulierter Versionskonflikt behalten alle Eingaben, markieren die Felder und setzen den Fokus; erfolgreiches Speichern zeigt „Gespeichert · HH:MM“.

Mit `UI_SCREENSHOTS=<Ordner>` wird je Seite und Breite ein Screenshot gespeichert.

## Szenarien der Spezifikation (Abschnitt 10)

| Szenario | Abgedeckt durch |
| --- | --- |
| 1 Berechtigungen | `rls.test.sql`, `scenarios.test.sql`, `test:api` |
| 2 Planung, Konflikte, Nebenläufigkeit | `visit_operations.test.sql`, `scenarios.test.sql`, `test:api` |
| 3 Warten auf Teile, Folgeeinsatz, Abschluss | `scenarios.test.sql`, `work_operations.test.sql` |
| 4 Abrechnung, Wartung, Tarifänderung, Warteschlange, Versand nach Zahlung | `invoice_message_operations.test.sql`, `scenarios.test.sql` |
| 5 Automatisierungskennzahlen, 100 × 15 Minuten | `savings_fixture.test.sql` (Formel); Analytik-Funktionen folgen in task-7-1 |
| 6 Periodenvergleiche, Nullbasis | folgt mit Analytik (task-7-1) |
| 7 Historie aus Ereignissen, Fristen, Wiedereröffnung, Stornierung | `intake_operations.test.sql`, `scenarios.test.sql` |
| 8 Responsive-Prüfung | folgt mit den Oberflächen (Phasen 4–6, task-9-2) |
