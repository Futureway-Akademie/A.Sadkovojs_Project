# Datenbank

Schema im lokalen Supabase-Stack, ausschließlich über Migrationen unter `supabase/migrations/`. Tests (pgTAP) unter `supabase/tests/database/`, Ausführung mit `supabase test db`.

## Konventionen

- UUID-Primärschlüssel (`gen_random_uuid()`), außer der Singleton-Schlüssel von `settings`.
- `timestamptz` für Ereignisse und Intervalle, `date` für Kalenderdaten.
- Geld `numeric(12,2)`, Menge `numeric(12,3)`, Steuersatz `numeric(5,2)` zwischen 0 und 100.
- `created_at` und `updated_at` sind `NOT NULL` mit Default `now()`; `updated_at` setzt der Trigger `public.set_updated_at()`.
- Fremdschlüssel auf Mitarbeitende zeigen auf `profiles` mit `ON DELETE RESTRICT`; keine kaskadierenden Löschungen von Geschäftsdaten.
- Pflichttexte sind `NOT NULL` und dürfen nicht leer sein (`btrim(...) <> ''`).
- RLS ist auf jeder Tabelle aktiviert. Ohne Richtlinien ist jeder Zugriff über die Data API gesperrt; Richtlinien folgen in task-1-5.

## Enums

Alle Enums der Spezifikation liegen in `20261007093447_enums.sql`:

| Enum | Werte |
| --- | --- |
| `employee_role` | admin, manager, dispatcher, technician |
| `service_kind` | inspection, scheduled_maintenance, diagnosis_repair |
| `billing_model` | fixed, hourly |
| `availability_kind` | working_hours, absence |
| `equipment_kind` | pump, compressor, ventilation, other |
| `customer_urgency` | planbar, zeitnah, erheblich, production_stop |
| `request_priority` | low, normal, high, critical |
| `safety_risk` | none_known, known, unclear |
| `intake_status` | new, analyzing, needs_review, awaiting_customer, processed, rejected, cancelled |
| `work_status` | not_planned, scheduled, in_progress, waiting_parts, completed, cancelled |
| `intake_mode` | automatic, manual, human_review |
| `message_direction` | incoming, outgoing |
| `message_kind` | receipt, clarification, customer_reply, invoice, other |
| `message_status` | draft, queued, sent, received, failed |
| `visit_status` | scheduled, in_progress, waiting_parts, completed, cancelled |
| `work_entry_kind` | labor, part, fixed_service |
| `work_item_status` | planned, ordered, performed, used, cancelled |
| `work_unit` | hour, piece, service |
| `invoice_status` | draft, issued, sent, paid |
| `visibility_level` | operational, dispatch, management |
| `actor_type` | user, automation, system |
| `automation_step` | intake_analysis, reply_analysis, email_matching, email_send |
| `automation_status` | running, succeeded, failed |
| `automation_decision` | ready_for_planning, ask_customer, human_review, matched, unmatched, sent |

## Stammdaten (task-1-1)

### `profiles`

| Spalte | Typ | Null | Regel |
| --- | --- | --- | --- |
| `id` | uuid | nein | PK, FK `auth.users.id`, `ON DELETE RESTRICT` |
| `display_name` | text | nein | nicht leer |
| `role` | employee_role | nein | |
| `is_active` | boolean | nein | Default `true`; deaktivieren statt löschen |
| `created_at`, `updated_at` | timestamptz | nein | |

Ein Auth-Nutzer mit Profil kann nicht gelöscht werden.

### `settings`

Genau eine Zeile (`id = 1`), wird von der Migration angelegt.

| Spalte | Typ | Null | Regel |
| --- | --- | --- | --- |
| `id` | smallint | nein | PK, `CHECK (id = 1)` |
| `timezone` | text | nein | Default `Europe/Berlin` |
| `currency` | text | nein | Default `EUR`, drei Großbuchstaben |
| `manual_intake_minutes` | numeric(8,2) | nein | Default 5, > 0 |
| `default_tax_rate` | numeric(5,2) | nein | Default 19, 0 bis 100 |
| `payment_terms_days` | integer | nein | Default 14, >= 0 |
| `company_details` | jsonb | nein | Default `{}`, muss ein Objekt sein |
| `created_at`, `updated_at` | timestamptz | nein | |
| `updated_by` | uuid | ja | FK `profiles`; leer bis zur ersten Änderung durch einen Admin |

