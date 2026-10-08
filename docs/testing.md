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
| `visit_follow_up_photos.test.sql` | Folgeeinsatz beim Beenden eines Einsatzes, Registrierung von Einsatzfotos |
| `savings_fixture.test.sql` | Prüf-Fixture 100 × 15 Minuten = 25 h (Szenario 5, Teil) |
| `admin_operations.test.sql` | Verwaltung: nur Admin, keine direkten Tabellenschreibrechte, Rollenwechsel, Deaktivierung mit Neuzuweisung (Vertretung abwesend, laufender Einsatz), Reaktivierung, Tarife, Arbeitszeiten gegen geplante Einsätze, Abwesenheiten, Einstellungen nur für spätere Erstbearbeitungen |

`analytics.test.sql` (task-7-1) legt Fixtures im Jahr 2031 an und vergleicht Kennzahlen als Differenz vor und nach dem Anlegen, damit vorhandene Demodaten das Ergebnis nicht beeinflussen. Geprüft: Vergleichszeiträume, getrennte Zeitreihen nach `created_at`, `intake_completed_at` und `completed_at`, Zeitersparnis, Fristen, Rechnungs- und Zahlungsbeträge, Momentaufnahmen am Periodenende, Warteschlangenhistorie aus Ereignissen, Team, Automatisierung, Ablehnung für Dispatcher, Techniker und inaktive Manager, keine `security definer`-Funktion.

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
- Techniker-Seiten: für alle drei Demo-Techniker entspricht der nächste Einsatz der Datenbank (laufend vor geplant), bestellte Teile der eigenen Anfragen stehen unter „Ausstehende Teile“, der Kalender hat genau eine Zeile je Tag ohne Namen anderer Techniker und ohne Einsätze anderer Techniker; Dispatcher erreichen den Techniker-Kalender nicht;
- Einsatzplanung: „Zu planen“ entspricht der Planungs-Warteschlange (Dispatcher eigene, Manager alle), Techniker ohne Zugriff; im Kalender des Dispatchers erscheinen fremde Einsätze der laufenden Woche nur als „Belegt“ ohne Nummer oder Firma, eigene mit Anfragenummer, Abwesenheitsgründe nirgends;
- Prüfaktionen: Techniker sehen keinen Aktionsblock; Manager sehen ihn bei offener Prüfung, mit „Als Entwurf speichern“ und ohne Senden-Knopf;
- Warteschlangen: für alle drei Demo-Dispatcher entsprechen Anzahl und Reihenfolge jedes Tabs der View `dispatcher_queue`; Manager wird umgeleitet; automatisch bearbeitete, ungeplante Anfragen stehen in der Planung;
- Dokumente: Manager lädt die interne Notiz (`management`), der Dispatcher der Anfrage sieht und lädt sie nicht, anonym 401; der Techniker der Anfrage lädt ein operatives Dokument, ein anderer Techniker nicht.

Temporäre Konten (`e2e-…@example.com`) werden am Ende wieder gelöscht. Das Skript bricht ab, wenn App oder Supabase nicht lokal sind.

Der „andere Techniker“ beim Dokument-Download ist ein Demo-Techniker ohne Bezug zur Anfrage (weder zugewiesen noch mit einem Einsatz darauf), da Einsätze Lesezugriff gewähren und die Demo-Daten vom Zeitpunkt des Seeds abhängen.

Verwaltung (task-8-1): öffentliche Registrierung über die Auth-API abgewiesen; Unterseiten der Verwaltung für Admin 200, Manager auf seine Startseite; eigenes Konto ohne Deaktivierung, unbekannte Person 404.

Übersicht, Auswertung und Rechnungsliste (task-7-2, 7-3): Manager erhält die Seiten ohne Fehlermeldung; Dispatcher und Techniker werden auf ihre Startseite umgeleitet. Die Navigation von Admin und Manager enthält „Auswertung“ und „Rechnungen“.

## Unit-Tests (`npm run test:unit`)

