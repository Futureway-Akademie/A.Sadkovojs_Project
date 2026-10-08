import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, type Column } from "@/components/dashboard/ui/data-table";
import { EmptyState, ErrorState, PageHeader } from "@/components/dashboard/ui/states";
import { StatusBadge } from "@/components/dashboard/ui/status-badge";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { INVOICE_DATE_FIELDS, INVOICE_PAGE_SIZE, INVOICE_STATES, invoiceQuery, listInvoices, parseInvoiceFilters, type InvoiceListItem } from "@/lib/dashboard/invoices";
import { formatCalendarDate, formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Rechnungen" };

// Invoice list (task-7-2): target of the finance KPIs of the overview. Issued is not collected.
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole(rolesFor("/dashboard/rechnungen"));
  const filters = parseInvoiceFilters(await searchParams);
  const { rows, total, sumGross, sumNet, error } = await listInvoices(filters);
  const pages = Math.max(1, Math.ceil(total / INVOICE_PAGE_SIZE));
  const filtered = Boolean(filters.q || filters.field || filters.state);

  const columns: Column<InvoiceListItem>[] = [
    { key: "number", header: "Rechnung", cell: (row) => <span className="mono">{row.invoice_number ?? "Entwurf"}</span>, mobile: "title" },
    { key: "customer", header: "Kunde", cell: (row) => <>{row.company_name}<span className="cell-sub mono">{row.request_number}</span></> },
    { key: "status", header: "Status", cell: (row) => <span className="badge-row"><StatusBadge kind="invoice_status" value={row.status} />{row.overdue && <span className="overdue-tag">Überfällig</span>}</span> },
    { key: "issued", header: "Ausgestellt", cell: (row) => formatCalendarDate(row.issue_date) },
    { key: "due", header: "Fällig", cell: (row) => formatCalendarDate(row.payment_due_date), mobile: "hide" },
    { key: "paid", header: "Bezahlt", cell: (row) => formatDate(row.paid_at), mobile: "hide" },
    { key: "net", header: "Netto", cell: (row) => formatCurrency(row.subtotal, row.currency), align: "end", mobile: "hide" },
    { key: "gross", header: "Brutto", cell: (row) => formatCurrency(row.total, row.currency), align: "end" },
  ];

  return (
    <div className="dash-page">
      <PageHeader title="Rechnungen" description="Alle Rechnungen. Ausgestellt ist nicht eingenommen: offen sind ausgestellte Rechnungen ohne erfasste Zahlung." />

      <form className="filter-bar" method="get" role="search" aria-label="Rechnungen filtern">
        <label className="field" htmlFor="filter-suche">
          <span>Rechnungsnummer</span>
          <input id="filter-suche" name="suche" type="search" defaultValue={filters.q} placeholder="RE-2026-…" />
        </label>
        <label className="field" htmlFor="filter-status">
          <span>Status</span>
          <select id="filter-status" name="status" defaultValue={filters.state}>
            <option value="">Alle</option>
            {Object.entries(INVOICE_STATES).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
          </select>
        </label>
        {filters.field && <><input type="hidden" name="feld" value={filters.field} /><input type="hidden" name="von" value={filters.from} /><input type="hidden" name="bis" value={filters.to} /></>}
        <div className="filter-bar__actions">
          <button className="button button--primary" type="submit">Filtern</button>
          {filtered && <Link className="button button--secondary" href="/dashboard/rechnungen">Zurücksetzen</Link>}
        </div>
      </form>

      {filters.field && (
        <p className="active-selection">
          <span>Auswahl: {INVOICE_DATE_FIELDS[filters.field].label} {formatDateTime(filters.from)} bis vor {formatDateTime(filters.to)}</span>
          <Link href={`/dashboard/rechnungen${invoiceQuery({ ...filters, field: "", from: "", to: "", page: 1 })}`}>Auswahl entfernen</Link>
        </p>
      )}

      {error ? (
        <ErrorState><p>Bitte die Seite neu laden.</p></ErrorState>
      ) : (
        <>
          <p className="result-count" role="status">
            {formatNumber(total)} {total === 1 ? "Rechnung" : "Rechnungen"} · Summe brutto <strong data-sum="gross">{formatCurrency(sumGross)}</strong> · netto {formatCurrency(sumNet)}
            {total > 0 && pages > 1 && <> · Seite {filters.page} von {pages}</>}
          </p>
          <DataTable
            caption="Rechnungen"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            rowHref={(row) => `/dashboard/anfragen/${row.request_id}#rechnung`}
            empty={<EmptyState title={filtered ? "Keine Rechnungen zu diesem Filter." : "Keine Rechnungen vorhanden."} action={filtered ? <Link href="/dashboard/rechnungen">Filter zurücksetzen</Link> : undefined} />}
          />
          {pages > 1 && (
            <nav className="pagination" aria-label="Seiten">
              {filters.page > 1 ? <Link href={`/dashboard/rechnungen${invoiceQuery(filters, { page: filters.page - 1 })}`} rel="prev">← Zurück</Link> : <span aria-hidden="true" />}
              <span>Seite {filters.page} von {pages}</span>
              {filters.page < pages ? <Link href={`/dashboard/rechnungen${invoiceQuery(filters, { page: filters.page + 1 })}`} rel="next">Weiter →</Link> : <span aria-hidden="true" />}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