Die Spezifikation lässt die Nullability offen; alle Einstellungen sind `NOT NULL` mit Default, damit Berechnungen nie auf fehlende Werte treffen. Steuersatz 19 % und Zahlungsziel 14 Tage sind Demo-Annahmen.

### `service_rates`

| Spalte | Typ | Null | Regel |
| --- | --- | --- | --- |
| `id` | uuid | nein | PK |
| `code` | text | nein | eindeutig, nicht leer |
| `service_kind` | service_kind | nein | |
| `display_name` | text | nein | nicht leer |
| `billing_model` | billing_model | nein | |
| `unit_price` | numeric(12,2) | nein | >= 0 |
| `tax_rate` | numeric(5,2) | nein | 0 bis 100 |
| `is_active` | boolean | nein | Default `true` |
| `created_at`, `updated_at` | timestamptz | nein | |

### `employee_availability`

| Spalte | Typ | Null | Regel |
| --- | --- | --- | --- |
| `id` | uuid | nein | PK |
| `employee_id` | uuid | nein | FK `profiles`, `ON DELETE RESTRICT` |
| `kind` | availability_kind | nein | |
| `weekday` | smallint | je Art | 1 bis 7 (ISO, 1 = Montag) |
| `local_start`, `local_end` | time | je Art | Ortszeit gemäß `settings.timezone` |
| `valid_from`, `valid_to` | date | ja | optionaler Gültigkeitszeitraum der Arbeitszeit; `valid_to >= valid_from` |
| `starts_at`, `ends_at` | timestamptz | je Art | Abwesenheitsintervall |
| `label` | text | ja | Bezeichnung oder Abwesenheitsgrund |
| `created_at`, `updated_at` | timestamptz | nein | |

CHECK-Constraints je Art:

- `working_hours`: `weekday`, `local_start`, `local_end` gesetzt, `local_end > local_start`; `starts_at`, `ends_at` leer. Schichten über Mitternacht sind nicht vorgesehen.
- `absence`: `starts_at`, `ends_at` gesetzt, `ends_at > starts_at`; Wochentag, Uhrzeiten und Gültigkeitszeitraum leer.

Überschneidungsprüfung mit Einsätzen und Serialisierung je Techniker folgen in task-2-2.

## Anfragen und Audit-Ereignisse (task-1-2)

Migration `20261007100000_requests_and_events.sql`.

### `requests`

Alle Felder laut Spezifikation 5.2. Nullability:

| Pflicht (`NOT NULL`) | Optional (`NULL` erlaubt) |
| --- | --- |
| `id`, `request_number`, `source_event_key`, `source` (`website_form`/`demo_seed`), `is_demo` | `customer_number`, `site_label` |
| `company_name`, `contact_name`, `business_email`, `phone_number` | `manufacturer`, `model_type`, `machine_number` |
| `street_house_number`, `postal_code` (Text), `city` | `priority` (bis zur Bestimmung) |
| `equipment_kind`, `service_kind`, `requested_visit_date`, `description` | `sla_contract_number`, `emergency_sla_claimed` (NULL = keine Angabe) |
| `customer_urgency`, `safety_risk`, `sla_verified`, `raw_payload` | `dispatcher_id`, `technician_id` |
| `intake_status` (Default `new`), `work_status` (Default `not_planned`) | `intake_mode`, `manual_minutes_baseline`, `intake_completed_at` |
| `human_review_required`, `version` (Default 1) | `response_due_at`, `service_due_at`, `first_substantive_response_at` |
| `created_at`, `updated_at` | `completed_at`, `cancelled_at`, `rejection_reason`, `cancellation_reason`, `completion_summary` |

Regeln in der Datenbank:

