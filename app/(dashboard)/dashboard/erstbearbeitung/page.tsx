import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, type Column } from "@/components/dashboard/ui/data-table";
import { EmptyState, ErrorState, PageHeader } from "@/components/dashboard/ui/states";
import { StatusBadge } from "@/components/dashboard/ui/status-badge";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadQueue, QUEUE_TABS, tabFor, type QueueKey, type QueueRow } from "@/lib/dashboard/queues";
import { PAGE_SIZE } from "@/lib/dashboard/requests";
import { formatDateTime, formatElapsed, formatNumber } from "@/lib/format";
import { label } from "@/lib/status";

export const metadata: Metadata = { title: "Erstbearbeitung" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function IntakeQueuesPage({ searchParams }: Props) {
  const employee = await requireRole(rolesFor("/dashboard/erstbearbeitung"));
  const params = await searchParams;
  const tab = tabFor(typeof params.tab === "string" ? params.tab : undefined);
  const pageParam = Number.parseInt(typeof params.seite === "string" ? params.seite : "1", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const { counts, rows, total, now, error } = await loadQueue(employee.id, tab, page);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const minutesSince = (value: string | null) => (value ? (now - new Date(value).getTime()) / 60000 : null);
  const overdue = (row: QueueRow) => Boolean(row.due_at && new Date(row.due_at).getTime() < now);

  const queueColumns: Column<QueueRow>[] = [
    { key: "number", header: "Nummer", cell: (row) => <span className="mono">{row.request_number}</span>, mobile: "title" },
    { key: "company", header: "Kunde", cell: (row) => <>{row.company_name}<span className="cell-sub">{row.city} · {label("service_kind", row.service_kind)}</span></> },
    {
      key: "priority",
      header: "Priorität",
      cell: (row) => (row.priority ? <StatusBadge kind="request_priority" value={row.priority} /> : <span className="cell-sub cell-sub--inline">Kunde: {label("customer_urgency", row.customer_urgency)}</span>),
    },
    {
      key: "due",
      header: "Frist",
      cell: (row) => (row.due_at ? (
        <span className={overdue(row) ? "due due--overdue" : "due"}>
          {overdue(row) && <strong>Überfällig · </strong>}
          {formatDateTime(row.due_at)}
        </span>
      ) : <span className="muted">Keine</span>),
    },
    { key: "waiting", header: "Wartet seit", cell: (row) => <>{formatElapsed(minutesSince(row.waiting_since))}<span className="cell-sub">{formatDateTime(row.waiting_since)}</span></> },
    { key: "notes", header: "Hinweise", cell: (row) => <Hints row={row} /> },
  ];
  const allColumns: Column<QueueRow>[] = [
    queueColumns[0],
    queueColumns[1],
    { key: "intake", header: "Erstbearbeitung", cell: (row) => <StatusBadge kind="intake_status" value={row.intake_status} /> },
    { key: "work", header: "Arbeit", cell: (row) => <StatusBadge kind="work_status" value={row.work_status} /> },
    queueColumns[2],
    { key: "created", header: "Eingang", cell: (row) => formatDateTime(row.created_at) },
  ];

  return (
    <div className="dash-page">
      <PageHeader title="Erstbearbeitung" description="Ihre Arbeitswarteschlangen. Jede Anfrage steht in höchstens einer Warteschlange." />

      <nav className="queue-tabs" aria-label="Warteschlangen">
        <ul>
          {QUEUE_TABS.map((item) => {
            const count = item.queue ? counts[item.queue as QueueKey] : null;
            return (
              <li key={item.slug}>
                <Link href={item.slug === "pruefung" ? "/dashboard/erstbearbeitung" : `/dashboard/erstbearbeitung?tab=${item.slug}`} aria-current={item.slug === tab.slug ? "page" : undefined}>
                  {item.label}
                  {count !== null && <span className="queue-tabs__count" aria-label={`${count} Anfragen`}>{count}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {error ? (
        <ErrorState><p>Bitte die Seite neu laden.</p></ErrorState>
      ) : (
        <section aria-labelledby="queue-title" className="dash-section">
          <h2 id="queue-title" className="sr-only">{tab.label}</h2>
          <p className="result-count" role="status">
            {formatNumber(total)} {total === 1 ? "Anfrage" : "Anfragen"}
            {tab.queue ? " · sortiert nach Priorität, Frist und Wartezeit" : " · neueste zuerst"}
            {!tab.queue && pages > 1 && <> · Seite {page} von {pages}</>}
          </p>
          <DataTable
            caption={tab.label}
            columns={tab.queue ? queueColumns : allColumns}
            rows={rows}
            rowKey={(row) => row.id ?? ""}
            rowHref={(row) => `/dashboard/anfragen/${row.id}`}
            empty={<EmptyState title={tab.empty} />}
          />
          {!tab.queue && pages > 1 && (
            <nav className="pagination" aria-label="Seiten">
              {page > 1 ? <Link href={`/dashboard/erstbearbeitung?tab=alle&seite=${page - 1}`} rel="prev">← Zurück</Link> : <span aria-hidden="true" />}
              <span>Seite {page} von {pages}</span>
              {page < pages ? <Link href={`/dashboard/erstbearbeitung?tab=alle&seite=${page + 1}`} rel="next">Weiter →</Link> : <span aria-hidden="true" />}
            </nav>
          )}
        </section>
      )}
    </div>
  );
}

function Hints({ row }: { row: QueueRow }) {
  const hints: Array<{ text: string; tone: "info" | "warning" | "danger" }> = [];
  if (row.safety_check_required) hints.push({ text: "Sicherheitsgefahr: vor Planung prüfen", tone: "danger" });
  else if (row.safety_risk && row.safety_risk !== "none_known") hints.push({ text: `Sicherheitsgefahr ${label("safety_risk", row.safety_risk).toLowerCase()}`, tone: "warning" });
  if (row.queue === "planning" && row.work_status === "waiting_parts") hints.push({ text: "Folgeeinsatz nach Teilelieferung", tone: "info" });
  if (row.intake_mode === "automatic") hints.push({ text: "Automatisch bearbeitet", tone: "info" });
  if (row.queue === "reply_received" && row.intake_status === "analyzing") hints.push({ text: "Analyse läuft", tone: "info" });
  if (hints.length === 0) return <span className="muted">–</span>;
  return (
    <ul className="hint-list">
      {hints.map((hint) => <li key={hint.text} className={`hint hint--${hint.tone}`}>{hint.text}</li>)}
    </ul>
  );
}