Laufen ohne App und Datenbank (`node --test` mit dem Test-Resolver `tests/unit/ts-resolve.mjs`, der TypeScript-Importe ohne Endung auflöst). Prüfen die Formatierung in `Europe/Berlin` einschließlich Zeitumstellung und Jahreswechsel, Beträge, Dauer, leere Werte, dass jeder Status Text und Ton hat sowie die Formular- und Fehlerhilfen und die Beschreibung der Verlaufsereignisse. `admin.test.mjs` prüft die Verwaltungshilfen (Wochenformular, Zusammenfassung der Arbeitszeit, Abwesenheit als ganze Tage über die Zeitumstellung, Kontoprüfung, Dezimaleingabe, Firmenangaben). `kpi-dictionary.test.mjs` hält die Dokumentation synchron: jede Kennzahl der Übersicht mit Art (Ereignis/Momentaufnahme) und jedes Zeitreihenfeld steht im Kennzahlen-Wörterbuch, der n8n-Vertrag enthält alle Abläufe aus Abschnitt 8, und als „vorhanden“ bzw. „zu bauen“ markierte Funktionen entsprechen den Migrationen. `analytics.test.mjs` prüft Zeitraum-Parameter, Titel (inkl. Kalenderwochen am Jahreswechsel), Bereiche, Werte je Einheit, Änderungen (Prozent, Punkte, Null-Basis ohne Prozentwert, fachliche Richtung) und dass jede Kennzahl Definition und Listen-Link hat. `insights.test.mjs` prüft die Diagrammdaten (kumulierter Vergleich, Saisonalität ohne erfundene Nullen, Automatisierung je Monat, Warteschlangen in breiter Form, Farbreihenfolge). `invoice-pdf.test.mjs` prüft das Rechnungs-PDF über den Test-Hook `onText` (eingebettete Schriften kodieren Glyphen, der Text ist nicht direkt lesbar): Kennzeichnung und Rechnungsdaten, Folgeseiten mit Übertrag und Positionsbereich, byte-identische Ausgabe, kein PDF für Entwürfe, Zeichen außerhalb des Schrift-Subsets, Ergänzung der Anfragenummer bei älteren Snapshots. Ergebnis ist unabhängig von der Zeitzone des Rechners (geprüft mit `TZ=America/New_York`).

## UI-Prüfung (`npm run test:ui`)

Voraussetzung wie bei `test:auth` sowie Google Chrome (anderer Pfad über `CHROME_PATH`). Das Skript meldet die Demo-Rollen über das echte Login-Formular an und steuert Chrome über das DevTools-Protokoll:

- alle Dashboard-Bereiche je Rolle sowie Anfrageliste, eine Anfrageseite (Manager, Techniker) und die Warteschlangen-Tabs (Dispatcher) bei 390×844, 768×1024 und 1440×900: Seitenbreite nicht größer als das Fenster;
- Formular unter `/dashboard/bausteine`: Validierungsfehler und simulierter Versionskonflikt behalten alle Eingaben, markieren die Felder und setzen den Fokus; erfolgreiches Speichern zeigt „Gespeichert · HH:MM“.

- Prüfaktionen (task-5-2) als temporärer Dispatcher auf eigener Testanfrage, jeweils gegen die Datenbank geprüft: Korrektur ohne Grund behält die Auswahl, Korrektur markiert den Analyse-Lauf; E-Mail vorbereiten erzeugt nur einen Entwurf; Entwurf bearbeiten und direkt danach in die Warteschlange stellen (zweite Aktion mit aktualisierter Version); `sent_at` bleibt leer und die Oberfläche zeigt „In Warteschlange, nicht versendet“; Freigabe setzt `processed`/`human_review` und die Planungs-Warteschlange; Versionskonflikt beim Ablehnen behält den Grund und ändert nichts; Ablehnung danach erfolgreich.

- Einsatzplanung (task-5-3) in einer zufälligen Woche ab 2030: Klick in die Zeile eines Technikers übernimmt Techniker, Datum und 09:00–11:00; Buchung landet mit korrekter UTC-Umrechnung in der Datenbank, erscheint im Kalender und verlässt „Zu planen“; überschneidende Buchung einer zweiten Anfrage wird mit verständlicher Meldung abgelehnt (Eingaben bleiben, kein Einsatz); Buchung außerhalb der Arbeitszeit abgelehnt; direkt anschließender Termin möglich.

- Einsatzaktionen (task-6-2) als temporärer Techniker, jeweils gegen die Datenbank: fremder Techniker erhält 404; Arbeit starten; 1,5 h Arbeitszeit nach Tarif; Teil bestellt mit 48,90 €, dann verbaut; JPEG-Foto landet im privaten Bucket mit Metadaten, ist nicht öffentlich abrufbar und über die App ladbar; PDF als Foto abgelehnt; auf Teile warten und fortsetzen; Beenden mit Folgeeinsatz ohne Grund scheitert (Bericht bleibt), mit Grund: Einsatz beendet, Anfrage nicht abgeschlossen und wieder in der Planung.

