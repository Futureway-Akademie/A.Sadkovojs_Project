# n8n-Vertrag (künftige Integration)

> **Stand: nur dokumentiert, nicht angebunden.** Es gibt keinen n8n-Workflow und keine Gmail-Anbindung. Das Website-Formular leitet Anfragen weiterhin über `/api/service-request` an Make weiter (siehe [decisions.md](decisions.md)); Live-Anfragen entstehen dadurch noch nicht in Supabase. E-Mails des Dashboards enden als Entwurf oder in der Warteschlange (`queued`) und werden **nicht versendet**. Der Status `sent` entsteht ausschließlich durch eine Versandbestätigung der künftigen Integration.

Dieser Vertrag beschreibt, wie ein n8n-Workflow in einer späteren Stufe mit der Datenbank zusammenarbeitet (Spezifikation Abschnitt 8). Er legt Ein- und Ausgaben, Idempotenz, Versionsprüfung, Warteschlange und Gmail-Zuordnung fest. Fachliche Zustände und Rechte prüft immer die Datenbank; n8n schreibt nie direkt in Tabellen, sondern nur über die unten genannten Funktionen.

## Grundsätze

| Thema | Festlegung |
| --- | --- |
| Zugang | n8n nutzt einen eigenen Server-Schlüssel (`service_role`) nur für die Integrationsfunktionen. Dashboard-Aktionen laufen weiter mit den Rechten des angemeldeten Nutzers |
| Schreibweg | ausschließlich RPC-Funktionen (`security definer`), die Zustand und Audit-Ereignis in **einer** Transaktion schreiben; Ereignisse der Integration mit `actor_type = automation` |
| Idempotenz | jede Operation hat einen stabilen Schlüssel: `source_event_key` (Einreichung), `automation_runs.operation_key` (Lauf), `(mailbox_key, gmail_message_id)` (eingehende Mail), `messages.id` (ausgehende Mail). Eine Wiederholung liefert das bestehende Ergebnis statt eines Duplikats |
| Versionsprüfung | Ergebnisse, die eine Anfrage ändern, tragen `expected_version` (= `requests.version` beim Lesen). Abweichung → `RW409`, das Ergebnis wird verworfen und nicht über eine menschliche Entscheidung geschrieben |
| Vertragsversion | jede Nutzlast trägt `contract_version` (aktuell `"1.0"`); unbekannte Versionen werden abgewiesen |
| Fehlercodes | `42501` keine Berechtigung, `RW409` Versionskonflikt, `RW410` Terminkonflikt, `RW422` Übergang nicht erlaubt oder Eingabe ungültig, `RW404` nicht gefunden, `23505` Duplikat |
| Zeit | Zeitstempel als ISO 8601 mit Offset; fachliche Tage in Europe/Berlin |
| Rekursion | Statusänderungen durch den Workflow lösen keinen weiteren Analyse-Lauf aus (siehe Auslöser) |

## Vorhandene und noch zu bauende Funktionen

| Funktion | Stand | Zweck |
| --- | --- | --- |
| `confirm_message_sent(message_id, sent_at?, mailbox_key?, gmail_message_id?, gmail_thread_id?, mime_message_id?)` | **vorhanden**, nur `service_role` | bestätigter Versand: `queued` → `sent`, Provider-IDs, ggf. `first_substantive_response_at` und Rechnung `issued` → `sent`; Wiederholung liefert das bestehende Ergebnis; Demo-Anfragen werden abgewiesen |
| `link_message(message_id, request_id, expected_version)` | **vorhanden**, Dashboard (Inhaber des Posteingangs, Manager, Admin) | manuelle Zuordnung einer unzugeordneten eingehenden Mail |
| `queue_message(message_id, expected_version)` | **vorhanden**, Dashboard | Freigabe eines Entwurfs in die Warteschlange |
| `ingest_submission(payload)` | zu bauen | Einreichung speichern (Abschnitt 1) |
| `start_automation_run(operation_key, step, request_id?, message_id?, input_version?, workflow_execution_id?)` | zu bauen | Lauf idempotent anlegen bzw. bestehenden liefern |
| `finish_automation_run(run_id, status, decision?, confidence?, result?, error_code?, error_text?)` | zu bauen | Lauf beenden, Ergebnis speichern |
| `apply_analysis_result(run_id, request_id, expected_version, result)` | zu bauen | Analyseergebnis auf die Anfrage anwenden (Abschnitt 2) |
| `record_incoming_message(payload)` | zu bauen | eingehende Gmail-Nachricht speichern und zuordnen (Abschnitt 3) |
| `claim_queued_messages(limit, lease_seconds)` | zu bauen | versandbereite Nachrichten mit Sperrfrist abholen (Abschnitt 4) |
| `mark_message_failed(message_id, error_text, permanent)` | zu bauen | endgültiger Fehler → `failed` mit `error_text`; vorübergehender Fehler lässt `queued` |

