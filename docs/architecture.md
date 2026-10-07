# Architektur

## Überblick

- **Frontend und Server:** Next.js 16 (App Router) im Repository-Root. Öffentliche Website und Mitarbeiterbereich `/dashboard` werden über Route Groups getrennt.
- **Daten:** Supabase Postgres mit 13 Kerntabellen (`profiles`, `requests`, `messages`, `visits`, `work_entries`, `invoices`, `invoice_items`, `attachments`, `request_events`, `automation_runs`, `service_rates`, `employee_availability`, `settings`).
- **Berechtigung:** Supabase Auth; Rolle und Aktivstatus in `profiles`; Durchsetzung über RLS und kontrollierte RPC-Funktionen. Ausgeblendete UI-Elemente gelten nicht als Berechtigung.
- **Dateien:** privater Supabase-Storage-Bucket für Dashboard-Dateien; Website-Formularanhänge bleiben vorerst in Vercel Blob.
- **Integrationen:** Website-Formular → Make (bestehend, unverändert). n8n und Gmail folgen in einer späteren Stufe; der Vertrag wird in Phase 9 dokumentiert.

## Supabase-Anbindung

| Datei | Zweck |
| --- | --- |
| `lib/supabase/client.ts` | Browser-Client (Publishable Key, Sitzung aus Cookies) |
| `lib/supabase/server.ts` | Server-Client für Server Components, Server Actions und Route Handler; handelt mit den Rechten des angemeldeten Nutzers (RLS greift). Pro Anfrage neu erzeugen. |
| `lib/supabase/admin.ts` | Admin-Client mit `SUPABASE_SECRET_KEY`; umgeht RLS. `server-only`, nur für kontrollierte Serveroperationen und Skripte. |
| `lib/supabase/proxy.ts`, `proxy.ts` | Next.js-16-Proxy: erneuert die Sitzung und schreibt Cookies samt `Cache-Control: private, no-store`. Läuft nur auf `/dashboard`, `/login` und `/auth/*`. |
| `lib/supabase/env.ts` | Liest und prüft die Umgebungsvariablen. |

Der Proxy schützt keine Routen. Zugriffskontrolle erfolgt serverseitig in jeder Dashboard-Seite (siehe unten) und in der Datenbank (RLS).

## Routen und Anmeldung

| Pfad | Datei | Zweck |
| --- | --- | --- |
| alle Website-Pfade | `app/(site)/[[...slug]]/page.tsx`, `app/(site)/layout.tsx` | Öffentliche Website mit `SiteShell` (Kopf, Fuß, Assistent); unverändert |
| `/login` | `app/(dashboard)/login/page.tsx` | Anmeldung mit E-Mail und Passwort, keine Registrierung |
| `/dashboard` | `app/(dashboard)/dashboard/page.tsx` | Leitet zur Startseite der Rolle |
| `/dashboard/<bereich>` | `app/(dashboard)/dashboard/*/page.tsx` | Rollenbereiche, Kopfzeile und Navigation aus `layout.tsx` |

`app/layout.tsx` enthält nur `<html>`, Schriften und globale Styles. Die Route Group `(site)` legt die Website-Hülle darum, `(dashboard)` eine eigene Dashboard-Hülle; Gruppen verändern keine URL.

- **Sitzung (`lib/auth/session.ts`, `server-only`):** `getSession()` prüft das JWT mit `getClaims()` und lädt das eigene Profil (pro Anfrage gecacht). Weil RLS Profile nur aktiven Mitarbeitenden liefert, gelten fehlendes und deaktiviertes Profil gleich: kein Zugang. `requireEmployee()` leitet sonst zu `/login`, `requireRole()` leitet fremde Rollen zur eigenen Startseite.
- **Prüfung je Seite:** Jede Dashboard-Seite ruft `requireEmployee()` oder `requireRole()` selbst auf, weil Layouts bei Client-Navigation nicht neu gerendert werden. Eine Deaktivierung wirkt beim nächsten Seitenaufruf.
- **Bereiche (`lib/auth/roles.ts`):** einzige Quelle für Navigation, Startseiten und erlaubte Rollen.

| Rolle | Startseite | Navigation |
| --- | --- | --- |
| Admin | Verwaltung | Übersicht, Anfragen, Verwaltung |
| Manager | Übersicht | Übersicht, Einsatzplanung, Anfragen |
| Dispatcher | Erstbearbeitung | Erstbearbeitung, Einsatzplanung, Anfragen |
| Techniker | Mein Tag | Mein Tag, Kalender, Anfragen |