- **Anfragenummer:** Der Trigger `assign_request_number` vergibt `RIS-JJJJ-NNNNN` bei jedem Insert und überschreibt Client-Werte. Das Jahr richtet sich nach `created_at` in `settings.timezone`, damit auch Seed-Daten mit historischem Datum korrekt nummeriert werden. Der Zähler je Jahr (`request_number_counters`) wird per `INSERT … ON CONFLICT DO UPDATE` erhöht; die Zeilensperre macht die Vergabe atomar (geprüft mit 40 parallelen Inserts: 40 eindeutige, lückenlose Nummern).
- **Idempotenz:** `source_event_key` ist `UNIQUE`; eine erneute Zustellung derselben Einreichung scheitert mit `23505`.
- **Unveränderlich:** `request_number`, `source_event_key`, `source`, `is_demo`, `raw_payload`, `created_at` (Trigger `guard_request_update`).
- **Version:** Jede Änderung erhöht `version` um 1 und setzt `updated_at`; kontrollierte Operationen prüfen die erwartete Version.
- **Statusabhängige Pflichtfelder:** `rejected` braucht `rejection_reason`; `cancelled` braucht `cancellation_reason` und `cancelled_at`; `work_status = completed` braucht `completion_summary` und `completed_at`; `intake_completed_at`, `intake_mode` und `manual_minutes_baseline` werden nur gemeinsam gesetzt; eine Ablehnung kann nie den Modus `automatic` haben.
- Rollen- und Aktivitätsprüfung der Zuweisungen sowie erlaubte Statusübergänge folgen in den kontrollierten Operationen (Phase 2).

Indizes: `dispatcher_id`, `technician_id`, `intake_status`, `work_status`, `created_at`, `intake_completed_at`, `completed_at`.

### `request_events`

| Spalte | Typ | Null | Regel |
| --- | --- | --- | --- |
| `id` | uuid | nein | PK |
| `request_id` | uuid | nein | FK `requests`, `ON DELETE RESTRICT` |
| `visit_id` | uuid | ja | FK auf `visits` folgt in task-1-4 |
| `actor_type` | actor_type | nein | |
| `actor_id` | uuid | ja | FK `profiles`; Pflicht bei `actor_type = user` |
| `event_type` | text | nein | snake_case-Code |
| `visibility` | visibility_level | nein | Default `operational` |
| `from_value`, `to_value`, `note` | text | ja | |
| `data` | jsonb | nein | Default `{}`, Objekt |
| `occurred_at`, `created_at` | timestamptz | nein | Default `now()` |

Append-only: Trigger blockieren `UPDATE`, `DELETE` und `TRUNCATE` für alle Rollen; zusätzlich sind diese Rechte für `anon` und `authenticated` entzogen. Normale Clients schreiben Ereignisse nur über kontrollierte Operationen (Phase 2), die `actor_id` und `occurred_at` selbst setzen.

Ereigniscodes: `submission_received`, `intake_status_changed`, `intake_completed`, `dispatcher_assigned`, `technician_assigned`, `visit_scheduled`, `visit_status_changed`, `work_status_changed`, `work_completed`, `message_received`, `message_linked`, `message_queued`, `message_sent`, `invoice_issued`, `invoice_sent`, `invoice_paid`, `automatic_result_corrected`, `note_added`, `deadline_changed`, `analysis_corrected` (task-2-1). Neue Codes werden hier ergänzt.

## Nachrichten, Automatisierungsläufe, Anhänge (task-1-3)

Migration `20261007110000_messages_automation_attachments.sql`. Die Spalten `messages.invoice_id`, `attachments.visit_id` und `attachments.invoice_id` erhalten ihre Fremdschlüssel in task-1-4 zusammen mit `visits` und `invoices`.

### `messages`

Pflicht: `id`, `direction`, `kind`, `status`, `subject`, `body_text`, `created_at`, `updated_at`. Alle übrigen Felder sind nullable, unterliegen aber diesen Regeln:

- `request_id` oder `inbox_dispatcher_id` ist gesetzt; ausgehende Nachrichten haben immer `request_id`.
- **Eingehend:** Status `received`, `received_at` und `from_address` gesetzt, Art `customer_reply` oder `other`.
- **Ausgehend:** Status `draft`, `queued`, `sent` oder `failed`, `to_address` gesetzt, kein `received_at`, Art `receipt`, `clarification`, `invoice` oder `other`.
- `sent_at` ist genau bei Status `sent` gesetzt; `failed` braucht `error_text`; `queued` ist kein bestätigter Versand.
- `approved_by` und `approved_at` nur gemeinsam; Art `invoice` braucht `invoice_id`.
- `gmail_message_id` verlangt `mailbox_key`; `UNIQUE (mailbox_key, gmail_message_id)`. Dieselbe Gmail-ID in einem anderen Postfach ist erlaubt.

Indizes: `request_id`, `inbox_dispatcher_id` (nur unzugeordnete), `(mailbox_key, gmail_thread_id)`, `mime_message_id`, `invoice_id`.

### `automation_runs`

