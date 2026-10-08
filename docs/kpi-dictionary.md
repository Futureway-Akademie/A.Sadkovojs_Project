# Kennzahlen-Wörterbuch

Verbindliche Definitionen aller Kennzahlen des Dashboards (Übersicht `/dashboard/uebersicht`, Auswertung `/dashboard/auswertung`). Grundlage sind die Datenbankfunktionen der Analytik (Migrationen `20261008090000_analytics.sql`, `20261008100000_analytics_complete_periods.sql`, `20261008110000_analytics_series_savings.sql`); die Texte der Oberfläche stehen in `lib/analytics.ts` (`KPI_INFO`). Ein Unit-Test (`tests/unit/kpi-dictionary.test.mjs`) stellt sicher, dass jede Kennzahl der Übersicht hier beschrieben ist.

## Grundregeln

| Regel | Festlegung |
| --- | --- |
| Zeitzone | Alle Zeiträume, Tage und Monate in `settings.timezone` (Europe/Berlin), Wochen beginnen montags |
| Zeitraum | halboffen `[Beginn, Ende)`; laufender Zeitraum endet beim Abruf (`as_of`) |
| Vergleich, laufender Zeitraum | gleiche verstrichene Zeit ab Beginn des Vorzeitraums, begrenzt auf dessen Ende (1.–8. Oktober 10:00 gegen 1.–8. September 10:00; ein fast vollständiger März gegen den ganzen Februar) |
| Vergleich, abgeschlossener Zeitraum | ganzer Vorzeitraum (September gegen alle 31 Tage des August) |
| Anzeige der Grenzen | Oberfläche zeigt beide Zeiträume mit Datum und ggf. Uhrzeit (`formatRange`) |
| Ereignis-Kennzahl | zählt Vorgänge nach ihrem eigenen Zeitstempel im Zeitraum |
| Momentaufnahme | Zustand unmittelbar vor dem Ende des Zeitraums (bzw. des Vergleichszeitraums), rekonstruiert aus der Statushistorie |
| Änderung | `difference = aktuell − Vorzeitraum`; `change_percent` nur für Anzahl, Beträge, Tage und Minuten |
| Null-Basis | Vorzeitraum `0` oder fehlend: kein Prozentwert (`null`), Oberfläche zeigt absolute Änderung und „Vorperiode 0 – kein Prozentwert“; nie „Infinity“ |
| Prozent-Kennzahlen | Änderung in Prozentpunkten („+21,9 Pkt.“), nie in Prozent |
| Nenner 0 | Prozent-Kennzahl ist `null` („–“), nicht 0 % |
| Richtung | „gut“/„schlecht“ nur, wo fachlich eindeutig (`KPI_INFO.better`); Eingänge und ausgestellte Beträge sind neutral |
| Demo-Daten | Demo- und Live-Anfragen werden gemeinsam gezählt; Demo-Rechnungen sind als Musterrechnungen gekennzeichnet |
| Zugriff | nur aktive Manager und Admins (`private.analytics_require_access()`), Funktionen laufen mit Nutzerrechten (`security invoker`) |
| Datenquelle | ausschließlich Datenbankzeilen und Ereignisse, keine fest codierten Reihen |

## Kennzahlen der Übersicht (`analytics_kpis`)

Spalten: **Art** E = Ereignis, M = Momentaufnahme. **Einheit** wie im Feld `unit`. **Liste** = Ziel des Links der Kachel; Anzahl bzw. Bruttosumme der Liste entspricht dem Kennzahlwert (Browser-Test).

### Anfragen und Bearbeitung