- **Anmelden/Abmelden (`lib/auth/actions.ts`):** Server Actions; das Formular funktioniert auch ohne JavaScript. Unbekannte Adresse und falsches Passwort ergeben dieselbe Meldung. Angemeldete Konten ohne aktives Profil sehen auf `/login` einen Hinweis und „Abmelden“.
- **Zwischenspeicherung:** Antworten unter `/login`, `/dashboard` und `/auth/*` tragen `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` (Proxy) und `robots: noindex`.

Entwicklung gegen den lokalen Supabase-Stack (`supabase start`, Docker). Schemaänderungen ausschließlich als Migrationen unter `supabase/migrations/`. Verbindungsprüfung: `npm run supabase:check`. Tabellen, Enums und Nullability: [database.md](database.md). Tests: [testing.md](testing.md).

## UI-Bausteine (task-4-2)

Gemeinsame Bausteine aller Dashboard-Bereiche; Übersicht mit Beispielwerten unter `/dashboard/bausteine` (nur Admin, nicht in der Navigation, ohne Datenbankzugriff).

| Datei | Inhalt |
| --- | --- |
| `lib/format.ts` | de-DE-Formatierung in `Europe/Berlin`: Datum, Uhrzeit, Zeitraum, Kalenderdatum (ohne Zeitzonenverschiebung), Betrag, Zahl, Anteil, Dauer (`25 h 0 min`); leere Werte als `–`. Unabhängig von der Server-Zeitzone. |
| `lib/status.ts` | Deutsche Bezeichnungen und Ton (neutral, info, progress, success, warning, danger) für alle Status-Enums sowie Bezeichnungen sonstiger Enums. `queued` heißt „In Warteschlange, nicht versendet“, nur `sent` gilt als bestätigter Versand. |
| `lib/forms.ts` | Ergebnisvertrag aller Speicheraktionen (`FormState` mit Meldung, Feldfehlern und eingereichten Werten) und Übersetzung der Datenbankfehler `42501`, `RW409`, `RW410`, `RW422`. |
| `components/dashboard/ui/status-badge.tsx` | Statusanzeige mit Text, Farbpunkt und Rahmen; nie Farbe allein. |
| `components/dashboard/ui/data-table.tsx` | Tabelle ab 768 px, darunter Karten mit Feldbezeichnungen (dasselbe Markup); `CardList` für kurze Listen. |
| `components/dashboard/ui/states.tsx` | Seitenkopf, Leer-, Fehler- und Ladezustand. |
| `components/dashboard/ui/save-form.tsx` | Formular mit Speicherzustand („Ungespeicherte Änderungen“, „Wird gespeichert …“, „Gespeichert · HH:MM“, Fehlermeldung) und Feldern mit Fehlertext und `aria-invalid`. |
| `app/(dashboard)/dashboard/error.tsx` | Fehlergrenze aller Bereiche mit „Erneut versuchen“. |

- **Eingaben bleiben erhalten:** `SaveForm` sendet ohne Reacts automatischen Formular-Reset; nach einem Fehler bleiben alle Eingaben stehen, der Fokus springt zum ersten fehlerhaften Feld. Zurücksetzen nur ausdrücklich mit `resetOnSuccess`.
- **Laden:** kein `loading.tsx` für das ganze Dashboard, sonst würden Zugriffs-Weiterleitungen gestreamt statt als HTTP 307 gesendet. Langsame Teile einer Seite laufen nach der Zugriffsprüfung in `<Suspense fallback={<LoadingState />}>`.
- **Gestaltung:** ausschließlich RheinWerk-Tokens (`--rw-*`) aus `_ds/`; Formularfelder und Buttons nutzen die vorhandenen Klassen `field` und `button`.

## Anfrageliste und Anfrageseite (task-4-3)

| Pfad | Inhalt |
| --- | --- |
| `/dashboard/anfragen` | Liste mit Suche (Nummer, Firma, Kontakt, Ort) und Filtern Erstbearbeitung, Arbeit, Priorität; 25 je Seite; Filter stehen in der URL (`?suche=…&erstbearbeitung=…&arbeit=…&prioritaet=…&seite=…`), funktionieren ohne JavaScript |
| `/dashboard/anfragen/[id]` | Anfrageseite mit stabiler URL je Anfrage |
| `/dashboard/anfragen/[id]/dokumente/[attachmentId]` | Download eines Dokuments (Route Handler) |

- **Daten (`lib/dashboard/requests.ts`):** alle Abfragen mit dem Server-Client des angemeldeten Nutzers; welche Anfragen, Nachrichten, Ereignisse und Dokumente erscheinen, entscheidet RLS (Manager/Admin alle, Dispatcher aktuell zugewiesene, Techniker zugewiesene und solche mit eigenem Einsatz). Unbekannte und nicht freigegebene IDs ergeben gleichermaßen 404.
- **Abschnitte je Rolle:**