Pflicht: `id`, `operation_key` (UNIQUE), `step`, `status` (Default `running`), `started_at`, `created_at`, `updated_at`.

- `finished_at` ist genau bei den Endzuständen `succeeded` und `failed` gesetzt und liegt nicht vor `started_at`; `failed` braucht `error_code`.
- `decision` nur bei `succeeded` und passend zum Schritt: Analyse → `ready_for_planning`/`ask_customer`/`human_review`, Zuordnung → `matched`/`unmatched`, Versand → `sent`.
- `confidence` zwischen 0 und 1; ist nur Prüfinformation, kein alleiniges Entscheidungskriterium.
- Korrektur (`corrected_by`, `corrected_at`, `correction_reason`) nur vollständig.
- Ohne `request_id` ist nur `email_matching` erlaubt.

Wiederholungsstrategie: Eine erneute Zustellung derselben Operation verwendet denselben `operation_key` und damit denselben Datensatz; eine neue, eigenständige Analyse erhält einen neuen Schlüssel.

### `attachments`

Pflicht: `id`, `bucket`, `storage_path` (`UNIQUE (bucket, storage_path)`), `file_name`, `mime_type`, `size_bytes` (> 0), `visibility` (Default `operational`), `created_at`. Nullable: `request_id`, `message_id`, `visit_id`, `invoice_id`, `uploaded_by`.

Elternprüfung (Trigger `check_attachment_parents`):

- Mindestens eine Elternreferenz.
- Anhänge einer **zugeordneten** Nachricht tragen dieselbe `request_id` wie die Nachricht.
- Anhänge einer **unzugeordneten** eingehenden Nachricht tragen nur `message_id` und erben deren Zugriffsregeln. Beim späteren Verknüpfen der Nachricht setzt die kontrollierte Operation (Phase 2) auch `request_id` der Anhänge.
- Ohne Nachricht ist `request_id` Pflicht; `visit_id` und `invoice_id` sind über zusammengesetzte Fremdschlüssel an dieselbe Anfrage gebunden (task-1-4).

## Einsätze, Arbeitspositionen und Rechnungen (task-1-4)

Migration `20261007120000_visits_work_invoices.sql`. Erweiterung `btree_gist` (Schema `extensions`).

**Gleiche Anfrage als Datenbankgarantie:** `visits`, `work_entries` und `invoices` haben `UNIQUE (id, request_id)`. Kindzeilen verweisen auf dieses Paar, sodass ein Einsatz oder eine Rechnung einer anderen Anfrage nicht referenziert werden kann:

| Kind | Fremdschlüssel |
| --- | --- |
| `request_events` | `(visit_id, request_id)` → `visits` |
| `work_entries` | `(visit_id, request_id)` → `visits` |
| `messages` | `(invoice_id, request_id)` → `invoices`; `invoice_id` verlangt `request_id` |
| `attachments` | `(visit_id, request_id)` → `visits`, `(invoice_id, request_id)` → `invoices`; beide verlangen `request_id` |
| `invoice_items` | Trigger `check_invoice_item_request`: Arbeitsposition gehört zur Anfrage der Rechnung |

### `visits`

Pflicht: `id`, `request_id`, `technician_id`, `status` (Default `scheduled`), `scheduled_start`, `scheduled_end`, `created_by`, `created_at`, `updated_at`. Nullable: `actual_start`, `actual_end`, `actual_work_minutes` (>= 0), `summary`, `waiting_reason`, `cancellation_reason`.

- `scheduled_end > scheduled_start`; `actual_end >= actual_start`.
- `in_progress`, `waiting_parts`, `completed` verlangen `actual_start`; `completed` verlangt `actual_end`.
- `waiting_parts` verlangt `waiting_reason`, `cancelled` verlangt `cancellation_reason`.

**Reservierende Einsatzstatus:** `scheduled` und `in_progress`. Nur diese blockieren das Zeitfenster eines Technikers. `waiting_parts`, `completed` und `cancelled` reservieren nicht, damit Warten auf Teile keine unbegrenzte Kalenderblockade erzeugt; der Kalender verwendet dieselbe Definition.

**Überschneidungsschutz:** Exclusion Constraint `visits_no_overlap` auf `(technician_id, tstzrange(scheduled_start, scheduled_end, '[)'))` für reservierende Status. Halboffene Intervalle: ein Einsatz bis 10:00 und einer ab 10:00 überschneiden sich nicht. Der Constraint gilt auch bei gleichzeitigen Buchungen (geprüft: 10 parallele Buchungen desselben Zeitfensters, genau 1 erfolgreich). Prüfung gegen Arbeitszeiten und Abwesenheiten folgt in task-2-2.

