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

