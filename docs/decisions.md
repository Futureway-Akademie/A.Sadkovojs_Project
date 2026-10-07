# Entscheidungen

## 2026-10-07 – Website-Code im Workshop-Repository

### Kontext

Das Workshop-Repository enthielt nur die Workshop-Struktur; die Website liegt als separates Projekt vor.

### Entscheidung

Der Website-Code wird ohne Git-Historie in dieses Repository übernommen (Quelle `FuzzCube/rheinwerk-industrieservice`, Commit `39d9936`) und das Dashboard im selben Next.js-Projekt unter `/dashboard` umgesetzt.

### Begründung

Die Spezifikation verlangt das Dashboard im bestehenden Website-Projekt; Fortschritt soll zugleich im Workshop-Dashboard sichtbar sein.

## 2026-10-07 – Markenname RheinWerk

### Kontext

Die Spezifikation nennt „Rheinberg Industry Service“, Website und Designsystem verwenden „RheinWerk Industrieservice“.

### Entscheidung

Das Dashboard verwendet den Namen und das Designsystem von RheinWerk.

### Begründung

Einheitliches Erscheinungsbild mit der bestehenden Website.

## 2026-10-07 – Formularpfad bleibt bei Make

### Kontext

Das Formular leitet Anfragen derzeit über `/api/service-request` an Make weiter; die Spezifikation beschreibt eine künftige n8n-Anbindung und verbietet eine vorläufige direkte Speicherung in Supabase.

### Entscheidung

Der bestehende Pfad bleibt unverändert. Der n8n-Ein-/Ausgabevertrag wird nur dokumentiert.

### Begründung

Vorgabe der Spezifikation; die Umstellung gehört zu einer späteren Stufe.

## 2026-10-07 – Entwicklung gegen lokales Supabase

### Kontext

Für die Supabase-Anbindung wird ein Projekt benötigt. Ein Cloud-Projekt ist noch nicht verknüpft; die Supabase CLI und Docker sind lokal vorhanden.

### Entscheidung

Entwicklung gegen den lokalen Supabase-Stack. Alle Schemaänderungen, RLS-Richtlinien und Storage-Buckets entstehen ausschließlich als Migrationen unter `supabase/migrations/`, keine manuellen Änderungen über Studio. Demo-Nutzer werden per Skript angelegt. Die spätere Übernahme in ein Cloud-Projekt erfolgt über `supabase link` und `supabase db push`.

### Begründung

Schnelle, kostenlose und jederzeit zurücksetzbare Entwicklung (`supabase db reset`); Migrationen halten lokale und spätere Cloud-Datenbank identisch.

## 2026-10-07 – Proxy erneuert nur die Sitzung

### Kontext

Next.js 16 ersetzt Middleware durch `proxy.ts`. Die Next.js-Dokumentation rät davon ab, Proxy als vollständige Autorisierungslösung zu verwenden.

### Entscheidung

`proxy.ts` erneuert ausschließlich die Supabase-Sitzungscookies und läuft nur auf `/dashboard`, `/login` und `/auth/*`. Weiterleitungen und Zugriffsschutz erfolgen serverseitig in jeder Dashboard-Seite und über RLS.

### Begründung

Öffentliche Website und `/api/service-request` bleiben unverändert und ohne zusätzlichen Auth-Aufruf; Berechtigungen werden dort durchgesetzt, wo sie nicht umgangen werden können.

## 2026-10-07 – RLS nur lesend, Schreiben über kontrollierte Operationen

### Kontext

Die Spezifikation verlangt Berechtigungen in der Datenbank, Prüfung der Elternzugehörigkeit, Statusübergänge und Audit-Ereignisse in derselben Transaktion.

### Entscheidung

RLS-Richtlinien gewähren nur `SELECT`. Client-Rollen erhalten keine Schreibrechte auf Tabellen; alle Änderungen erfolgen über `security definer`-Funktionen (Phase 2). Zugriffs-Hilfsfunktionen liegen im nicht exponierten Schema `private`. Dispatcher sehen fremde Einsätze nur über `technician_busy_intervals`.

### Begründung

Schreibregeln (Übergänge, Audit, Nebenläufigkeit) lassen sich in Funktionen vollständig und atomar prüfen; Insert-/Update-Richtlinien könnten diese Regeln nicht abbilden und würden direkte API-Umgehungen ermöglichen.

## 2026-10-07 – Demo-Basiswert manuelle Erstbearbeitung 15 Minuten

### Kontext

Die Spezifikation nennt als Demo-Basiswert 5 Minuten aktive Bearbeitungszeit je Anfrage und eine Prüf-Fixture von 100 × 5 Minuten (8 h 20 min).

### Entscheidung

Auf Wunsch des Nutzers beträgt der Basiswert 15 Minuten: Default von `settings.manual_intake_minutes`, Demo-Einstellungen und Snapshots im Seed. Die Prüf-Fixture ergibt damit 100 × 15 = 1.500 Minuten (25 h). Die Formel `sum(manual_minutes_baseline) / 60` bleibt unverändert.

### Begründung

Der Basiswert ist laut Spezifikation eine konfigurierbare Demo-Annahme; 15 Minuten entsprechen der Einschätzung des Nutzers für Lesen, Entscheiden, Antworten und Pflegen im System.