### `work_entries`

Pflicht: alle Felder außer `visit_id`, `service_rate_id`, `ordered_at`, `performed_at`.

- Art und Einheit passen: `labor` → `hour`, `part` → `piece`, `fixed_service` → `service`.
- Art und Status passen: Teile `planned`/`ordered`/`used`/`cancelled`; Arbeit und Pauschalen `planned`/`performed`/`cancelled`.
- `ordered` verlangt `ordered_at`; `performed` und `used` verlangen `performed_at`.
- `quantity > 0`, `unit_price >= 0`, `tax_rate` 0 bis 100.
- Abrechenbar sind nur `billable` und `performed` beziehungsweise `used` (geprüft beim Erstellen der Rechnung, task-2-4). Die Sperre abgerechneter Positionen folgt ebenfalls in task-2-4.

### `invoices`

Pflicht: `id`, `request_id` (**UNIQUE**, eine Rechnung je Anfrage), `status` (Default `draft`), `created_by`, `subtotal`, `tax_total`, `total` (Default 0), `currency` (Default `EUR`), `seller_snapshot`, `customer_snapshot` (Default `{}`), `created_at`, `updated_at`.

- `draft`: keine Rechnungsnummer, keine Ausstellungs-, Versand- oder Zahlungsdaten.
- Ab `issued`: `invoice_number` (UNIQUE), `issued_by`, `issued_at`, `issue_date`, `payment_due_date` gesetzt; Fälligkeit nicht vor Ausstellung.
- `sent` verlangt `sent_at`; `paid` genau dann, wenn `paid_at` gesetzt ist. `sent_at` darf bei `paid` gesetzt sein (Versand nach Zahlung).
- `total = subtotal + tax_total`.
- Vergabe der Rechnungsnummer und Unveränderlichkeit nach Ausstellung folgen in task-2-4.

### `invoice_items`

Pflicht: alle Felder außer `work_entry_id` (**UNIQUE**, verhindert Doppelabrechnung). `UNIQUE (invoice_id, position)`, `position >= 1`, Art und Einheit wie bei `work_entries`.

**Rundungsregel** (CHECK `invoice_items_rounding`):

- `net_amount = round(quantity * unit_price, 2)`
- `tax_amount = round(net_amount * tax_rate / 100, 2)`
- `gross_amount = net_amount + tax_amount`

PostgreSQL rundet `numeric` kaufmännisch (0,5 von null weg).

## Row Level Security und Storage (task-1-5)

Migration `20261007130000_rls_and_storage.sql`. Tests: `supabase/tests/database/rls.test.sql` (pgTAP mit simulierten JWT-Claims je Rolle).

### Grundsätze

- RLS ist auf allen 13 Kerntabellen und auf `request_number_counters` aktiv.
- **Nur Lesen über RLS.** `anon` hat keinerlei Tabellenrechte; `authenticated` hat ausschließlich `SELECT`. Alle Schreibvorgänge normaler Nutzer laufen über kontrollierte Operationen (`security definer`-Funktionen, Phase 2), die Rolle, Aktivstatus, Elternzugehörigkeit und Statusübergänge prüfen.
- `role` und `is_active` in `profiles` sind für Nutzer nicht änderbar: kein Schreibrecht, keine Update-Richtlinie und zusätzlich der Trigger `guard_profile_privileges`, der Änderungen durch Client-Rollen abweist.
- Jede Hilfsfunktion verlangt ein aktives Profil. Deaktivierte Mitarbeitende sehen nichts.
- Hilfsfunktionen liegen im Schema `private`, das nicht über die Data API erreichbar ist.
- **Neue Tabellen** in `public` erhalten von Supabase standardmäßig Rechte für `anon` und `authenticated`. Jede künftige Migration muss RLS aktivieren und diese Rechte wie hier entziehen.

### Hilfsfunktionen (`private`)

