import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, type Column } from "@/components/dashboard/ui/data-table";
import { EmptyState, ErrorState } from "@/components/dashboard/ui/states";
import { HazardFlag, PriorityText, RequestStatusChip } from "@/components/dashboard/ui/status-chip";
import { Icon } from "@/components/ui";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { DATE_FIELDS, countViews, filterQuery, getEmployeeNames, listRequests, PAGE_SIZE, parseRequestFilters, viewsFor, type RequestFilters, type RequestListItem } from "@/lib/dashboard/requests";
import { REQUEST_DISPLAY_STATUSES } from "@/lib/display-status";
import { formatDate, formatNumber, formatTime } from "@/lib/format";
import { label, STATUS } from "@/lib/status";

export const metadata: Metadata = { title: "Anfragen" };

const SCOPE = {
  admin: "Alle Anfragen",
  manager: "Alle Anfragen",
  dispatcher: "Ihnen zugewiesene Anfragen",
  technician: "Ihnen zugewiesene Anfragen und Anfragen mit eigenem Einsatz",
} as const;

// Request list (task-4-3, redesigned in task-10-3 after the canvas "Anfragen – Liste"): quick views
// with counts, one displayed status per request, search and further filters.
export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const employee = await requireRole(rolesFor("/dashboard/anfragen"));
  const filters = parseRequestFilters(await searchParams);
  const [{ rows, total, error }, names, counts] = await Promise.all([listRequests(filters, employee.id), getEmployeeNames(), countViews(employee.role, employee.id)]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const views = viewsFor(employee.role);
  const current = views.find((view) => view.key === filters.view) ?? views[0];
  const further = Boolean(filters.intake || filters.work || filters.priority || filters.display);
  const filtered = Boolean(filters.q || further || filters.field || filters.mode || filters.open || filters.hazard);
  const selection = describeSelection(filters);

  const columns: Column<RequestListItem>[] = [
    { key: "number", header: "Anfrage", cell: (row) => <><span className="mono">{row.request_number}</span><HazardFlag risk={row.safety_risk} /></>, mobile: "title" },
    { key: "company", header: "Kunde", cell: (row) => <><strong className="rw-strong">{row.company_name}</strong><span className="cell-sub">{row.city}</span></> },
    { key: "service", header: "Leistung", cell: (row) => <>{label("service_kind", row.service_kind)}<span className="cell-sub">{label("equipment_kind", row.equipment_kind)}</span></>, mobile: "hide" },
    { key: "status", header: "Status", cell: (row) => <RequestStatusChip intakeStatus={row.intake_status} workStatus={row.work_status} /> },
    { key: "priority", header: "Priorität", cell: (row) => <PriorityText priority={row.priority} /> },
    ...(employee.role === "technician" ? [] : [{
      key: "dispatcher",
      header: "Dispatcher",
      cell: (row: RequestListItem) => (row.dispatcher_id ? names.get(row.dispatcher_id) : <span className="rw-unassigned">Nicht zugewiesen</span>),
      mobile: "hide" as const,
    }]),
    { key: "created", header: "Eingang", cell: (row) => <><span className="mono">{formatDate(row.created_at)}</span><span className="cell-sub mono">{formatTime(row.created_at)}</span></> },
  ];

  return (
    <div className="dash-page rw-page rw-page--tight">
      <header className="dash-page-header">
        <div>
          <h1>Anfragen</h1>
          <p className="rw-page__sub">
            {SCOPE[employee.role]} · <span className="mono">{formatNumber(counts.alle ?? 0)}</span> insgesamt · <span className="mono">{formatNumber(counts.offen ?? 0)}</span> offen
          </p>
        </div>
        <form className="rw-search" method="get" role="search" aria-label="Anfragen durchsuchen">
          <label className="sr-only" htmlFor="filter-suche">Suche</label>
          <input id="filter-suche" className="rw-input" name="suche" type="search" defaultValue={filters.q} placeholder="Nummer, Firma, Kontakt, Ort" />
          <HiddenFilters filters={filters} skip="suche" />
          <button className="rw-button-secondary" type="submit">Suchen</button>
        </form>
      </header>

      <nav className="rw-views" aria-label="Ansichten">
        {views.map((view) => {
          const active = view.key === filters.view;
          return (
            <Link
              key={view.key}
              href={`/dashboard/anfragen${filterQuery(filters, { view: view.key, page: 1 })}`}
              aria-current={active ? "page" : undefined}
              className={`rw-view${"hazard" in view ? " rw-view--hazard" : ""}`}
            >
              {"hazard" in view && <Icon name="hazard" size={16} />}
              {view.label}
              <span className="rw-view__count mono">{counts[view.key] === undefined ? "–" : formatNumber(counts[view.key]!)}</span>
            </Link>
          );
        })}
      </nav>

      <details className="rw-more-filters" open={further || undefined}>
        <summary><Icon name="chevron-down" size={18} />Weitere Filter{further && <span className="rw-view__count mono">aktiv</span>}</summary>
        <form className="filter-bar" method="get" aria-label="Anfragen filtern">
          <label className="field" htmlFor="filter-anzeige">
            <span>Status</span>
            <select id="filter-anzeige" name="anzeige" defaultValue={filters.display}>
              <option value="">Alle</option>
              {REQUEST_DISPLAY_STATUSES.map((status) => <option key={status.key} value={status.key}>{status.label}</option>)}
            </select>
          </label>
          <FilterSelect name="erstbearbeitung" label="Erstbearbeitung" value={filters.intake} options={STATUS.intake_status} />
          <FilterSelect name="arbeit" label="Arbeit" value={filters.work} options={STATUS.work_status} />
          <FilterSelect name="prioritaet" label="Priorität" value={filters.priority} options={STATUS.request_priority} />
          <HiddenFilters filters={filters} skip="further" />
          <div className="filter-bar__actions">
            <button className="rw-button-secondary" type="submit">Filter anwenden</button>
            {further && <Link className="rw-link-btn" href={`/dashboard/anfragen${filterQuery(filters, { intake: "", work: "", priority: "", display: "", page: 1 })}`}>Filter entfernen</Link>}
          </div>
        </form>
      </details>

      {selection.length > 0 && (
        <p className="active-selection">
          <span>Auswahl: {selection.join(" · ")}</span>
          <Link href={`/dashboard/anfragen${filterQuery({ ...filters, field: "", from: "", to: "", mode: "", open: false, hazard: false, page: 1 })}`}>Auswahl entfernen</Link>
        </p>
      )}

      {error ? (
        <ErrorState title="Die Anfragen konnten nicht geladen werden." action={<Link className="rw-button-secondary" href={`/dashboard/anfragen${filterQuery(filters)}`}>Erneut versuchen</Link>}>
          Suche und Filter bleiben erhalten.
        </ErrorState>
      ) : (
        <>
          <div className="rw-list-meta">
            <p className="result-count" role="status">
              {formatNumber(total)} {total === 1 ? "Anfrage" : "Anfragen"} · {current.label}
              {total > 0 && pages > 1 && <> · Seite <span className="mono">{filters.page}</span> von <span className="mono">{pages}</span></>}
            </p>
            <span>Sortiert nach Eingang, neueste zuerst</span>
          </div>
          <DataTable
            caption="Anfragen"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            rowHref={(row) => `/dashboard/anfragen/${row.id}`}
            empty={
              <EmptyState
                title={filters.view === "offen" && !filtered ? "Keine offenen Anfragen" : "Keine Anfragen in dieser Ansicht"}
                action={filtered || filters.view !== "offen" ? (
                  <>
                    {filtered && <Link className="rw-button-secondary" href={`/dashboard/anfragen${filterQuery({ ...filters, q: "", intake: "", work: "", priority: "", display: "", field: "", from: "", to: "", mode: "", open: false, hazard: false, page: 1 })}`}>Suche und Filter zurücksetzen</Link>}
                    <Link className="rw-link-btn" href="/dashboard/anfragen?ansicht=offen">Alle offenen anzeigen</Link>
                  </>
                ) : undefined}
              >
                {[filters.q && `Suche „${filters.q}“`, `Ansicht „${current.label}“`, ...selection].filter(Boolean).join(" · ")}
              </EmptyState>
            }
          />
          {pages > 1 && (
            <nav className="pagination" aria-label="Seiten">
              {filters.page > 1 ? <Link href={`/dashboard/anfragen${filterQuery(filters, { page: filters.page - 1 })}`} rel="prev">← Vorherige Seite</Link> : <span aria-hidden="true" />}
              <span>Seite <span className="mono">{filters.page}</span> von <span className="mono">{pages}</span></span>
              {filters.page < pages ? <Link href={`/dashboard/anfragen${filterQuery(filters, { page: filters.page + 1 })}`} rel="next">Nächste Seite →</Link> : <span aria-hidden="true" />}
            </nav>
          )}
        </>
      )}
    </div>
  );
}