| Schlüssel | Bezeichnung | Art | Einheit | Definition | Zeitstempel | Liste |
| --- | --- | --- | --- | --- | --- | --- |
| `received` | Eingegangene Anfragen | E | Anzahl | neue Anfragen | `requests.created_at` | Anfragen, `feld=eingang` |
| `intake_completed` | Erstbearbeitung abgeschlossen | E | Anzahl | erster Abschluss der Erstbearbeitung, bearbeitet oder abgelehnt; je Anfrage höchstens einmal (Wiederholungen, Rückfragen und Läufe zählen nicht erneut) | `requests.intake_completed_at` | Anfragen, `feld=erstbearbeitung` |
| `automatic_share` | Anteil automatischer Erstbearbeitung | E | Prozent | `intake_mode = automatic` unter allen im Zeitraum abgeschlossenen Erstbearbeitungen; ein später korrigiertes automatisches Ergebnis bleibt automatisch (erstes Ergebnis), wird aber aus der Zeitersparnis ausgeschlossen; `detail`: `automatic`, `total` | `intake_completed_at` | Anfragen, `feld=erstbearbeitung&modus=automatic` |
| `completed` | Abgeschlossene Anfragen | E | Anzahl | technisch abgeschlossene Anfragen (`work_status = completed`); abgelehnte und stornierte zählen nie als Erfolg | `requests.completed_at` | Anfragen, `feld=abschluss` |
| `lead_time_days` | Durchlaufzeit bis Abschluss (Ø Tage) | E | Tage | Mittelwert `completed_at − created_at` der im Zeitraum abgeschlossenen Anfragen, eine Nachkommastelle; Wartezeiten sind enthalten; `detail.requests` | `completed_at` | Anfragen, `feld=abschluss` |
| `response_on_time` | Antwortfrist eingehalten | E | Prozent | Anfragen, deren `response_due_at` im Zeitraum liegt und bei denen `coalesce(first_substantive_response_at, intake_completed_at) ≤ response_due_at`; Eingangsbestätigungen zählen nicht als Antwort; ohne vereinbarte Frist nicht im Nenner; `detail`: `met`, `total` | `response_due_at` | Anfragen, `feld=antwortfrist` |
| `service_on_time` | Servicefrist eingehalten | E | Prozent | im Zeitraum abgeschlossene Anfragen mit `service_due_at`, abgeschlossen spätestens zur Frist; `detail`: `met`, `total` | `completed_at` | Anfragen, `feld=abschluss` |
| `time_saved_minutes` | Geschätzte Zeitersparnis | E | Minuten | Summe `manual_minutes_baseline` der Anfragen mit automatischem erstem Abschluss **ohne** Ereignis `automatic_result_corrected` und ohne korrigierten Automatisierungslauf (`automation_runs.corrected_at`); `detail`: `requests`, `baseline_min`, `baseline_max` | `intake_completed_at` | Anfragen, `feld=erstbearbeitung&modus=automatic` |
| `open_requests` | Offene Anfragen | M | Anzahl | weder abgelehnt, storniert noch technisch abgeschlossen | Statushistorie | Anfragen, `status=offen` |
| `review_queue` | Warteschlange Prüfung | M | Anzahl | `intake_status = needs_review` | Statushistorie | Anfragen, `erstbearbeitung=needs_review` |
| `planning_queue` | Warteschlange Einsatzplanung | M | Anzahl | `intake_status = processed` und `work_status` `not_planned` oder `waiting_parts` | Statushistorie | Einsatzplanung |

### Finanzen

Ausgestellt ist nicht eingenommen: ausgestellte Beträge und Zahlungseingänge sind getrennte Ereignisse.

| Schlüssel | Bezeichnung | Art | Einheit | Definition | Zeitstempel | Liste |
| --- | --- | --- | --- | --- | --- | --- |
| `invoiced_gross` | Ausgestellte Rechnungen (brutto) | E | EUR | Summe `invoices.total` der ausgestellten Rechnungen (auch später bezahlte); `detail.invoices` | `invoices.issued_at` | Rechnungen, `feld=ausgestellt` |
| `revenue_net` | Umsatz netto (ausgestellt) | E | EUR | Summe `invoices.subtotal` derselben Rechnungen | `issued_at` | Rechnungen, `feld=ausgestellt` |
| `payments_received` | Zahlungseingang (brutto) | E | EUR | Summe `invoices.total` der als bezahlt erfassten Rechnungen | `invoices.paid_at` | Rechnungen, `feld=bezahlt` |
| `open_receivables` | Offene Forderungen (brutto) | M | EUR | ausgestellt vor dem Stichtag und zu diesem Zeitpunkt nicht bezahlt | `issued_at`, `paid_at` | Rechnungen, `status=offen` |
| `overdue_receivables` | Überfällige Forderungen (brutto) | M | EUR | offene Forderungen mit `payment_due_date` vor dem lokalen Stichtag | `payment_due_date` | Rechnungen, `status=ueberfaellig` |