Die vorhandenen Tabellen enthalten bereits alle Felder für diese Funktionen (`requests.source_event_key`, `automation_runs.operation_key`/`input_version`/`workflow_execution_id`, `messages.mailbox_key`/`gmail_message_id`/`gmail_thread_id`/`mime_message_id`/`in_reply_to`/`references_header`, `attachments.bucket`/`storage_path`).

## 1. Einreichung

**Auslöser:** Webhook des Website-Formulars (heute Make, künftig n8n). Nutzlast = bestehender Formularvertrag `ServiceRequestPayload` aus `lib/form-contract.ts` (`schema_version "1.0"`, `submission_id` als UUID, Kontakt, Standort und Anlage, Anliegen, Vertrag und bis zu drei Anhänge, `privacy_consent`). Die Website-Route prüft Pflichtfelder, Turnstile und Anhänge bereits vor der Weiterleitung.

**Ablauf:**

1. Nutzlast erneut validieren (`validatePayload`, Anhänge: PDF/JPEG/PNG, ≤ 5 MB, ≤ 3 Dateien, Pfad `service-requests/<submission_id>/`).
2. `source_event_key = "website_form:" + submission_id` bilden.
3. Anhänge in den privaten Bucket `dashboard` unter `staging/<submission_id>/<datei>` kopieren (Speicher ist nicht Teil der Datenbanktransaktion).
4. `ingest_submission(payload)` in **einer** Transaktion: Anfrage mit `source = website_form`, `raw_payload`, gemappten Feldern; Anhänge als `attachments` (Pfade nach `requests/<request_id>/…` verschieben bzw. registrieren); Ereignis `submission_received`. Die Anfragenummer `RIS-JJJJ-NNNNN` vergibt die Datenbank.
5. Erst nach erfolgreichem Speichern antwortet der Workflow der Website (`201` mit `request_number`, `human_review`). Die Analyse startet danach asynchron.

**Wiederholung:** derselbe `source_event_key` liefert die bestehende Anfrage (kein zweiter Datensatz, kein zweites Ereignis); die Website erhält dieselbe Antwort.

**Dateien:** Schlägt die Transaktion fehl, löscht der Workflow `staging/<submission_id>/`. Ein täglicher Aufräumlauf entfernt Staging-Dateien älter als 24 h ohne zugehörige Anfrage. Dateien werden nie öffentlich; Downloads laufen über die App mit Zugriffsprüfung.

**Feldzuordnung Formular → `requests`:**

| Formular | Datenbank |
| --- | --- |
| `contact.company_name`, `contact_name`, `business_email`, `phone`, `customer_number` | `company_name`, `contact_name`, `business_email`, `phone_number`, `customer_number` |
| `site_and_equipment.site_name`, `street_and_number`, `postal_code`, `city` | `site_label`, `street_house_number`, `postal_code`, `city` |
| `site_and_equipment.equipment_type` `pump`/`compressor`/`ventilation`/`other` | `equipment_kind` (gleiche Werte) |
| `request.service_type` `inspection`/`maintenance`/`repair` | `service_kind` `inspection`/`scheduled_maintenance`/`diagnosis_repair` |
| `request.urgency` `planned`/`time_sensitive`/`significant`/`production_stop` | `customer_urgency` `planbar`/`zeitnah`/`erheblich`/`production_stop` |
| `request.known_safety_hazard` `no`/`yes`/`unclear` | `safety_risk` `none_known`/`known`/`unclear` |
| `request.preferred_service_date` | `requested_visit_date` (Kundenwunsch, keine Frist) |
| `request.requires_human_review` bzw. Regel `requiresHumanReview` | `human_review_required` |
| `contract_and_attachments.customer_or_sla_contract_number`, `emergency_sla_24_7` | `sla_contract_number`, `emergency_sla_claimed` (`sla_verified` bleibt `false` bis zur menschlichen Prüfung) |
| ganze Nutzlast ohne `turnstile_token` | `raw_payload` (unveränderlich) |