- Abschluss und Rechnung (task-6-3) auf derselben Anfrage als Techniker: „Anfrage abschließen“ ist mit dem Bericht des letzten Einsatzes vorbelegt; ohne Bericht abgelehnt; Abschluss durch den Techniker (Ereignis `work_completed` mit seiner ID, keine Managerfreigabe); PDF vor Rechnung und für den Entwurf 404, kein PDF-Link; Ausstellung vergibt `RE-JJJJ-NNNNN` mit Arbeitszeit und verbautem Teil; PDF-Download 200 `application/pdf`, `no-store`, Dateiname mit Nummer, Titel „Musterrechnung / Demodaten <Nummer>“; ohne Anmeldung 401, fremder Techniker 404; nach Erhöhung des Stundensatzes ist das PDF byte-identisch (Tarif wird danach zurückgesetzt).

- Manager-Übersicht (task-7-2) als Demo-Manager: 16 Kennzahlen mit Listen-Link, Kennzeichnung Ereignis/Momentaufnahme; für Eingänge, Erstbearbeitung, Abschlüsse, offene Anfragen, ausgestellte Beträge, Zahlungseingang, offene und überfällige Forderungen entspricht die Anzahl bzw. Bruttosumme der verlinkten Liste dem Kennzahlwert; Zeitraum-Pfeil zurück führt zum vollständigen Vormonat mit Weiter-Pfeil. Übersicht (Monat, Jahr) und Rechnungsliste ohne horizontales Scrollen in allen drei Breiten.

- Auswertung (task-7-3) als Demo-Manager: sieben Diagramme mit SVG-Markierungen und Datentabelle; Eingänge des laufenden Monats in der Tabelle entsprechen einer direkten Zählung in der Datenbank (Monatsbeginn Europe/Berlin); Hover über eine Säule der Zeitersparnis zeigt „N Anfragen × Basiswert 15 min“. Seite ohne horizontales Scrollen in allen drei Breiten.

- Verwaltung (task-8-1) als Demo-Admin, jeweils gegen Datenbank bzw. Supabase Auth: Techniker und Dispatcher über das Formular angelegt (Profil ohne Passwortfeld, Anmeldung möglich); doppelte Adresse und zu kurzes Passwort abgewiesen; Wochenarbeitszeit mit Ende vor Beginn abgewiesen, Mo–Fr gespeichert und in der Übersicht zusammengefasst; Dispatcher mit offener Anfrage: Zuweisung angezeigt, Deaktivieren ohne Vertretung abgewiesen, mit Vertretung Anfrage übertragen, Profil inaktiv, Anmeldung gesperrt; Reaktivierung gibt sie frei; Tarif mit Komma-Preis angelegt, geändert und deaktiviert; Basiswert 0 abgewiesen, Änderung mit Autor gespeichert und wieder zurückgesetzt; Testkonten am Ende ohne Vertretung deaktiviert. Alle Verwaltungsseiten, auch die Personenseite eines Technikers, ohne horizontales Scrollen.

Mit `UI_SCREENSHOTS=<Ordner>` wird je Seite und Breite ein Screenshot gespeichert, zusätzlich Aktionen und Rechnungsabschnitt (390, 1440) sowie das erzeugte PDF.

`test:ui` und `test:api` legen Testanfragen mit `is_demo = true` an; `npm run demo:seed` entfernt sie samt Einsatzfotos wieder (Testnutzer bleiben bis `supabase db reset`).

## Szenarien der Spezifikation (Abschnitt 10)

| Szenario | Abgedeckt durch |
| --- | --- |
| 1 Berechtigungen | `rls.test.sql`, `scenarios.test.sql`, `test:api` |
| 2 Planung, Konflikte, Nebenläufigkeit | `visit_operations.test.sql`, `scenarios.test.sql`, `test:api` |
| 3 Warten auf Teile, Folgeeinsatz, Abschluss | `scenarios.test.sql`, `work_operations.test.sql` |
| 4 Abrechnung, Wartung, Tarifänderung, Warteschlange, Versand nach Zahlung | `invoice_message_operations.test.sql`, `scenarios.test.sql` |
| 5 Automatisierungskennzahlen, 100 × 15 Minuten | `savings_fixture.test.sql` (Formel), `analytics.test.sql` (Zeitersparnis nur für korrekte automatische Erstbearbeitung, Detail mit Anzahl und Basiswert) |
| 6 Periodenvergleiche, Nullbasis | `analytics.test.sql` (unvollständige Monate, kürzerer Februar, Woche, Quartal, Nullbasis ohne Prozentwert) |
| 7 Historie aus Ereignissen, Fristen, Wiedereröffnung, Stornierung | `intake_operations.test.sql`, `scenarios.test.sql` |
| 8 Responsive-Prüfung | folgt mit den Oberflächen (Phasen 4–6, task-9-2) |