// Keeps the other filters when one form is submitted
function HiddenFilters({ filters, skip }: { filters: RequestFilters; skip: "suche" | "further" }) {
  return (
    <>
      <input type="hidden" name="ansicht" value={filters.view} />
      {skip !== "suche" && filters.q && <input type="hidden" name="suche" value={filters.q} />}
      {skip !== "further" && (
        <>
          {filters.display && <input type="hidden" name="anzeige" value={filters.display} />}
          {filters.intake && <input type="hidden" name="erstbearbeitung" value={filters.intake} />}
          {filters.work && <input type="hidden" name="arbeit" value={filters.work} />}
          {filters.priority && <input type="hidden" name="prioritaet" value={filters.priority} />}
        </>
      )}
      {/* Selection from the overview stays active when filtering further */}
      {filters.field && <><input type="hidden" name="feld" value={filters.field} /><input type="hidden" name="von" value={filters.from} /><input type="hidden" name="bis" value={filters.to} /></>}
      {filters.mode && <input type="hidden" name="modus" value={filters.mode} />}
      {filters.open && <input type="hidden" name="status" value="offen" />}
      {filters.hazard && <input type="hidden" name="gefahr" value="1" />}
    </>
  );
}

// Readable description of filters that only come from links (overview KPIs)
function describeSelection(filters: RequestFilters): string[] {
  const parts: string[] = [];
  if (filters.field) parts.push(`${DATE_FIELDS[filters.field].label} ${formatDate(filters.from)} ${formatTime(filters.from)} bis vor ${formatDate(filters.to)} ${formatTime(filters.to)}`);
  if (filters.mode) parts.push(`Bearbeitungsart: ${label("intake_mode", filters.mode)}`);
  if (filters.open) parts.push("nur offene Anfragen");
  if (filters.hazard) parts.push("mit Sicherheitsgefahr");
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