| Funktion | Bedeutung |
| --- | --- |
| `current_employee_role()` | Rolle des angemeldeten, aktiven Nutzers, sonst NULL |
| `is_active_employee()`, `is_manager_or_admin()` | Kurzformen |
| `visibility_allowed(level)` | `operational`: alle; `dispatch`: Dispatcher, Manager, Admin; `management`: Manager, Admin |
| `can_access_request(id)` | Manager/Admin alle; Dispatcher aktuell zugewiesene; Techniker aktuell zugewiesene oder mit eigenem Einsatz (Historie) |
| `is_current_technician(id)` | Aktuell zugewiesener Techniker (operative Kontrolle, nicht Historie) |
| `can_read_message(id)` | Manager/Admin; Dispatcher bei Zugriff auf die Anfrage oder eigener Posteingang; nie Techniker |
| `can_read_attachment(id)` | Elternzugriff, Sichtbarkeit; Nachrichtenanhänge folgen der Nachricht |
| `can_read_storage_object(bucket, name)` | Download nur mit Zugriff auf die zugehörige `attachments`-Zeile |

### Lesezugriff je Rolle

| Tabelle | Admin / Manager | Dispatcher | Techniker |
| --- | --- | --- | --- |
| `profiles`, `settings`, `service_rates` | alle | alle | alle |
| `employee_availability` | alle | Arbeitszeiten aller; keine Abwesenheitsdetails anderer | nur eigene |
| `requests` | alle | aktuell zugewiesene | aktuell zugewiesene und historische mit eigenem Einsatz |
| `request_events` | alle Stufen | `operational`, `dispatch` | `operational` |
| `messages` | alle | eigene Anfragen und eigener Posteingang | keine |
| `automation_runs` | alle | eigene Anfragen | keine |
| `visits` | alle | eigene Anfragen | eigene Einsätze; alle Einsätze der aktuellen Anfrage |
| `work_entries` | alle | eigene Anfragen | eigene, eigene Einsätze, aktuelle Anfrage |
| `invoices`, `invoice_items` | alle | eigene Anfragen | zugängliche Anfragen |
| `attachments`, Storage | nach Sichtbarkeit | nach Sichtbarkeit, eigene Anfragen | `operational`, ohne Nachrichtenanhänge; Einsatzanhänge nur eigener Einsätze oder der aktuellen Anfrage |

Eine Neuzuweisung entzieht dem bisherigen Dispatcher sofort den Zugriff, da `can_access_request` die aktuelle Zuweisung liest.

### Belegte Intervalle für die Einsatzplanung

`public.technician_busy_intervals(range_start, range_end)` (RPC, `security definer`) liefert für Dispatcher, Manager und Admins die belegten Intervalle aller aktiven Techniker: reservierende Einsätze (`scheduled`, `in_progress`) und Abwesenheiten. Rückgabe nur `technician_id`, `starts_at`, `ends_at`, `busy_kind` (`visit`/`absence`), ohne Anfrage, Kunde, Adresse oder Abwesenheitsgrund. Techniker erhalten keine Zeilen.

### Storage

- Privater Bucket `dashboard` (10 MB je Datei, PDF/JPEG/PNG), angelegt per Migration.
- Download (`SELECT` auf `storage.objects`) nur, wenn eine `attachments`-Zeile mit gleichem Bucket und Pfad für den Nutzer lesbar ist.
- Uploads laufen über vertrauenswürdige Serveroperationen, die zuerst den Zugriff prüfen und dann Datei und Metadaten anlegen. Website-Formularanhänge bleiben in Vercel Blob.

### Geprüft

- pgTAP: 42 Tests mit sieben Rollen- und Statuskombinationen (anon, Admin, Manager, deaktivierter Manager, zwei Dispatcher, zwei Techniker).
- Direkt über die REST-API mit echtem Login: `anon` erhält `42501` auf `requests`; ein Techniker liest sein Profil, kann seine Rolle nicht ändern und keine Anfrage anlegen (`42501`) und erhält keine belegten Intervalle.

## Kontrollierte Operationen: Erstbearbeitung, Zuweisung, Fristen (task-2-1)

Migration `20261007140000_intake_operations.sql`. Tests: `supabase/tests/database/intake_operations.test.sql`.

Alle Operationen sind RPC-Funktionen (`supabase.rpc(...)`) mit `security definer`. Jede Operation prüft aktives Profil und Rolle, sperrt die Anfrage (`FOR UPDATE`), vergleicht `expected_version` mit `requests.version`, prüft den Statusübergang und schreibt Änderung und Audit-Ereignis in derselben Transaktion. Jede Änderung erhöht `version` (Trigger). Rückgabe ist die aktualisierte Anfrage.