## Geschätzte Zeitersparnis

Bezeichnung in der Oberfläche: „Geschätzte Zeitersparnis bei der Anfragebearbeitung“.

- **Formel:** `Σ manual_minutes_baseline / 60` über die berechtigten Anfragen (siehe `time_saved_minutes`). Bei konstantem Basiswert = Anzahl × Basiswert.
- **Basiswert:** `settings.manual_intake_minutes`, Demo-Annahme 15 Minuten (Entscheidung in [decisions.md](decisions.md); die Spezifikation nannte 5). Er wird beim ersten Abschluss der Erstbearbeitung in `requests.manual_minutes_baseline` eingefroren; spätere Änderungen der Einstellung wirken nur auf spätere Abschlüsse.
- **Bedeutung:** aktive Bearbeitungszeit für Lesen, Entscheiden, Antworten und Pflegen der Anfrage; Reparatur- und Fahrzeiten sind nicht enthalten.
- **Ausschlüsse:** menschliche Bearbeitung oder Freigabe (`manual`, `human_review`), korrigierte automatische Ergebnisse, nicht abgeschlossene Anfragen.
- **Anzeige:** Kachel und Tooltip zeigen „N Anfragen × Basiswert“ mit dem höchsten Basiswert des Zeitraums (`baseline_max`); unterschiedliche Basiswerte nach einer Einstellungsänderung sind über `baseline_min` erkennbar, werden aber nicht getrennt angezeigt.
- **Prüf-Fixture:** 100 berechtigte Anfragen × 15 Minuten = 25 h (`savings_fixture.test.sql`).

## Automatisierung

| Kennzahl | Definition | Quelle |
| --- | --- | --- |
| Anteil automatisch | wie `automatic_share`; Grundgesamtheit sind eindeutige Anfragen (`request_id`), nicht Workflow-Ausführungen | `analytics_series`, `analytics_kpis` |
| Korrigiert | automatisch abgeschlossene Anfragen des Monats, die nicht zur Zeitersparnis zählen (`automatic_completed − saved_requests`) | `analytics_series` |
| Läufe je Schritt | Automatisierungsläufe im Zeitraum nach `step`, `status`, `decision`; davon korrigiert | `analytics_automation` (`started_at`) |
| Technischer Fehler | Lauf mit `status = failed`; eine normale Eskalation an Menschen (`decision = human_review`) ist **kein** Fehler | `analytics_automation` |
| Fehlentscheidung | Lauf mit `corrected_at` bzw. Ereignis `automatic_result_corrected`; getrennt von technischen Fehlern | `analytics_automation` |
| Noch nicht erstbearbeitet | Eingänge, deren Erstbearbeitung noch offen ist, zählen weder als Erfolg noch als Misserfolg; sichtbar als Warteschlangen „In Analyse“, „Prüfung“, „Wartet auf Kunde“ | `analytics_queue_history`, Momentaufnahme |

## Zeitreihen der Auswertung

`analytics_series(granularity, from_date, to_date)` liefert je Tag oder Monat (lokale Kalendergrenzen) dieselben Ereignisdefinitionen wie die Übersicht:

| Feld | Entspricht |
| --- | --- |
| `received` | `received` |
| `intake_completed` | `intake_completed` |
| `automatic_completed` | Zähler von `automatic_share` |
| `completed` | `completed` |
| `invoiced_gross` | `invoiced_gross` |
| `payments_received` | `payments_received` |
| `saved_requests`, `saved_minutes` | Anzahl und Summe der Zeitersparnis |
| `baseline_minutes` | höchster Basiswert der berechtigten Anfragen des Abschnitts (`null` ohne berechtigte Anfrage) |