| Abschnitt | Admin, Manager, Dispatcher | Techniker |
| --- | --- | --- |
| Zusammenfassung, Kontakt, Anlage, Einsätze, Arbeit, Dokumente, Rechnung, Verlauf | ja | ja (Inhalte nach RLS) |
| Erstbearbeitung (inkl. Automatisierungsläufe), Korrespondenz | ja | nein – weder abgefragt noch angezeigt; RLS liefert Technikern ohnehin keine Nachrichten und Läufe |

  Verlauf und Dokumente zeigen nur Einträge, deren Sichtbarkeitsstufe die Rolle lesen darf (`operational`/`dispatch`/`management`). Schlägt ein Teil fehl, zeigt nur der betroffene Abschnitt einen Fehler.
- **Dokumente:** Der Route Handler liest die `attachments`-Zeile und die Datei mit den Rechten des Nutzers und streamt sie durch die App (`private, no-store`, `nosniff`); keine Storage-URL verlässt den Server.
- **Verlauf (`lib/events.ts`):** deutsche Bezeichnungen der Ereigniscodes; Statuswerte, Personen, Zeiträume und Korrekturen werden lesbar dargestellt.
- **Typen:** `lib/supabase/database.types.ts`, erzeugt mit `npm run db:types` aus dem lokalen Schema; alle Supabase-Clients sind damit typisiert. Nach Schemaänderungen neu erzeugen.

## Dispatcher-Warteschlangen (task-5-1)

`/dashboard/erstbearbeitung` (nur Dispatcher) zeigt die Tabs Prüfung erforderlich, Kundenantwort erhalten, Einsatzplanung erforderlich, Warten auf Kundenantwort und Alle meine Anfragen (`?tab=pruefung|antwort|planung|warten|alle`) mit Anzahl je Tab. Daten aus der View `dispatcher_queue` (Regeln und Sortierung: [database.md](database.md)), gefiltert auf den angemeldeten Dispatcher; `lib/dashboard/queues.ts`. Spalten: Priorität (vor der Festlegung die Kundendringlichkeit), Frist mit „Überfällig“, Wartezeit, Hinweise (Sicherheitsgefahr, Folgeeinsatz, automatisch bearbeitet, Analyse läuft). „Alle meine Anfragen“ ist nach Eingang sortiert und seitenweise.

## Prüfaktionen und E-Mail-Entwürfe (task-5-2)

Block „Aktionen“ auf der Anfrageseite (`components/dashboard/request-actions.tsx`) für Dispatcher, Manager und Admins; Server Actions in `app/(dashboard)/dashboard/anfragen/[id]/actions.ts`. Jede Aktion ruft genau eine kontrollierte Datenbankoperation aus Phase 2 mit den Rechten des Nutzers und der angezeigten `version` auf und lädt die Seite danach neu (`refresh()`).

| Aktion | Sichtbar, wenn | Operation |
| --- | --- | --- |
| Prüfen und freigeben (Priorität Pflicht) | Erstbearbeitung `new`/`analyzing`/`needs_review` | `complete_intake` |
| Analyse korrigieren (Priorität/Leistungsart, Grund Pflicht) | Anfrage nicht abgeschlossen | `correct_analysis`, markiert den letzten erfolgreichen Analyse-Lauf als korrigiert |
| E-Mail an Kunden vorbereiten (Rückfrage mit Vorlage oder sonstige Nachricht) | Anfrage nicht abgeschlossen | `create_message_draft` |
| Entwurf bearbeiten / In Warteschlange stellen (unter Korrespondenz) | Nachricht im Status `draft` | `update_message_draft`, `queue_message` |
| Auf Kundenantwort warten | Erstbearbeitung offen | `mark_awaiting_customer` |
| Anfrage ablehnen (Grund Pflicht) | vor Arbeitsbeginn | `reject_request` |

- **Kein Versand:** Das Dashboard erzeugt nur Entwürfe und Warteschlangeneinträge. Texte und Status lauten „Entwurf (nicht versendet)“ und „In Warteschlange, nicht versendet“; „Versand bestätigt“ erscheint nur, wenn die spätere Integration den Versand per `confirm_message_sent` meldet. Es gibt keinen Senden-Knopf.
- **Fehler:** Versionskonflikt (`RW409`), Zustandsfehler (`RW422`) und fehlende Berechtigung (`42501`) erscheinen als Meldung im Formular; alle Eingaben bleiben erhalten.
- **Techniker** sehen den Block nicht; die Operationen lehnen sie zusätzlich in der Datenbank ab.

## Einsatzplanung (task-5-3)

`/dashboard/planung` (Dispatcher, Manager): links „Zu planen“ (Planungs-Warteschlange aus `dispatcher_queue`, Dispatcher nur eigene), rechts das Buchungsformular für die gewählte Anfrage (`?anfrage=`), darunter die Woche (`?woche=YYYY-MM-DD`, Navigation vor/zurück/heute). Daten: `lib/dashboard/planning.ts`; Buchung: Server Action `scheduleVisit` → `schedule_visit`.