## 2. Analyse

**Auslöser:** neue Anfrage (`submission_received`) oder eingehende Kundenantwort (Abschnitt 3).

1. `start_automation_run` mit `operation_key = "intake_analysis:<request_id>:v<version>"` bzw. `"reply_analysis:<message_id>"`, `input_version = requests.version`, `workflow_execution_id` von n8n. Ein vorhandener Lauf mit demselben Schlüssel wird zurückgegeben; ist er `succeeded`, endet der Workflow ohne neue Analyse.
2. Analyse (z. B. KI) erzeugt ein strukturiertes Ergebnis:

```json
{
  "contract_version": "1.0",
  "request_id": "…",
  "expected_version": 3,
  "decision": "ready_for_planning | ask_customer | human_review",
  "confidence": 0.86,
  "priority": "low | normal | high | critical",
  "service_kind": "inspection | scheduled_maintenance | diagnosis_repair",
  "summary": "Kurzfassung für Dispatcher",
  "missing_information": ["Hersteller", "Maschinennummer"],
  "clarification_draft": { "subject": "…", "body_text": "…" },
  "reasons": ["Produktionsstillstand gemeldet"]
}
```

3. `finish_automation_run` speichert Status, Entscheidung, Konfidenz und `result`. Technische Fehler → `status = failed` mit `error_code`; die Anfrage bleibt unverändert und erscheint weiter in der Analyse-Warteschlange.
4. `apply_analysis_result(run_id, request_id, expected_version, result)` prüft Version und Übergang und schreibt dann in einer Transaktion:
   - `ready_for_planning`: nur wenn `human_review_required = false` und keine Gefahr/kein Produktionsstillstand gemeldet ist → Erstbearbeitung abgeschlossen mit `intake_mode = automatic` und eingefrorenem Basiswert (wie `complete_intake`), Ereignisse `intake_status_changed`, `intake_completed`.
   - `ask_customer`: Rückfrage als Entwurf (`create_message_draft`-Logik, Art `clarification`), Status `awaiting_customer` erst nach bestätigtem Versand; ohne Freigabe-Pflicht nur, wenn die Konfiguration das erlaubt (Standard: Entwurf zur Freigabe durch den Dispatcher).
   - `human_review`: `needs_review`, Dispatcher-Warteschlange „Prüfung“.
   - Abgelehnt wird nie automatisch (Constraint `requests_rejection_not_automatic`).
5. **Veraltete Analyse:** Hat sich die Anfrage seit dem Lesen geändert (`RW409`) oder ist die Erstbearbeitung bereits durch einen Menschen abgeschlossen, wird das Ergebnis nur im Lauf gespeichert und nicht angewendet. Eine menschliche Entscheidung wird nie überschrieben.

Wiederholte Läufe, Rückfragen und Einsätze erhöhen nicht die Zahl der Erstbearbeitungen; Kennzahlen zählen je `request_id` (siehe [kpi-dictionary.md](kpi-dictionary.md)). Korrigiert ein Mensch später ein automatisches Ergebnis (`correct_analysis`), bleibt die Einstufung `automatic`, der Lauf erhält `corrected_at` und zählt nicht zur Zeitersparnis.

## 3. Eingehende Gmail-Nachrichten

**Auslöser:** neue Nachricht im überwachten Postfach (`mailbox_key`, z. B. `service@…`).

1. **Deduplizieren:** `(mailbox_key, gmail_message_id)` ist eindeutig. `record_incoming_message` liefert bei Wiederholung die bestehende Nachricht.
2. **Zuordnen** (Lauf `email_matching`, `operation_key = "email_matching:<mailbox_key>:<gmail_message_id>"`), in dieser Reihenfolge:
   1. `gmail_thread_id` einer bekannten Nachricht derselben Mailbox,
   2. `In-Reply-To`/`References` gegen `messages.mime_message_id`,
   3. Anfragenummer `RIS-JJJJ-NNNNN` im Betreff.
   Absenderadresse allein reicht nie für eine Zuordnung.
3. **Gefunden** (`decision = matched`): Nachricht mit `request_id`, `direction = incoming`, `kind = customer_reply`, Anhänge registriert; Ereignis `message_received`. Steht die Anfrage auf `awaiting_customer`, startet eine `reply_analysis` (Abschnitt 2).
4. **Nicht gefunden** (`decision = unmatched`): Nachricht ohne `request_id` im Posteingang eines Dispatchers (`inbox_dispatcher_id`, z. B. reihum unter aktiven Dispatchern). Der Dispatcher ordnet sie mit `link_message` zu.
5. Nachrichten an Demo-Anfragen werden nicht verarbeitet.

