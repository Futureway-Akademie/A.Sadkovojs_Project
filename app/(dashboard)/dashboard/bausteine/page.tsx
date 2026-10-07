import type { Metadata } from "next";
import { DataTable, CardList, type Column } from "@/components/dashboard/ui/data-table";
import { CheckboxField, SaveForm, SelectField, TextAreaField, TextField } from "@/components/dashboard/ui/save-form";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/dashboard/ui/states";
import { StatusBadge } from "@/components/dashboard/ui/status-badge";
import { requireRole } from "@/lib/auth/session";
import { formatCalendarDate, formatCurrency, formatDate, formatDateTime, formatMinutes, formatPercent, formatTimeRange } from "@/lib/format";
import { label, STATUS, type StatusKind } from "@/lib/status";
import { saveExample } from "./actions";

export const metadata: Metadata = { title: "UI-Bausteine" };

// Internal overview of the shared dashboard components (admin only, not in the navigation).
// All values are fixed examples; nothing is read from or written to the database.
type ExampleRow = { id: string; number: string; company: string; intake: string; work: string; priority: string; received: string; total: number };

const rows: ExampleRow[] = [
  { id: "1", number: "RIS-2026-00412", company: "Muster Pumpentechnik GmbH", intake: "needs_review", work: "not_planned", priority: "high", received: "2026-10-07T06:42:00Z", total: 0 },
  { id: "2", number: "RIS-2026-00398", company: "Beispiel Lüftung & Klima AG", intake: "processed", work: "scheduled", priority: "normal", received: "2026-10-05T13:05:00Z", total: 1240.5 },
  { id: "3", number: "RIS-2026-00377", company: "Demo Druckluft KG", intake: "processed", work: "waiting_parts", priority: "critical", received: "2026-09-29T08:15:00Z", total: 3895.2 },
];

const columns: Column<ExampleRow>[] = [
  { key: "number", header: "Nummer", cell: (row) => <span className="mono">{row.number}</span>, mobile: "title" },
  { key: "company", header: "Kunde", cell: (row) => row.company },
  { key: "intake", header: "Erstbearbeitung", cell: (row) => <StatusBadge kind="intake_status" value={row.intake} /> },
  { key: "work", header: "Arbeit", cell: (row) => <StatusBadge kind="work_status" value={row.work} /> },
  { key: "priority", header: "Priorität", cell: (row) => <StatusBadge kind="request_priority" value={row.priority} /> },
  { key: "received", header: "Eingang", cell: (row) => formatDateTime(row.received), mobile: "hide" },
  { key: "total", header: "Betrag", cell: (row) => formatCurrency(row.total), align: "end" },
];

const statusKinds: StatusKind[] = ["intake_status", "work_status", "visit_status", "invoice_status", "message_status", "request_priority"];

export default async function ComponentsPage() {
  await requireRole(["admin"]);
  return (
    <div className="dash-page">
      <PageHeader title="UI-Bausteine" description="Interne Übersicht der gemeinsamen Dashboard-Komponenten mit Beispielwerten. Es werden keine Daten gelesen oder geändert." />

      <section className="dash-section" aria-labelledby="ui-status">
        <h2 id="ui-status">Statusanzeigen</h2>
        {statusKinds.map((kind) => (
          <div key={kind} className="badge-row">
            {Object.keys(STATUS[kind]).map((value) => <StatusBadge key={value} kind={kind} value={value} />)}
          </div>
        ))}
      </section>

      <section className="dash-section" aria-labelledby="ui-table">
        <h2 id="ui-table">Tabelle</h2>
        <DataTable caption="Beispielanfragen" columns={columns} rows={rows} rowKey={(row) => row.id} rowHref={() => "/dashboard/bausteine"} empty={<EmptyState title="Keine Anfragen" />} />
        <h3>Leere Tabelle</h3>
        <DataTable caption="Leere Beispielliste" columns={columns} rows={[]} rowKey={(row) => row.id} empty={<EmptyState title="Keine Anfragen in diesem Filter.">Filter anpassen oder Zeitraum erweitern.</EmptyState>} />
        <h3>Kartenliste</h3>
        <CardList
          label="Beispieleinsätze"
          items={rows.slice(0, 2)}
          itemKey={(row) => row.id}
          empty={<EmptyState title="Heute keine Einsätze" />}
          renderItem={(row) => (
            <div className="card-list__item">
              <strong>{row.company}</strong>
              <span>{formatTimeRange("2026-10-07T06:00:00Z", "2026-10-07T08:30:00Z")}</span>
              <StatusBadge kind="visit_status" value={row.id === "1" ? "scheduled" : "in_progress"} />
            </div>
          )}
        />
      </section>

      <section className="dash-section" aria-labelledby="ui-states">
        <h2 id="ui-states">Lade-, Leer- und Fehlerzustand</h2>
        <LoadingState rows={2} />
        <EmptyState title="Keine offenen Prüfungen">Neue Anfragen erscheinen hier automatisch.</EmptyState>
        <ErrorState>Bitte die Seite neu laden.</ErrorState>
      </section>

      <section className="dash-section" aria-labelledby="ui-format">
        <h2 id="ui-format">Formatierung (de-DE, Europe/Berlin)</h2>
        <dl className="format-list">
          <dt>Datum</dt><dd>{formatDate("2026-03-29T00:30:00Z")}</dd>
          <dt>Datum und Uhrzeit</dt><dd>{formatDateTime("2026-10-07T12:30:00Z")}</dd>
          <dt>Zeitraum</dt><dd>{formatTimeRange("2026-10-07T06:00:00Z", "2026-10-07T08:30:00Z")}</dd>
          <dt>Kalenderdatum</dt><dd>{formatCalendarDate("2026-12-24")}</dd>
          <dt>Betrag</dt><dd>{formatCurrency(12345.6)}</dd>
          <dt>Anteil</dt><dd>{formatPercent(84)}</dd>
          <dt>Dauer</dt><dd>{formatMinutes(1500)}</dd>
          <dt>Leistungsart</dt><dd>{label("service_kind", "diagnosis_repair")}</dd>
        </dl>
      </section>

      <section className="dash-section" aria-labelledby="ui-form">
        <h2 id="ui-form">Formular mit Speicherzustand</h2>
        <SaveForm action={saveExample}>
          <div className="form-grid">
            <TextField name="company" label="Firma" required />
            <TextField name="hours" label="Stunden" required inputMode="decimal" hint="Dezimalzahl, z. B. 1,5" />
            <SelectField name="priority" label="Priorität" required options={Object.entries(STATUS.request_priority).map(([value, info]) => ({ value, label: info.label }))} />
          </div>
          <TextAreaField name="note" label="Notiz" />
          <CheckboxField name="simulate_conflict" label="Versionskonflikt simulieren (RW409)" />
        </SaveForm>
      </section>
    </div>
  );
}