- **Belegung:** `technician_busy_intervals` liefert alle reservierenden Einsätze und Abwesenheiten ohne Details. Nur Einsätze, die der Nutzer per RLS ohnehin lesen darf, erhalten Anfragenummer und Link; fremde erscheinen als „Belegt“, Abwesenheiten als „Nicht verfügbar“ (ohne Grund). Arbeitszeiten (`working_hours`) zeigen außerhalb liegende Zeit grau.
- **Konflikte** prüft ausschließlich die Datenbank (Exclusion Constraint, Arbeitszeit, Abwesenheit, Vergangenheit, Sicherheitsprüfung). `RW410` erscheint als „Der Techniker hat in diesem Zeitraum bereits einen Einsatz. Bitte im Kalender einen freien Zeitraum wählen.“; Eingaben bleiben erhalten.
- **Zeit:** Formular in Berliner Ortszeit; `berlinToInstant` rechnet in UTC um (Sommer-/Winterzeit). Kalenderwahl siehe [decisions.md](decisions.md).

## Techniker-Startseite und Wochenkalender (task-6-1)

Nur Techniker; Daten `lib/dashboard/technician.ts`, Karten `components/dashboard/visit-card.tsx` (Zeit, Status, Kunde, Adresse mit Kartenlink, Kontakt mit Telefonlink, Anlage, Sicherheitsgefahr, Beschreibung).

- **`/dashboard/heute` – Mein Tag:** laufender Einsatz, sonst der nächste geplante; alle Einsätze des Tages (Europe/Berlin); „Ausstehende Teile“: bestellte Teile der eigenen aktuellen Anfragen und wegen Teilen pausierte Einsätze.
- **`/dashboard/kalender` – Kalender:** eigene Woche in der Zeitstrahl-Ansicht der Planung (nur eine Zeile, eigene Arbeitszeiten und Abwesenheiten), erledigte und pausierte Einsätze gedämpft mit Status; darunter dieselben Einsätze als Karten (mobil die Hauptansicht).
- **Nur eigene Daten:** Alle Abfragen filtern zusätzlich zu RLS auf `technician_id` des angemeldeten Technikers, denn RLS zeigt Technikern auch Einsätze anderer Techniker auf ihren aktuellen Anfragen. Die Belegung anderer Techniker wird nicht abgefragt.

## Einsatzaktionen und Arbeitserfassung (task-6-2)

`/dashboard/einsatz/[visitId]` – Arbeitsbereich eines Einsatzes für den eingeplanten Techniker (andere Techniker: 404), Manager und Admins; erreichbar über „Einsatz öffnen“ auf den Techniker-Seiten und „Öffnen“ in der Einsatz-Tabelle der Anfrageseite. Daten `lib/dashboard/visit.ts`, Server Actions im Routenordner.

| Bereich | Aktion | Operation |
| --- | --- | --- |
| Einsatz | Arbeit starten / Auf Teile warten (Grund) / Fortsetzen | `start_visit`, `wait_for_parts`, `resume_visit` |
| Einsatz | Einsatz beenden: Arbeitszeit in Minuten (Vorschlag: Zeit seit Start, bei über 12 h die geplante Dauer), Bericht (Pflicht), optional Folgeeinsatz mit Grund | `complete_visit` |
| Arbeit und Teile | Arbeitszeit (Stunden, Tarif der Leistungsart), Pauschale (einmal je Anfrage), Teil (Menge, Preis, bestellt/verbaut); Teil als verbaut markieren, Position stornieren | `add_work_entry`, `set_work_entry_status` |
| Fotos | JPEG/PNG bis 10 MB hochladen, Vorschau | Upload + `add_visit_photo` |

- **Fotos:** Die Server Action prüft Größe und Dateisignatur (JPEG/PNG), prüft per RLS den Zugriff auf den Einsatz, lädt die Datei mit dem Server-Schlüssel in den privaten Bucket `dashboard` (`visits/<request_id>/<visit_id>/<uuid>.jpg`) und lässt sie von `add_visit_photo` mit den Rechten des Nutzers registrieren; scheitert das, wird die Datei sofort gelöscht. Anzeige und Download über die App-Route mit Nutzerrechten. Server-Action- und Proxy-Limit: 11 MB (`next.config.ts`).
- **Einsatz beenden schließt die Anfrage nicht;** der Abschluss folgt in task-6-3.
- Nach ausgestellter Rechnung oder bei abgeschlossener Anfrage sind keine Positionen mehr änderbar (Datenbank-Sperre, Oberfläche blendet die Formulare aus).

