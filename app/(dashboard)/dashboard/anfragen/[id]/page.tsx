import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DataTable, type Column } from "@/components/dashboard/ui/data-table";
import { EmptyState, ErrorState } from "@/components/dashboard/ui/states";
import { StatusBadge } from "@/components/dashboard/ui/status-badge";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { getEmployeeNames, getRequestDetail, sectionsFor, type RequestDetail, type SectionId } from "@/lib/dashboard/requests";
import { describeEvent } from "@/lib/events";
import { EMPTY, formatCalendarDate, formatCurrency, formatDateTime, formatMinutes, formatNumber, formatPercent, formatTimeRange } from "@/lib/format";
import { label, statusInfo } from "@/lib/status";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const employee = await requireRole(rolesFor("/dashboard/anfragen"));
  const detail = await getRequestDetail((await params).id, employee.role);
  return { title: detail ? `${detail.request.request_number} – ${detail.request.company_name}` : "Anfrage" };
}

export default async function RequestPage({ params }: Props) {
  const employee = await requireRole(rolesFor("/dashboard/anfragen"));
  const { id } = await params;
  const [detail, names] = await Promise.all([getRequestDetail(id, employee.role), getEmployeeNames()]);
  // Unknown id and missing access look the same
  if (!detail) notFound();

  const { request } = detail;
  const sections = sectionsFor(employee.role);
  const person = (personId: string | null | undefined, fallback = "Nicht zugewiesen") => (personId ? names.get(personId) ?? "Unbekannte Person" : fallback);
  const failed = (section: SectionId) => detail.failed.includes(section);
  const render: Record<SectionId, () => ReactNode> = {
    zusammenfassung: () => <Summary detail={detail} person={person} />,
    kontakt: () => <Contact detail={detail} />,
    anlage: () => <Equipment detail={detail} />,
    erstbearbeitung: () => <Intake detail={detail} person={person} />,
    korrespondenz: () => <Correspondence detail={detail} person={person} />,
    einsaetze: () => <Visits detail={detail} person={person} />,
    arbeit: () => <Work detail={detail} person={person} />,
    dokumente: () => <Documents detail={detail} person={person} />,
    rechnung: () => <Invoice detail={detail} />,
    verlauf: () => <History detail={detail} names={names} />,
  };

  return (
    <div className="dash-page request-page">
      <nav className="breadcrumb-dash" aria-label="Pfad">
        <Link href="/dashboard/anfragen">Anfragen</Link> <span aria-hidden="true">/</span> <span className="mono">{request.request_number}</span>
      </nav>
      <header className="request-head">
        <div>
          <p className="mono request-head__number">{request.request_number}{request.is_demo && <span className="demo-tag">Demodaten</span>}</p>
          <h1>{request.company_name}</h1>
          <p className="request-head__meta">{label("service_kind", request.service_kind)} · {label("equipment_kind", request.equipment_kind)} · {request.postal_code} {request.city}</p>
        </div>
        <div className="badge-row">
          <StatusBadge kind="intake_status" value={request.intake_status} />
          <StatusBadge kind="work_status" value={request.work_status} />
          {request.priority && <StatusBadge kind="request_priority" value={request.priority} />}
        </div>
      </header>

      <nav className="section-nav" aria-label="Abschnitte">
        <ul>{sections.map((section) => <li key={section.id}><a href={`#${section.id}`}>{section.label}</a></li>)}</ul>
      </nav>

      {sections.map((section) => (
        <section key={section.id} id={section.id} className="request-section" aria-labelledby={`${section.id}-title`}>
          <h2 id={`${section.id}-title`}>{section.label}</h2>
          {failed(section.id) ? <ErrorState title="Dieser Abschnitt konnte nicht geladen werden."><p>Bitte die Seite neu laden.</p></ErrorState> : render[section.id]()}
        </section>
      ))}
    </div>
  );
}

type PersonFn = (id: string | null | undefined, fallback?: string) => string;