## 4. Ausgehende Gmail-Nachrichten

**Nur** Nachrichten mit `direction = outgoing`, `status = queued`, an Live-Anfragen (`is_demo = false`) und mit Freigabe (`approved_by`, `approved_at`).

1. `claim_queued_messages(limit, lease_seconds)` liefert versandbereite Nachrichten und legt je Nachricht einen Lauf `email_send` mit `operation_key = "email_send:<message_id>"` an. Der eindeutige Schlüssel verhindert, dass zwei Workflow-Ausführungen dieselbe Nachricht gleichzeitig senden; eine abgelaufene Sperrfrist erlaubt eine erneute Übernahme.
2. Versand über die Gmail-API mit `From` = Mailbox, eigenem Header `X-RheinWerk-Message-Id: <message_id>` und einer daraus abgeleiteten `Message-ID` (`<message_id>@rheinwerk-dashboard>`), bei Antworten mit `In-Reply-To`/`References` und `threadId`.
3. Erfolg: `confirm_message_sent(message_id, sent_at, mailbox_key, gmail_message_id, gmail_thread_id, mime_message_id)`. Erst dadurch werden `sent_at`, `first_substantive_response_at` (nur `clarification`/`other`) und der Rechnungsstatus `sent` gesetzt.
4. Endgültiger Fehler (z. B. ungültige Adresse): `mark_message_failed(…, permanent = true)` → `failed` mit `error_text`, sichtbar auf der Anfrageseite. Vorübergehender Fehler: Lauf `failed`, Nachricht bleibt `queued`, neuer Versuch mit Backoff.

**Unklarer Versandausgang** (Zeitüberschreitung, Abbruch nach dem API-Aufruf): Vor jedem erneuten Versuch sucht der Workflow im Ordner „Gesendet“ der Mailbox nach `rfc822msgid:<message_id>@rheinwerk-dashboard` bzw. dem Header `X-RheinWerk-Message-Id`. Gefunden → nur `confirm_message_sent` mit den gefundenen IDs, **kein** zweiter Versand. Nicht gefunden → erneuter Versand. Eine wiederholte Workflow-Ausführung ist nie eine Erlaubnis zum doppelten Versand; maßgeblich sind Nachrichten-ID und Provider-Nachweis.

## 5. Auslöser und Rekursion

| Auslöser | Startet |
| --- | --- |
| Webhook des Formulars | Einreichung, danach Analyse |
| neue Nachricht im Postfach | Zuordnung, ggf. `reply_analysis` |
| Zeitplan (z. B. jede Minute) | Versand der Warteschlange |
| Zeitplan (täglich) | Aufräumen von Staging-Dateien |

Statusänderungen durch den Workflow selbst (`apply_analysis_result`, `confirm_message_sent`) sind **keine** Auslöser. Datenbank-Trigger oder Webhooks auf `requests`/`request_events` werden nicht verwendet, damit eine Statusänderung keine erneute Analyse derselben Anfrage auslöst. Jeder Lauf ist über `operation_key` an genau eine Eingabeversion gebunden.

## Sicherheit und Datenschutz

- Kein Gmail-Token, n8n-Schlüssel oder Secret in `settings` oder im Repository; Zugangsdaten nur in n8n-Credentials bzw. Server-Umgebungsvariablen.
- n8n erhält keine Nutzersitzungen und umgeht RLS nur über die oben genannten Funktionen.
- `raw_payload` und Nachrichtentexte bleiben in Supabase; die KI-Analyse erhält nur die für die Einstufung nötigen Felder.
- Demo-Daten (`is_demo`) werden nie versendet und nie analysiert.

## Abgrenzung dieser Stufe

Umgesetzt sind Datenmodell, Warteschlange, Freigabe, manuelle Zuordnung und `confirm_message_sent` mit Tests ([testing.md](testing.md)). Nicht umgesetzt sind der Workflow selbst, die mit „zu bauen“ markierten Funktionen, die Gmail-Anbindung und die Umstellung des Formulars von Make auf n8n. Gmail-Versand ist damit **nicht funktionsfähig**; das Dashboard zeigt Nachrichten in der Warteschlange ausdrücklich als „In Warteschlange, nicht versendet“.