### Fehlercodes

| SQLSTATE | Bedeutung | Verhalten in der Oberfläche |
| --- | --- | --- |
| `42501` | keine Berechtigung oder kein Zugriff auf die Anfrage | Hinweis, Aktion ausblenden |
| `RW409` | Versionskonflikt: Anfrage wurde zwischenzeitlich geändert | neu laden, Eingabe erhalten |
| `RW422` | Aktion im aktuellen Zustand nicht erlaubt oder Eingabe ungültig (z. B. fehlender Grund) | Meldung anzeigen |

### Operationen

| Funktion | Rollen | Übergang / Wirkung | Ereignisse |
| --- | --- | --- | --- |
| `assign_dispatcher(request_id, expected_version, dispatcher_id)` | Manager, Admin | nur aktive Dispatcher, nicht bei Endzuständen; bisheriger Dispatcher verliert sofort den Zugriff | `dispatcher_assigned` (dispatch) |
| `mark_needs_review(request_id, expected_version, note?)` | Dispatcher, Manager, Admin | `new`/`analyzing` → `needs_review`, setzt `human_review_required` | `intake_status_changed` |
| `mark_awaiting_customer(…, note?)` | dto. | `new`/`analyzing`/`needs_review` → `awaiting_customer` | `intake_status_changed` |
| `resume_analysis(…, note?)` | dto. | `awaiting_customer` → `analyzing` (Kundenantwort) | `intake_status_changed` |
| `correct_analysis(…, reason, service_kind?, priority?, automation_run_id?)` | dto. | korrigiert Leistungsart/Priorität; markiert den Automatisierungslauf als korrigiert | `automatic_result_corrected` bei automatischem Ergebnis, sonst `analysis_corrected` (dispatch) |
| `complete_intake(…, priority?, note?)` | dto. | `new`/`analyzing`/`needs_review` → `processed`; Priorität Pflicht; erneuter Aufruf liefert das bestehende Ergebnis | `intake_status_changed`, beim ersten Abschluss `intake_completed` |
| `reopen_intake(…, target_status, reason)` | dto. | `processed` → `analyzing`/`needs_review`/`awaiting_customer` vor technischem Abschluss; Buchungen bleiben bestehen | `intake_status_changed` mit `data.reopened` |
| `reject_request(…, reason)` | dto. | vor Arbeitsbeginn (`work_status` `not_planned`/`scheduled`) → `rejected`, `work_status` `cancelled`; offene Einsätze werden storniert | `intake_status_changed`, `work_status_changed`, `visit_status_changed`, ggf. `intake_completed` |
| `cancel_request(…, reason)` | dto. | vor Arbeitsabschluss → `cancelled`, `cancelled_at`; offene Einsätze werden storniert; kein Abschluss der Erstbearbeitung | `intake_status_changed`, `work_status_changed`, `visit_status_changed` |
| `change_deadline(…, deadline_kind, new_due_at, reason)` | dto. | `response` oder `service`; Grund Pflicht | `deadline_changed` mit alter/neuer Frist, Art, Grund, `breach_recorded` |

Dispatcher handeln nur bei aktuell zugewiesenen Anfragen (`can_access_request`). Techniker haben keine dieser Operationen.

### Erstabschluss (einmalig)

Beim ersten Ergebnis `processed` oder `rejected` werden `intake_completed_at`, `intake_mode` und `manual_minutes_baseline` (Snapshot aus `settings.manual_intake_minutes`) gesetzt. Modus durch Menschen: aus `new` = `manual`, aus `analyzing`/`needs_review` = `human_review`. Der Modus `automatic` wird nur durch die künftige Automatisierung (Integrationsoperation) gesetzt. Der Trigger `guard_request_update` verhindert jede spätere Änderung dieser drei Felder, auch für vertrauenswürdige Rollen. Wiedereröffnung und erneuter Abschluss erhalten den ursprünglichen Snapshot.

### Fristverstöße

Wird eine abgelaufene, nicht erfüllte Frist verschoben, hält das Ereignis `deadline_changed` dies in `data.breach_recorded = true` fest. Erfüllung: Antwortfrist durch `first_substantive_response_at`, Servicefrist durch `completed_at`. Damit löscht eine Verschiebung keinen bestehenden Verstoß.

Zusätzliche Ereigniscodes: `analysis_corrected` (menschliche Korrektur ohne automatisches Ergebnis).