## 2026-10-07 – Route Groups und Zugriffsprüfung je Seite

### Kontext

Die Website nutzt eine Catch-all-Route und eine Hülle mit Kopf, Fuß und Assistent im Root-Layout. Das Dashboard braucht eine eigene Hülle und einen serverseitigen Zugriffsschutz.

### Entscheidung

Website und Dashboard liegen in den Route Groups `(site)` und `(dashboard)` unter einem gemeinsamen Root-Layout ohne Hülle. Jede Dashboard-Seite prüft Sitzung und Rolle selbst über `lib/auth/session.ts`; das Layout lädt nur Name und Rolle für Kopfzeile und Navigation. Bereiche, Startseiten und erlaubte Rollen stehen zentral in `lib/auth/roles.ts`.

### Begründung

Website-URLs und -Ausgabe bleiben unverändert, und `/dashboard` gewinnt als statisches Segment vor der Catch-all-Route. Layouts werden bei Client-Navigation nicht neu gerendert, deshalb reicht eine Prüfung im Layout laut Next.js-Dokumentation nicht aus.

## 2026-10-07 – Anfrageseite liest mit Nutzerrechten, Dokumente über die App

### Kontext

Die Anfrageseite bündelt zehn Abschnitte mit unterschiedlich vertraulichen Daten (Korrespondenz, interne Notizen, Rechnungen).

### Entscheidung

Alle Abschnitte werden mit dem Server-Client des angemeldeten Nutzers gelesen, nie mit dem Admin-Client. Abschnitte, die eine Rolle laut RLS nicht lesen darf (Techniker: Erstbearbeitung, Korrespondenz), werden zusätzlich weder abgefragt noch angezeigt. Dokumente werden über einen Route Handler mit Nutzerrechten gestreamt statt über signierte Storage-URLs ausgeliefert.

### Begründung

Die Datenbank bleibt die einzige Quelle für Berechtigungen; ein Fehler in der Oberfläche kann keine Daten freigeben. Gestreamte Downloads tragen `no-store` und lassen sich nicht als Link weitergeben.

## 2026-10-07 – Eigene Kalenderansicht statt Kalenderbibliothek

### Kontext

Die Einsatzplanung braucht eine Wochenansicht mit allen Technikern nebeneinander (Ressourcen), Darstellung in Europe/Berlin unabhängig von der Zeitzone des Browsers und Auswahl eines Zeitraums. Geprüft am 07.10.2026 gegen React 19.2 (npm-Metadaten):

| Bibliothek | React 19 (peerDependencies) | Lizenz | Ergebnis |
| --- | --- | --- | --- |
| `@fullcalendar/react` 7.1.1 | `^17 \|\| ^18 \|\| ^19` | MIT | kompatibel; Ressourcen-Ansichten (`@fullcalendar/resource-timeline`) jedoch kommerziell lizenziert |
| `react-big-calendar` 1.20.0 | `^16.14 \|\| … \|\| ^19` | MIT | kompatibel; Ressourcen frei, Darstellung aber in der Zeitzone des Browsers (Localizer), Server- und Client-Ausgabe weichen außerhalb Deutschlands ab |
| `@schedule-x/react` 4.1.0 | `^16.7 \|\| … \|\| ^19` | MIT | kompatibel; Ressourcen-Planer als Premium-Plugin |

### Entscheidung

Eigene, schlanke Zeitstrahl-Ansicht (`components/dashboard/planning-calendar.tsx`) ohne zusätzliche Abhängigkeit: Tage untereinander, je Techniker eine Zeile 06–20 Uhr, Positionen über `lib/berlin-time.ts` in Europe/Berlin. Ein Klick in eine Zeile übernimmt Techniker, Datum und Uhrzeit in das Buchungsformular; das Formular bleibt die vollständige, tastaturbedienbare Eingabe.

### Begründung

Keine Lizenzkosten, keine Zeitzonenabweichung, keine Hydration-Unterschiede zwischen Server und Browser und volle Kontrolle darüber, dass fremde Intervalle keine Details zeigen. Alle drei Bibliotheken wären mit React 19 installierbar; bei Bedarf (z. B. Drag-and-drop) kann FullCalendar mit Lizenz nachgerüstet werden.

## 2026-10-07 – Einsatzfotos: Upload durch den Server, Registrierung per RPC

### Kontext

Der Bucket `dashboard` ist privat und hat bewusst keine Schreibrichtlinie für Nutzer. Fotos sollen nur zum eigenen Einsatz gespeichert werden können.

### Entscheidung

Die Server Action lädt die geprüfte Datei mit dem Server-Schlüssel unter einem zufälligen Namen im Einsatzpfad hoch; anschließend registriert `add_visit_photo` sie mit den Rechten des Nutzers (Rolle, eigener Einsatz, Status, Typ, Größe, Pfad, Existenz der Datei). Schlägt die Registrierung fehl, löscht der Server die Datei.

### Begründung

Berechtigung und Metadaten entstehen atomar in der Datenbank; der Server-Schlüssel schreibt nur unter einem Pfad, den die Datenbankfunktion anschließend validiert. Keine Storage-Schreibrechte für Clients, keine öffentlichen URLs.

