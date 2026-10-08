import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DataTable, type Column } from "@/components/dashboard/ui/data-table";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/dashboard/ui/states";
import { PeriodBar } from "@/components/dashboard/period-bar";
import { formatKpiChange, formatKpiValue, KPI_GROUPS, KPI_INFO, parsePeriodParams, type KpiRow, type PeriodParams } from "@/lib/analytics";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { ATTENTION_LABELS, getOverview, type AttentionItem, type AttentionReason, type Overview, type TeamRow } from "@/lib/dashboard/overview";
import { formatCalendarDate, formatDateTime, formatElapsed, formatMinutes, formatNumber } from "@/lib/format";
import { label } from "@/lib/status";

export const metadata: Metadata = { title: "Übersicht" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Manager overview (task-7-2): KPIs of a period with comparison and list links, finances,
// attention list and team. Data from the analytics functions (task-7-1) with the user's rights.
export default async function OverviewPage({ searchParams }: Props) {
  await requireRole(rolesFor("/dashboard/uebersicht"));
  const period = parsePeriodParams(await searchParams);
  return (
    <div className="dash-page overview">
      <PageHeader title="Übersicht" description="Kennzahlen des Zeitraums mit Vergleich, Finanzen, Aufmerksamkeitsliste und Team." />
      <Suspense key={`${period.param}-${period.anchor ?? ""}`} fallback={<LoadingState label="Kennzahlen werden geladen …" rows={6} />}>
        <OverviewContent period={period} />
      </Suspense>
    </div>
  );
}

async function OverviewContent({ period }: { period: PeriodParams }) {
  let data: Overview;
  try {
    data = await getOverview(period);
  } catch {
    return <ErrorState><p>Bitte die Seite neu laden.</p></ErrorState>;
  }
  const { window: w } = data;
  const byKey = new Map(data.kpis.map((row) => [row.key, row]));
  const tiles = (keys: readonly string[]) => keys.map((key) => byKey.get(key)).filter((row): row is KpiRow => Boolean(row));

  return (
    <>
      <PeriodBar basePath="/dashboard/uebersicht" period={period} window={w} />

      <section className="dash-section" aria-labelledby="kpi-events">
        <h2 id="kpi-events">Ereignisse im Zeitraum</h2>
        <p className="section-note">Gezählt nach dem jeweiligen Zeitpunkt: Eingang, Abschluss der Erstbearbeitung, technischer Abschluss. Vergleich mit dem gleich langen Abschnitt des Vorzeitraums.</p>
        <KpiGrid rows={tiles(KPI_GROUPS.events)} window={w} />
      </section>

      <section className="dash-section" aria-labelledby="kpi-snapshots">
        <h2 id="kpi-snapshots">Stand am Ende des Zeitraums</h2>
        <p className="section-note">Momentaufnahmen zum {formatDateTime(w.current_end)}, verglichen mit dem {formatDateTime(w.previous_end)}. Die verknüpften Listen zeigen den aktuellen Stand.</p>
        <KpiGrid rows={tiles(KPI_GROUPS.snapshots)} window={w} />
      </section>

      <section className="dash-section" aria-labelledby="kpi-finance">
        <h2 id="kpi-finance">Finanzen</h2>
        <p className="section-note"><strong>Ausgestellt ist nicht eingenommen.</strong> Ausgestellte Beträge und Zahlungseingänge sind getrennte Ereignisse; offene und überfällige Forderungen sind Momentaufnahmen. Musterrechnungen mit Demodaten.</p>
        <KpiGrid rows={tiles(KPI_GROUPS.finance)} window={w} />
      </section>

      <section className="dash-section" aria-labelledby="attention">
        <h2 id="attention">Aufmerksamkeit</h2>
        <Attention items={data.attention.items} counts={data.attention.counts} checkedAt={data.attention.checkedAt} />
      </section>

      <section className="dash-section" aria-labelledby="team">
        <h2 id="team">Team</h2>
        <p className="section-note">Tätigkeit im Zeitraum; offene Anfragen sind aktuell zugewiesene, am Ende des Zeitraums offene Anfragen.</p>
        <Team rows={data.team} />
        {data.idleEmployees > 0 && <p className="section-note">{data.idleEmployees} weitere aktive Mitarbeitende ohne Tätigkeit und ohne offene Anfragen im Zeitraum.</p>}
      </section>
    </>
  );
}

function KpiGrid({ rows, window }: { rows: KpiRow[]; window: Overview["window"] }) {
  return (
    <ul className="kpi-grid">
      {rows.map((row) => {
        const info = KPI_INFO[row.key];
        const change = formatKpiChange(row);
        const href = info?.href?.(window);
        const saved = row.key === "time_saved_minutes" && row.detail ? row.detail : null;
        return (
          <li key={row.key} className="kpi" data-kpi={row.key} data-measure={row.measure}>
            <p className="kpi__label">{row.label}<span className="kpi__measure">{row.measure === "event" ? "Ereignis" : "Momentaufnahme"}</span></p>
            <p className="kpi__value" data-value={row.current_value ?? ""}>{formatKpiValue(row.unit, row.current_value)}</p>
            <p className="kpi__change">
              <span className={`kpi__delta kpi__delta--${change.tone}`}>{change.text}</span>
              <span>Vorperiode {formatKpiValue(row.unit, row.previous_value)}</span>
            </p>
            {change.note && <p className="kpi__note">{change.note}</p>}
            {saved && <p className="kpi__note">{formatNumber(Number(saved.requests ?? 0))} Anfragen × Basiswert {formatMinutes(Number(saved.baseline_max ?? 0))}</p>}
            {info && <p className="kpi__definition">{info.definition}</p>}
            {href && <Link className="kpi__link" href={href}>{row.measure === "snapshot" ? "Aktuelle Liste" : "Liste öffnen"}</Link>}
          </li>
        );
      })}
    </ul>
  );
}

function Attention({ items, counts, checkedAt }: { items: AttentionItem[]; counts: Partial<Record<AttentionReason, number>>; checkedAt: string }) {
  if (items.length === 0) return <EmptyState title="Keine Auffälligkeiten." />;
  const now = new Date(checkedAt).getTime();
  const columns: Column<AttentionItem>[] = [
    { key: "reason", header: "Grund", cell: (item) => ATTENTION_LABELS[item.reason], mobile: "title" },
    { key: "request", header: "Anfrage", cell: (item) => <><span className="mono">{item.requestNumber}</span><span className="cell-sub">{item.company}</span></> },
    {
      key: "since",
      header: "Seit",
      cell: (item) => (/^\d{4}-\d{2}-\d{2}$/.test(item.since)
        ? `fällig ${formatCalendarDate(item.since)}`
        : `${formatDateTime(item.since)} (${formatElapsed((now - new Date(item.since).getTime()) / 60000)})`),
    },
    { key: "detail", header: "Hinweis", cell: (item) => attentionDetail(item), mobile: "hide" },
  ];
  return (
    <>
      <ul className="attention-counts" aria-label="Anzahl je Grund">
        {(Object.keys(ATTENTION_LABELS) as AttentionReason[]).filter((reason) => counts[reason]).map((reason) => (
          <li key={reason}>{ATTENTION_LABELS[reason]}: <strong>{counts[reason]! >= 50 ? "50+" : counts[reason]}</strong></li>
        ))}
      </ul>
      <DataTable caption="Aufmerksamkeitsliste" columns={columns} rows={items.slice(0, 25)} rowKey={(item) => `${item.reason}-${item.requestId}-${item.detail ?? ""}`} rowHref={(item) => `/dashboard/anfragen/${item.requestId}${item.reason === "invoice_overdue" ? "#rechnung" : ""}`} empty={null} />
      {items.length > 25 && <p className="section-note">Die 25 dringendsten von {items.length} Einträgen.</p>}
    </>
  );
}

function attentionDetail(item: AttentionItem): string {
  switch (item.reason) {
    case "safety": return label("safety_risk", item.detail);
    case "review_waiting": return item.detail === "reply_received" ? "Kundenantwort eingegangen" : "In Prüfung";
    case "parts_waiting": return item.detail ?? "–";
    case "invoice_overdue": return item.detail ?? "–";
    default: return "–";
  }
}

function Team({ rows }: { rows: TeamRow[] }) {
  const columns: Column<TeamRow>[] = [
    { key: "name", header: "Name", cell: (row) => <>{row.display_name}{!row.is_active && <span className="cell-sub">Deaktiviert</span>}</>, mobile: "title" },
    { key: "role", header: "Rolle", cell: (row) => (row.role === "dispatcher" ? "Dispatcher" : "Techniker") },
    { key: "intake", header: "Erstbearbeitungen", cell: (row) => (row.role === "dispatcher" ? formatNumber(row.intake_completed) : "–"), align: "end" },
    { key: "visits", header: "Einsätze", cell: (row) => (row.role === "technician" ? formatNumber(row.visits_completed) : "–"), align: "end" },
    { key: "minutes", header: "Arbeitszeit", cell: (row) => (row.role === "technician" ? formatMinutes(row.work_minutes) : "–"), align: "end" },
    { key: "completed", header: "Abgeschlossen", cell: (row) => (row.role === "technician" ? formatNumber(row.requests_completed) : "–"), align: "end" },
    { key: "open", header: "Offen zugewiesen", cell: (row) => formatNumber(row.open_requests), align: "end" },
  ];
  return <DataTable caption="Team" columns={columns} rows={rows} rowKey={(row) => row.employee_id} empty={<EmptyState title="Keine Mitarbeitenden." />} />;
}
