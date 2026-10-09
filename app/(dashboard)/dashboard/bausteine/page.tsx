import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, CardList, type Column } from "@/components/dashboard/ui/data-table";
import { CheckboxField, SaveForm, SelectField, TextAreaField, TextField } from "@/components/dashboard/ui/save-form";
import { Card, Zone } from "@/components/dashboard/ui/card";
import { KpiCompact, KpiMore, KpiTile } from "@/components/dashboard/ui/kpi-tile";
import { Legend, PeriodChip } from "@/components/dashboard/ui/legend";
import { EmptyState, ErrorState, LoadingState, NoticeState, PageHeader } from "@/components/dashboard/ui/states";
import { HazardFlag, InvoiceStatusChip, PriorityText, StatusChip } from "@/components/dashboard/ui/status-chip";
import { formatKpiChange } from "@/lib/analytics";
import { CHART_COLORS } from "@/lib/chart-colors";
import { invoiceDisplayStatus, REQUEST_DISPLAY_STATUSES } from "@/lib/display-status";
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

// Example metrics: change and assessment are computed by the same functions as on the overview
const kpiExamples = [
  { key: "received", label: "Eingegangene Anfragen", value: "21", previous: "11", row: { unit: "count", current_value: 21, previous_value: 11, difference: 10, change_percent: 90.9 } },
  { key: "completed", label: "Abgeschlossene Anfragen", value: "12", previous: "9", row: { unit: "count", current_value: 12, previous_value: 9, difference: 3, change_percent: 33.3 } },
  { key: "lead_time_days", label: "Durchlaufzeit bis Abschluss", value: "12,5 Tage", previous: "7,7 Tage", row: { unit: "days", current_value: 12.5, previous_value: 7.7, difference: 4.8, change_percent: 62.3 } },
  { key: "review_queue", label: "Prüfung", value: "5", previous: "0", row: { unit: "count", current_value: 5, previous_value: 0, difference: 5, change_percent: null } },
] as const;

const statusKinds: StatusKind[] = ["intake_status", "work_status", "visit_status", "invoice_status", "message_status", "request_priority"];

export default async function ComponentsPage() {
  await requireRole(["admin"]);
  return (
    <div className="dash-page">
      <PageHeader title="UI-Bausteine" description="Interne Übersicht der gemeinsamen Dashboard-Komponenten mit Beispielwerten. Es werden keine Daten gelesen oder geändert." />

      <Zone id="ui-design" title="Design 2026" note="Bausteine der Überarbeitung (task-10-3)">
        <div className="rw-kpi-grid">
          {(["danger", "attention", "action", "neutral", "meta", "success"] as const).map((stripe) => (
            <Card key={stripe} stripe={stripe} title={`Strich: ${stripe}`} count={3} description="Die Linie oben klassifiziert den Inhalt.">
              <p>Inhalt der Karte.</p>
            </Card>
          ))}
        </div>
        <div className="rw-kpi-grid">
          {kpiExamples.map((kpi) => (
            <KpiTile key={kpi.key} label={kpi.label} value={kpi.value} previous={kpi.previous} change={formatKpiChange({ key: kpi.key, ...kpi.row })} definition="Definitionstext aus dem Kennzahlen-Wörterbuch." href="/dashboard/bausteine" />
          ))}
        </div>
        <KpiMore count={2}>
          {kpiExamples.slice(0, 2).map((kpi) => (
            <KpiCompact key={kpi.key} label={kpi.label} value={kpi.value} previous={kpi.previous} change={formatKpiChange({ key: kpi.key, ...kpi.row })} />
          ))}
        </KpiMore>
        <Card stripe="meta" title="Status je Anfrage und Rechnung">
          <div className="badge-row">{REQUEST_DISPLAY_STATUSES.map((status) => <StatusChip key={status.key} status={status} />)}</div>
          <div className="badge-row">
            {([["draft", null], ["issued", "2026-10-20"], ["sent", "2026-10-20"], ["sent", "2026-09-29"], ["paid", "2026-10-01"]] as const).map(([status, due]) => (
              <InvoiceStatusChip key={`${status}${due}`} status={invoiceDisplayStatus(status, due, "2026-10-08")} />
            ))}
          </div>
          <div className="badge-row">
            <PriorityText priority="critical" /><PriorityText priority="high" /><PriorityText priority="normal" /><PriorityText priority="low" /><PriorityText priority={null} />
            <HazardFlag risk="unclear" /><HazardFlag risk="known" />
          </div>
        </Card>
        <Card stripe="meta" title="Legende" action={<PeriodChip>24 Monate</PeriodChip>}>
          <Legend items={[{ label: "Eingang", color: CHART_COLORS[0] }, { label: "Erstbearbeitung abgeschlossen", color: CHART_COLORS[1] }, { label: "Technisch abgeschlossen", color: CHART_COLORS[2] }]} />
        </Card>
        <div className="rw-kpi-grid">
          <Card stripe="success" title="Sicherheitsgefahr offen" count={0}>
            <EmptyState tone="good" title="Keine offenen Sicherheitsgefahren">Neue Fälle erscheinen hier sofort.</EmptyState>
          </Card>
          <Card title="Wartet auf Kunde" count={0}>
            <EmptyState title="Keine Anfragen in dieser Ansicht" action={<Link className="rw-button-secondary" href="/dashboard/bausteine">Suche zurücksetzen</Link>}>Suche „Moers“ · Ansicht „Wartet auf Kunde“</EmptyState>
          </Card>
          <Card title="Eingegangene Anfragen" busy>
            <LoadingState shape="kpi" label="Kennzahl wird geladen …" />
          </Card>
          <Card title="Anfragen" busy>
            <LoadingState shape="table" rows={3} label="Liste wird geladen …" />
          </Card>
          <Card title="Durchsatz je Monat" busy action={<PeriodChip>24 Monate</PeriodChip>}>
            <LoadingState shape="chart" label="Diagramm wird geladen …" />
          </Card>
          <Card stripe="danger" title="Finanzen">
            <ErrorState title="Finanzdaten konnten nicht geladen werden." action={<Link className="rw-button-secondary" href="/dashboard/bausteine">Erneut versuchen</Link>}>Die übrigen Kennzahlen sind aktuell.</ErrorState>
          </Card>
          <Card stripe="attention" title="Fotos" count="(2)">
            <NoticeState title="Keine Verbindung.">1 Foto ist auf dem Gerät gespeichert und wird gesendet, sobald wieder Netz da ist.</NoticeState>
          </Card>
        </div>
      </Zone>

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