Eingang, Erstbearbeitung und Abschluss sind getrennte Reihen und werden nie als ein Fluss addiert. Monate ohne Daten bleiben in der Saisonalität leer statt 0.

`analytics_queue_history(from_date, to_date)` liefert je Tag (Stand am Tagesende) die Anzahl Anfragen je Warteschlange `analysis` (`new`/`analyzing`), `review` (`needs_review`), `awaiting_customer`, `planning` (wie `planning_queue`). Historische Warteschlangen stammen aus `request_events` (`intake_status_changed`, `work_status_changed`), nicht aus dem heutigen Status alter Anfragen.

## Team (`analytics_team`)

Je Dispatcher und Techniker (auch deaktivierte, mit `is_active`); die Übersicht blendet Personen ohne Tätigkeit und ohne offene Anfragen aus:

| Feld | Definition |
| --- | --- |
| `intake_completed` | nicht automatische Erstbearbeitungen (`manual`, `human_review`) mit `intake_completed_at` im Zeitraum, deren Anfrage dem Dispatcher zugewiesen ist |
| `visits_completed` | beendete Einsätze des Technikers (`visits.status = completed`, `actual_end` im Zeitraum) |
| `work_minutes` | Summe `visits.actual_work_minutes` dieser Einsätze (aktive Arbeitszeit, ohne Warten) |
| `requests_completed` | im Zeitraum abgeschlossene Anfragen, deren zuständiger Techniker die Person ist |
| `open_requests` | am Periodenende offene Anfragen, die der Person zugewiesen sind |

**Zuordnung:** Einsätze zählen beim Techniker des Einsatzes. Erstbearbeitungen, Abschlüsse und offene Anfragen zählen nach der **aktuellen** Zuweisung der Anfrage (`dispatcher_id`, `technician_id`), nicht nach der Zuweisung zum Ereigniszeitpunkt; nach einer Neuzuweisung (z. B. bei Deaktivierung) wandern sie mit. Filter nach Leistungsart, Priorität oder Zuständigen gibt es in der Analytik derzeit nicht; Listen filtern nach aktuellen Werten.

## Fristen und Wartezeiten

- `requested_visit_date` ist ein Kundenwunsch, keine Frist. Ohne vereinbarte Frist zeigt die Anfrageseite „Nicht vereinbart“.
- Antwort überfällig: `response_due_at` verstrichen ohne inhaltliche Antwort bzw. Abschluss der Erstbearbeitung. Service überfällig: `service_due_at` verstrichen ohne Abschluss.
- Fristverschiebungen (`change_deadline`) speichern alte und neue Frist mit Grund (`deadline_changed`); eine bereits eingetretene Überschreitung bleibt im Verlauf erhalten.
- `first_substantive_response_at` setzt nur der bestätigte Versand einer Rückfrage oder inhaltlichen Antwort (`confirm_message_sent`), nie Entwurf oder Warteschlange. Bis zur E-Mail-Integration bleibt der Wert bei Live-Anfragen leer; Demo-Werte sind simuliert.
- Abgelehnte und stornierte Anfragen stehen in keiner aktiven Warteschlange und zählen nicht als erfolgreicher Abschluss.

## Abweichungen von der Spezifikation

| Punkt | Umsetzung |
| --- | --- |
| Vergleich mit dem Vorjahresmonat | nicht angeboten; Vergleich immer mit dem vorherigen Zeitraum gleicher Art |
| Frei wählbare Vergleichszeiträume | nicht angeboten; Zeiträume Woche, Monat, Quartal, Jahr mit Vor/Zurück |
| Filter nach Leistungsart, Priorität, Zuständigen, Demo/Live in KPIs und Diagrammen | nicht umgesetzt; Listen filtern einzeln |
| Basiswert | 15 statt 5 Minuten (Nutzerentscheidung) |
| Historische Wartezeitsummen (Kunde, Teile) | nicht als Kennzahl ausgewiesen; die aktuelle Wartedauer zeigt die Warteschlange der Dispatcher („Wartet seit“) |
| Zuordnung im Team | nach aktueller Zuweisung, nicht nach Zuweisung zum Ereigniszeitpunkt (siehe Team) |
