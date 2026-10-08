import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, type Column } from "@/components/dashboard/ui/data-table";
import { EmptyState, ErrorState, PageHeader } from "@/components/dashboard/ui/states";
import { StatusBadge } from "@/components/dashboard/ui/status-badge";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { DATE_FIELDS, filterQuery, getEmployeeNames, listRequests, PAGE_SIZE, parseRequestFilters, type RequestFilters, type RequestListItem } from "@/lib/dashboard/requests";
import { formatDateTime, formatNumber } from "@/lib/format";
import { label, STATUS } from "@/lib/status";

export const metadata: Metadata = { title: "Anfragen" };

const DESCRIPTIONS = {
  admin: "Alle Anfragen.",
  manager: "Alle Anfragen.",
  dispatcher: "Anfragen, die Ihnen aktuell zugewiesen sind.",
  technician: "Anfragen, die Ihnen zugewiesen sind oder in denen Sie einen Einsatz hatten.",
} as const;

export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const employee = await requireRole(rolesFor("/dashboard/anfragen"));
  const filters = parseRequestFilters(await searchParams);
  const [{ rows, total, error }, names] = await Promise.all([listRequests(filters), getEmployeeNames()]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(filters.q || filters.intake || filters.work || filters.priority || filters.field || filters.mode || filters.open);
  const selection = describeSelection(filters);

  const columns: Column<RequestListItem>[] = [
    { key: "number", header: "Nummer", cell: (row) => <span className="mono">{row.request_number}</span>, mobile: "title" },
    { key: "company", header: "Kunde", cell: (row) => <>{row.company_name}<span className="cell-sub">{row.city}</span></> },
    { key: "service", header: "Leistung", cell: (row) => <>{label("service_kind", row.service_kind)}<span className="cell-sub">{label("equipment_kind", row.equipment_kind)}</span></>, mobile: "hide" },
    { key: "intake", header: "Erstbearbeitung", cell: (row) => <StatusBadge kind="intake_status" value={row.intake_status} /> },
    { key: "work", header: "Arbeit", cell: (row) => <StatusBadge kind="work_status" value={row.work_status} /> },
    { key: "priority", header: "Priorität", cell: (row) => (row.priority ? <StatusBadge kind="request_priority" value={row.priority} /> : <span className="muted">Offen</span>) },
    ...(employee.role === "technician" ? [] : [{ key: "dispatcher", header: "Dispatcher", cell: (row: RequestListItem) => (row.dispatcher_id ? names.get(row.dispatcher_id) : <span className="muted">Nicht zugewiesen</span>), mobile: "hide" as const }]),
    { key: "created", header: "Eingang", cell: (row) => formatDateTime(row.created_at) },
  ];

  return (
    <div className="dash-page">
      <PageHeader title="Anfragen" description={DESCRIPTIONS[employee.role]} />

      <form className="filter-bar" method="get" role="search" aria-label="Anfragen filtern">
        <label className="field" htmlFor="filter-suche">
          <span>Suche</span>
          <input id="filter-suche" name="suche" type="search" defaultValue={filters.q} placeholder="Nummer, Firma, Kontakt, Ort" />
        </label>
        <FilterSelect name="erstbearbeitung" label="Erstbearbeitung" value={filters.intake} options={STATUS.intake_status} />
        <FilterSelect name="arbeit" label="Arbeit" value={filters.work} options={STATUS.work_status} />
        <FilterSelect name="prioritaet" label="Priorität" value={filters.priority} options={STATUS.request_priority} />
        {/* Selection from the overview stays active when filtering further */}
        {filters.field && <><input type="hidden" name="feld" value={filters.field} /><input type="hidden" name="von" value={filters.from} /><input type="hidden" name="bis" value={filters.to} /></>}
        {filters.mode && <input type="hidden" name="modus" value={filters.mode} />}
        {filters.open && <input type="hidden" name="status" value="offen" />}
        <div className="filter-bar__actions">
          <button className="button button--primary" type="submit">Filtern</button>
          {filtered && <Link className="button button--secondary" href="/dashboard/anfragen">Zurücksetzen</Link>}
        </div>
      </form>

      {selection.length > 0 && (
        <p className="active-selection">
          <span>Auswahl: {selection.join(" · ")}</span>
          <Link href={`/dashboard/anfragen${filterQuery({ ...filters, field: "", from: "", to: "", mode: "", open: false, page: 1 })}`}>Auswahl entfernen</Link>
        </p>
      )}

      {error ? (
        <ErrorState><p>Bitte die Seite neu laden.</p></ErrorState>
      ) : (
        <>
          <p className="result-count" role="status">
            {formatNumber(total)} {total === 1 ? "Anfrage" : "Anfragen"}{filtered ? " gefunden" : ""}
            {total > 0 && pages > 1 && <> · Seite {filters.page} von {pages}</>}
          </p>
          <DataTable
            caption="Anfragen"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            rowHref={(row) => `/dashboard/anfragen/${row.id}`}
            empty={
              <EmptyState
                title={filtered ? "Keine Anfragen zu diesem Filter." : "Keine Anfragen vorhanden."}
                action={filtered ? <Link href="/dashboard/anfragen">Filter zurücksetzen</Link> : undefined}
              />
            }
          />
          {pages > 1 && (
            <nav className="pagination" aria-label="Seiten">
              {filters.page > 1 ? <Link href={`/dashboard/anfragen${filterQuery(filters, { page: filters.page - 1 })}`} rel="prev">← Zurück</Link> : <span aria-hidden="true" />}
              <span>Seite {filters.page} von {pages}</span>
              {filters.page < pages ? <Link href={`/dashboard/anfragen${filterQuery(filters, { page: filters.page + 1 })}`} rel="next">Weiter →</Link> : <span aria-hidden="true" />}
            </nav>
          )}
        </>
      )}
    </div>
  );
}

// Readable description of filters that only come from links (overview KPIs)
function describeSelection(filters: RequestFilters): string[] {
  const parts: string[] = [];
  if (filters.field) parts.push(`${DATE_FIELDS[filters.field].label} ${formatDateTime(filters.from)} bis vor ${formatDateTime(filters.to)}`);
  if (filters.mode) parts.push(`Bearbeitungsart: ${label("intake_mode", filters.mode)}`);
  if (filters.open) parts.push("nur offene Anfragen");
  return parts;
}

function FilterSelect({ name, label: text, value, options }: { name: string; label: string; value: string; options: Record<string, { label: string }> }) {
  return (
    <label className="field" htmlFor={`filter-${name}`}>
      <span>{text}</span>
      <select id={`filter-${name}`} name={name} defaultValue={value}>
        <option value="">Alle</option>
        {Object.entries(options).map(([key, info]) => <option key={key} value={key}>{info.label}</option>)}
      </select>
    </label>
  );
}