function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="facts">
      {items.map(([term, value]) => (
        <div key={term}><dt>{term}</dt><dd>{value === null || value === undefined || value === "" ? EMPTY : value}</dd></div>
      ))}
    </dl>
  );
}

const yesNo = (value: boolean | null | undefined, unknown = "Keine Angabe") => (value === null || value === undefined ? unknown : value ? "Ja" : "Nein");

function Summary({ detail, person }: { detail: RequestDetail; person: PersonFn }) {
  const r = detail.request;
  const risky = r.safety_risk !== "none_known";
  return (
    <>
      {risky && <p className="request-alert" role="note"><strong>Sicherheitsgefahr: {label("safety_risk", r.safety_risk)}.</strong> Vor Arbeitsbeginn Sicherheitslage klären.</p>}
      {r.human_review_required && <p className="request-alert request-alert--info">Menschliche Prüfung erforderlich.</p>}
      <Facts items={[
        ["Eingang", formatDateTime(r.created_at)],
        ["Wunschtermin", formatCalendarDate(r.requested_visit_date)],
        ["Dringlichkeit (Kunde)", label("customer_urgency", r.customer_urgency)],
        ["Priorität", r.priority ? statusInfo("request_priority", r.priority).label : "Noch nicht bestimmt"],
        ["Dispatcher", person(r.dispatcher_id)],
        ["Techniker", person(r.technician_id)],
        ["Antwortfrist", formatDateTime(r.response_due_at)],
        ["Servicefrist", formatDateTime(r.service_due_at)],
        ...(r.completed_at ? [["Abgeschlossen", formatDateTime(r.completed_at)] as [string, ReactNode]] : []),
        ...(r.cancelled_at ? [["Storniert", `${formatDateTime(r.cancelled_at)}${r.cancellation_reason ? ` – ${r.cancellation_reason}` : ""}`] as [string, ReactNode]] : []),
        ...(r.rejection_reason ? [["Ablehnungsgrund", r.rejection_reason] as [string, ReactNode]] : []),
      ]} />
    </>
  );
}

function Contact({ detail }: { detail: RequestDetail }) {
  const r = detail.request;
  return (
    <Facts items={[
      ["Firma", r.company_name],
      ["Kundennummer", r.customer_number],
      ["Ansprechperson", r.contact_name],
      ["E-Mail", <a key="mail" href={`mailto:${r.business_email}`}>{r.business_email}</a>],
      ["Telefon", <a key="tel" href={`tel:${r.phone_number.replace(/[^\d+]/g, "")}`}>{r.phone_number}</a>],
      ["Adresse", `${r.street_house_number}, ${r.postal_code} ${r.city}`],
      ["Standort", r.site_label],
    ]} />
  );
}

function Equipment({ detail }: { detail: RequestDetail }) {
  const r = detail.request;
  return (
    <>
      <Facts items={[
        ["Anlagenart", label("equipment_kind", r.equipment_kind)],
        ["Leistungsart", label("service_kind", r.service_kind)],
        ["Hersteller", r.manufacturer],
        ["Modell / Typ", r.model_type],
        ["Maschinennummer", r.machine_number ? <span key="m" className="mono">{r.machine_number}</span> : null],
        ["Sicherheitsgefahr", label("safety_risk", r.safety_risk)],
        ["SLA-Vertrag", r.sla_contract_number],
        ["24/7-Notfall-SLA angegeben", yesNo(r.emergency_sla_claimed)],
        ["SLA geprüft", yesNo(r.sla_verified)],
      ]} />
      <div className="text-block">
        <h3>Beschreibung des Kunden</h3>
        <p>{r.description}</p>
      </div>
    </>
  );
}

function Intake({ detail, person }: { detail: RequestDetail; person: PersonFn }) {
  const r = detail.request;
  const runs = detail.automationRuns ?? [];
  const columns: Column<(typeof runs)[number]>[] = [
    { key: "step", header: "Schritt", cell: (run) => STEP_LABELS[run.step] ?? run.step, mobile: "title" },
    { key: "status", header: "Status", cell: (run) => <StatusBadge kind="automation_status" value={run.status} /> },
    { key: "decision", header: "Entscheidung", cell: (run) => (run.decision ? DECISION_LABELS[run.decision] ?? run.decision : EMPTY) },
    { key: "confidence", header: "Konfidenz", cell: (run) => (run.confidence === null ? EMPTY : formatPercent(run.confidence * 100, 0)), align: "end" },
    { key: "started", header: "Start", cell: (run) => formatDateTime(run.started_at) },
    { key: "correction", header: "Korrektur", cell: (run) => (run.corrected_at ? `${person(run.corrected_by, "Unbekannt")}: ${run.correction_reason ?? ""}` : EMPTY) },
  ];
  return (
    <>
      <Facts items={[
        ["Status", <StatusBadge key="s" kind="intake_status" value={r.intake_status} />],
        ["Bearbeitungsart", r.intake_mode ? label("intake_mode", r.intake_mode) : "Noch offen"],
        ["Abgeschlossen am", formatDateTime(r.intake_completed_at)],
        ["Basiswert manuelle Bearbeitung", r.manual_minutes_baseline === null ? null : formatMinutes(r.manual_minutes_baseline)],
        ["Erste inhaltliche Antwort", formatDateTime(r.first_substantive_response_at)],
        ["Menschliche Prüfung erforderlich", yesNo(r.human_review_required)],
      ]} />
      <h3>Automatisierungsläufe</h3>
      <DataTable caption="Automatisierungsläufe" columns={columns} rows={runs} rowKey={(run) => run.id} empty={<EmptyState title="Keine Automatisierungsläufe." />} />
    </>
  );
}

const STEP_LABELS: Record<string, string> = { intake_analysis: "Analyse der Anfrage", reply_analysis: "Analyse der Kundenantwort", email_matching: "E-Mail-Zuordnung", email_send: "E-Mail-Versand" };
const DECISION_LABELS: Record<string, string> = { ready_for_planning: "Bereit zur Planung", ask_customer: "Rückfrage an Kunden", human_review: "Menschliche Prüfung", matched: "Zugeordnet", unmatched: "Nicht zugeordnet", sent: "Versendet" };
const MESSAGE_KIND_LABELS: Record<string, string> = { receipt: "Eingangsbestätigung", clarification: "Rückfrage", customer_reply: "Kundenantwort", invoice: "Rechnung", other: "Sonstige" };

function Correspondence({ detail, person }: { detail: RequestDetail; person: PersonFn }) {
  const messages = detail.messages ?? [];
  if (messages.length === 0) return <EmptyState title="Keine Nachrichten zu dieser Anfrage." />;
  return (
    <>
      <p className="section-note">Es werden keine E-Mails aus dem Dashboard versendet. „In Warteschlange“ bedeutet noch nicht versendet; nur „Versand bestätigt“ meldet die Integration.</p>
      <ul className="message-list">
        {messages.map((message) => {
          const incoming = message.direction === "incoming";
          const when = message.received_at ?? message.sent_at ?? message.created_at;
          return (
            <li key={message.id} className={`message message--${message.direction}`}>
              <details>
                <summary>
                  <span className="message__head">
                    <span className="message__direction">{incoming ? "Eingehend" : "Ausgehend"} · {MESSAGE_KIND_LABELS[message.kind] ?? message.kind}</span>
                    <StatusBadge kind="message_status" value={message.status} />
                  </span>
                  <strong>{message.subject}</strong>
                  <span className="message__meta">{incoming ? `Von ${message.from_address ?? EMPTY}` : `An ${message.to_address ?? EMPTY}`} · {formatDateTime(when)}</span>
                </summary>
                <div className="message__body">
                  <p>{message.body_text}</p>
                  {message.author_id && <p className="message__meta">Verfasst von {person(message.author_id, "Unbekannt")}</p>}
                  {message.error_text && <p className="message__error">Fehler: {message.error_text}</p>}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Visits({ detail, person }: { detail: RequestDetail; person: PersonFn }) {
  const columns: Column<RequestDetail["visits"][number]>[] = [
    { key: "time", header: "Termin", cell: (visit) => formatTimeRange(visit.scheduled_start, visit.scheduled_end), mobile: "title" },
    { key: "technician", header: "Techniker", cell: (visit) => person(visit.technician_id) },
    { key: "status", header: "Status", cell: (visit) => <StatusBadge kind="visit_status" value={visit.status} /> },
    { key: "actual", header: "Tatsächlich", cell: (visit) => (visit.actual_start ? `${formatDateTime(visit.actual_start)}${visit.actual_end ? ` – ${formatDateTime(visit.actual_end)}` : ""}` : EMPTY), mobile: "hide" },
    { key: "minutes", header: "Arbeitszeit", cell: (visit) => (visit.actual_work_minutes === null ? EMPTY : formatMinutes(visit.actual_work_minutes)), align: "end" },
    { key: "note", header: "Bemerkung", cell: (visit) => visit.summary ?? visit.waiting_reason ?? visit.cancellation_reason ?? EMPTY },
  ];
  return <DataTable caption="Einsätze" columns={columns} rows={detail.visits} rowKey={(visit) => visit.id} empty={<EmptyState title="Noch kein Einsatz geplant." />} />;
}

function Work({ detail, person }: { detail: RequestDetail; person: PersonFn }) {
  const entries = detail.workEntries;
  const active = entries.filter((entry) => entry.item_status !== "cancelled");
  const net = active.reduce((sum, entry) => sum + Math.round(entry.quantity * entry.unit_price * 100) / 100, 0);
  const columns: Column<(typeof entries)[number]>[] = [
    { key: "description", header: "Position", cell: (entry) => entry.description, mobile: "title" },
    { key: "kind", header: "Art", cell: (entry) => label("work_entry_kind", entry.kind) },
    { key: "quantity", header: "Menge", cell: (entry) => `${formatNumber(entry.quantity, entry.unit === "hour" ? 2 : 0)} ${label("work_unit", entry.unit)}`, align: "end" },
    { key: "price", header: "Einzelpreis", cell: (entry) => formatCurrency(entry.unit_price), align: "end" },
    { key: "status", header: "Status", cell: (entry) => <StatusBadge kind="work_item_status" value={entry.item_status} /> },
    { key: "billable", header: "Abrechenbar", cell: (entry) => (entry.billable ? "Ja" : "Nein"), mobile: "hide" },
    { key: "author", header: "Erfasst von", cell: (entry) => person(entry.author_id, "Unbekannt"), mobile: "hide" },
  ];
  return (
    <>
      {detail.request.completion_summary && (
        <div className="text-block">
          <h3>Abschlussbericht</h3>
          <p>{detail.request.completion_summary}</p>
        </div>
      )}
      <DataTable caption="Arbeitspositionen" columns={columns} rows={entries} rowKey={(entry) => entry.id} empty={<EmptyState title="Noch keine Arbeitspositionen erfasst." />} />
      {active.length > 0 && <p className="section-note">Summe netto ohne stornierte Positionen: <strong>{formatCurrency(net)}</strong></p>}
    </>
  );
}

const FILE_TYPES: Record<string, string> = { "application/pdf": "PDF", "image/jpeg": "Bild (JPEG)", "image/png": "Bild (PNG)" };

function Documents({ detail, person }: { detail: RequestDetail; person: PersonFn }) {
  const columns: Column<RequestDetail["attachments"][number]>[] = [
    { key: "name", header: "Datei", cell: (file) => <a href={`/dashboard/anfragen/${detail.request.id}/dokumente/${file.id}`} target="_blank" rel="noopener">{file.file_name}</a>, mobile: "title" },
    { key: "type", header: "Typ", cell: (file) => FILE_TYPES[file.mime_type] ?? file.mime_type },
    { key: "size", header: "Größe", cell: (file) => `${formatNumber(file.size_bytes / 1024, 0)} KB`, align: "end" },
    { key: "visibility", header: "Sichtbar für", cell: (file) => label("visibility_level", file.visibility) },
    { key: "by", header: "Hochgeladen", cell: (file) => `${formatDateTime(file.created_at)}${file.uploaded_by ? ` · ${person(file.uploaded_by, "Unbekannt")}` : ""}`, mobile: "hide" },
  ];
  return <DataTable caption="Dokumente" columns={columns} rows={detail.attachments} rowKey={(file) => file.id} empty={<EmptyState title="Keine Dokumente sichtbar." />} />;
}

function Invoice({ detail }: { detail: RequestDetail }) {
  const invoice = detail.invoice;
  if (!invoice) return <EmptyState title="Noch keine Rechnung." />;
  const columns: Column<RequestDetail["invoiceItems"][number]>[] = [
    { key: "position", header: "Pos.", cell: (item) => item.position, mobile: "hide" },
    { key: "description", header: "Beschreibung", cell: (item) => item.description, mobile: "title" },
    { key: "quantity", header: "Menge", cell: (item) => `${formatNumber(item.quantity, item.unit === "hour" ? 2 : 0)} ${label("work_unit", item.unit)}`, align: "end" },
    { key: "price", header: "Einzelpreis", cell: (item) => formatCurrency(item.unit_price), align: "end" },
    { key: "tax", header: "USt.", cell: (item) => formatPercent(item.tax_rate, 0), align: "end" },
    { key: "net", header: "Netto", cell: (item) => formatCurrency(item.net_amount), align: "end" },
  ];
  return (
    <>
      {invoice.status === "draft" && <p className="section-note">Entwurf: Positionen und Beträge sind eine Vorschau und werden bei der Ausstellung neu berechnet.</p>}
      <Facts items={[
        ["Status", <StatusBadge key="s" kind="invoice_status" value={invoice.status} />],
        ["Rechnungsnummer", invoice.invoice_number ? <span key="n" className="mono">{invoice.invoice_number}</span> : "Wird bei Ausstellung vergeben"],
        ["Rechnungsdatum", formatCalendarDate(invoice.issue_date)],
        ["Fällig am", formatCalendarDate(invoice.payment_due_date)],
        ["Als versendet markiert", formatDateTime(invoice.sent_at)],
        ["Bezahlt am", formatDateTime(invoice.paid_at)],
      ]} />
      <DataTable caption="Rechnungspositionen" columns={columns} rows={detail.invoiceItems} rowKey={(item) => item.id} empty={<EmptyState title="Keine Positionen." />} />
      <dl className="totals">
        <div><dt>Netto</dt><dd>{formatCurrency(invoice.subtotal, invoice.currency)}</dd></div>
        <div><dt>Umsatzsteuer</dt><dd>{formatCurrency(invoice.tax_total, invoice.currency)}</dd></div>
        <div className="totals__sum"><dt>Gesamt</dt><dd>{formatCurrency(invoice.total, invoice.currency)}</dd></div>
      </dl>
      <p className="section-note">Musterrechnung mit Demodaten, nicht rechtsverbindlich.</p>
    </>
  );
}

const ACTOR_LABELS = { automation: "Automatisierung", system: "System" } as const;

function History({ detail, names }: { detail: RequestDetail; names: Map<string, string> }) {
  if (detail.events.length === 0) return <EmptyState title="Keine Ereignisse sichtbar." />;
  return (
    <ol className="timeline">
      {detail.events.map((event) => {
        const { title, change } = describeEvent(event, names);
        const actor = event.actor_type === "user" ? names.get(event.actor_id ?? "") ?? "Unbekannte Person" : ACTOR_LABELS[event.actor_type];
        return (
          <li key={event.id}>
            <time dateTime={event.occurred_at}>{formatDateTime(event.occurred_at)}</time>
            <div>
              <strong>{title}</strong>
              {change && <span className="timeline__change">{change}</span>}
              {event.note && <span className="timeline__note">{event.note}</span>}
              <span className="timeline__actor">{actor}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

