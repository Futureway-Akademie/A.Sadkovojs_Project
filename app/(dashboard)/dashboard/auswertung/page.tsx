import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { TimeChart, type ChartFormat, type ChartSeries } from "@/components/dashboard/charts";
import { PeriodBar } from "@/components/dashboard/period-bar";
import { DataTable, type Column } from "@/components/dashboard/ui/data-table";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/dashboard/ui/states";
import { parsePeriodParams, periodTitle, type PeriodParams } from "@/lib/analytics";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { CHART_COLORS } from "@/lib/chart-colors";
import { getInsights, type Insights } from "@/lib/dashboard/insights";
import { formatCurrency, formatMinutes, formatNumber, formatPercent } from "@/lib/format";
import { automationSeries, cumulativeComparison, monthLabel, QUEUE_LABELS, queueSeries, seasonality, sum } from "@/lib/insights";
import { label, statusInfo } from "@/lib/status";

export const metadata: Metadata = { title: "Auswertung" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Charts and automation area (task-7-3). Every chart reads database data through the analytics
// functions; each figure has a text summary, a legend for two or more series and a data table.
export default async function InsightsPage({ searchParams }: Props) {
  await requireRole(rolesFor("/dashboard/auswertung"));
  const period = parsePeriodParams(await searchParams);
  return (
    <div className="dash-page insights">
      <PageHeader title="Auswertung" description="Verläufe, Vergleich, Saisonalität, Warteschlangen, Finanzen und Automatisierung aus den Datenbankdaten." />
      <Suspense key={`${period.param}-${period.anchor ?? ""}`} fallback={<LoadingState label="Diagramme werden geladen …" rows={6} />}>
        <InsightsContent period={period} />
      </Suspense>
    </div>
  );
}

const slot = (index: number) => CHART_COLORS[index];

async function InsightsContent({ period }: { period: PeriodParams }) {
  let data: Insights;
  try {
    data = await getInsights(period);
  } catch {
    return <ErrorState><p>Bitte die Seite neu laden.</p></ErrorState>;
  }
  const { window: w } = data;
  const months = data.months.map((row) => ({ ...row, month: monthLabel(row.bucket_start) }));
  const last12 = months.slice(-12);

  // 1 Flow: received, initial processing completed, completed (separate series by their own timestamps)
  const flowSeries: ChartSeries[] = [
    { key: "received", label: "Eingang", color: slot(0) },
    { key: "intake_completed", label: "Erstbearbeitung abgeschlossen", color: slot(1) },
    { key: "completed", label: "Technisch abgeschlossen", color: slot(2) },
  ];

  // 2 Comparison: cumulative received per day
  const comparison = cumulativeComparison(
    data.currentDays.map((row) => ({ bucket_start: row.bucket_start, value: row.received })),
    data.previousDays.map((row) => ({ bucket_start: row.bucket_start, value: row.received })),
  ).map((row) => ({ ...row, label: `Tag ${row.day}` }));
  const comparisonSeries: ChartSeries[] = [
    { key: "current", label: periodTitle(period.kind, w.startDay), color: slot(0) },
    { key: "previous", label: "Vorzeitraum", color: slot(1) },
  ];
  const elapsed = data.currentDays.length;
  const currentTotal = sum(data.currentDays.map((row) => row.received));
  const previousSame = sum(data.previousDays.slice(0, elapsed).map((row) => row.received));

  // 3 Seasonality: received per calendar month and year (at most three years)
  const season = seasonality(data.seasonalMonths, data.today);
  const seasonSeries: ChartSeries[] = season.years.slice(-3).map((year, index) => ({ key: year, label: year, color: slot(index) }));

  // 4 Queues at the end of each day
  const queues = queueSeries(data.queues);
  const queueKeys = ["analysis", "review", "awaiting_customer", "planning"];
  const queueChartSeries: ChartSeries[] = queueKeys.map((key, index) => ({ key, label: QUEUE_LABELS[key], color: slot(index) }));
  const lastQueue = queues.at(-1);

  // 5 Finance: issued and paid per month (issued is not collected)
  const financeSeries: ChartSeries[] = [
    { key: "invoiced_gross", label: "Ausgestellt (brutto)", color: slot(0) },
    { key: "payments_received", label: "Zahlungseingang (brutto)", color: slot(1) },
  ];

  // 6 Automation
  const automation = automationSeries(data.months);
  const savedTotal = sum(automation.map((row) => row.savedMinutes));
  const savedRequests = sum(automation.map((row) => row.savedRequests));
  const runs = data.automation;
  const runTotals = { all: sum(runs.map((row) => row.runs)), failed: sum(runs.filter((row) => row.status === "failed").map((row) => row.runs)), corrected: sum(runs.map((row) => row.corrected)) };

  const table = <Row extends Record<string, unknown>>(rows: Row[], xKey: keyof Row, xLabel: string, series: ChartSeries[], format: ChartFormat | "mixed") => {
    const columns: Column<Row>[] = [
      { key: "x", header: xLabel, cell: (row) => String(row[xKey]), mobile: "title" },
      ...series.map((entry) => ({ key: entry.key, header: entry.label, cell: (row: Row) => tableValue(format, row[entry.key]), align: "end" as const })),
    ];
    return <DataTable caption={xLabel} columns={columns} rows={rows} rowKey={(row) => String(row[xKey])} empty={<EmptyState title="Keine Daten." />} />;
  };

  return (
    <>
      <PeriodBar basePath="/dashboard/auswertung" period={period} window={w} />
      <p className="section-note">Der Zeitraum gilt für den Vergleich und die Automatisierungsläufe. Verläufe zeigen die letzten 24 Monate, Saisonalität die Kalenderjahre ab {Number(data.today.slice(0, 4)) - 2}, Warteschlangen die letzten 90 Tage.</p>

      <section className="dash-section" aria-labelledby="flow">
        <h2 id="flow">Verlauf</h2>
        <Figure
          id="flow-chart"
          title="Eingang, Erstbearbeitung und Abschluss je Monat"
          summary={`Letzte 12 Monate: ${formatNumber(sum(last12.map((row) => row.received)))} Eingänge, ${formatNumber(sum(last12.map((row) => row.intake_completed)))} abgeschlossene Erstbearbeitungen, ${formatNumber(sum(last12.map((row) => row.completed)))} technische Abschlüsse. Jede Reihe zählt nach ihrem eigenen Zeitpunkt.`}
          series={flowSeries}
          table={table(months, "month", "Monat", flowSeries, "count")}
        >
          <TimeChart kind="line" data={months} xKey="month" series={flowSeries} format="count" label="Liniendiagramm: Eingang, Erstbearbeitung und Abschluss je Monat" />
        </Figure>
        <Figure
          id="comparison-chart"
          title="Eingänge kumuliert im Vergleich zum Vorzeitraum"
          summary={`Bis Tag ${elapsed}: ${formatNumber(currentTotal)} Eingänge; Vorzeitraum bis Tag ${elapsed}: ${formatNumber(previousSame)}. Tageswerte nach Kalendertag in Europe/Berlin.`}
          series={comparisonSeries}
          table={table(comparison, "label", "Tag", comparisonSeries, "count")}
        >
          <TimeChart kind="line" data={comparison} xKey="label" series={comparisonSeries} format="count" label="Liniendiagramm: Eingänge kumuliert, aktueller Zeitraum und Vorzeitraum" />
        </Figure>
        <Figure
          id="season-chart"
          title="Saisonalität: Eingänge je Kalendermonat"
          summary={`Eingänge je Monat für ${season.years.slice(-3).join(", ")}; Monate ohne Daten bleiben leer.`}
          series={seasonSeries}
          table={table(season.data, "month", "Monat", seasonSeries, "count")}
        >
          <TimeChart kind="line" data={season.data} xKey="month" series={seasonSeries} format="count" label="Liniendiagramm: Eingänge je Kalendermonat und Jahr" />
        </Figure>
      </section>

      <section className="dash-section" aria-labelledby="queues">
        <h2 id="queues">Warteschlangen</h2>
        <Figure
          id="queue-chart"
          title="Anfragen je Warteschlange am Tagesende (90 Tage)"
          summary={lastQueue ? `Heute: ${queueKeys.map((key) => `${QUEUE_LABELS[key]} ${formatNumber(Number(lastQueue[key] ?? 0))}`).join(", ")}. Rekonstruiert aus dem Verlauf der Anfragen.` : "Keine Daten."}
          series={queueChartSeries}
          table={table(queues, "day", "Tag", queueChartSeries, "count")}
        >
          <TimeChart kind="line" data={queues} xKey="day" series={queueChartSeries} format="count" label="Liniendiagramm: Anfragen je Warteschlange am Tagesende" />
        </Figure>
      </section>

      <section className="dash-section" aria-labelledby="finance">
        <h2 id="finance">Finanzen</h2>
        <Figure
          id="finance-chart"
          title="Ausgestellt und bezahlt je Monat (12 Monate)"
          summary={`Letzte 12 Monate: ${formatCurrency(sum(last12.map((row) => row.invoiced_gross)))} ausgestellt, ${formatCurrency(sum(last12.map((row) => row.payments_received)))} eingegangen. Ausgestellt ist nicht eingenommen.`}
          series={financeSeries}
          legendShape="rect"
          table={table(last12, "month", "Monat", financeSeries, "eur")}
        >
          <TimeChart kind="bar" data={last12} xKey="month" series={financeSeries} format="eur" label="Säulendiagramm: ausgestellte Beträge und Zahlungseingänge je Monat" />
        </Figure>
      </section>

      <section className="dash-section" aria-labelledby="automation">
        <h2 id="automation">Automatisierung</h2>
        <Figure
          id="share-chart"
          title="Anteil automatischer Erstbearbeitung je Monat"
          summary="Automatisch abgeschlossene Erstbearbeitungen an allen abgeschlossenen Erstbearbeitungen; später korrigierte automatische Ergebnisse zählen als automatisch."
          series={[{ key: "share", label: "Automatisch", color: slot(0) }]}
          table={table(automation, "month", "Monat", [{ key: "share", label: "Anteil automatisch (%)", color: slot(0) }, { key: "automatic", label: "Automatisch", color: slot(0) }, { key: "corrected", label: "Davon korrigiert", color: slot(0) }, { key: "total", label: "Erstbearbeitungen", color: slot(0) }], "mixed")}
        >
          <TimeChart kind="line" data={automation} xKey="month" series={[{ key: "share", label: "Anteil automatisch", color: slot(0) }]} format="percent" variant="share" label="Liniendiagramm: Anteil automatischer Erstbearbeitung je Monat" />
        </Figure>
        <Figure
          id="savings-chart"
          title="Geschätzte Zeitersparnis je Monat"
          summary={`24 Monate: ${formatMinutes(savedTotal)} aus ${formatNumber(savedRequests)} automatisch und ohne Korrektur abgeschlossenen Erstbearbeitungen × Basiswert der manuellen Bearbeitung. Schätzung, keine gemessene Zeit.`}
          series={[{ key: "savedHours", label: "Zeitersparnis", color: slot(0) }]}
          table={table(automation, "month", "Monat", [{ key: "savedHours", label: "Stunden", color: slot(0) }, { key: "savedRequests", label: "Anfragen", color: slot(0) }, { key: "baseline", label: "Basiswert (min)", color: slot(0) }], "mixed")}
        >
          <TimeChart kind="bar" data={automation} xKey="month" series={[{ key: "savedHours", label: "Zeitersparnis", color: slot(0) }]} format="hours" variant="savings" label="Säulendiagramm: geschätzte Zeitersparnis je Monat" />
        </Figure>
        <div className="figure" id="runs">
          <h3>Automatisierungsläufe im Zeitraum</h3>
          <p className="section-note">{formatNumber(runTotals.all)} Läufe, davon {formatNumber(runTotals.failed)} fehlgeschlagen und {formatNumber(runTotals.corrected)} nachträglich korrigiert.</p>
          <DataTable
            caption="Automatisierungsläufe"
            columns={[
              { key: "step", header: "Schritt", cell: (row) => label("automation_step", row.step), mobile: "title" },
              { key: "status", header: "Status", cell: (row) => statusInfo("automation_status", row.status).label },
              { key: "decision", header: "Entscheidung", cell: (row) => (row.decision ? label("automation_decision", row.decision) : "–") },
              { key: "runs", header: "Läufe", cell: (row) => formatNumber(row.runs), align: "end" },
              { key: "corrected", header: "Korrigiert", cell: (row) => formatNumber(row.corrected), align: "end" },
            ]}
            rows={runs}
            rowKey={(row) => `${row.step}-${row.status}-${row.decision ?? ""}`}
            empty={<EmptyState title="Keine Automatisierungsläufe im Zeitraum." />}
          />
        </div>
      </section>
    </>
  );
}

function tableValue(format: ChartFormat | "mixed", value: unknown): string {
  if (value === null || value === undefined) return "–";
  const number = Number(value);
  if (format === "eur") return formatCurrency(number);
  if (format === "percent") return formatPercent(number);
  if (format === "hours") return `${formatNumber(number, 1)} h`;
  return formatNumber(number, Number.isInteger(number) ? 0 : 1);
}

function Figure({ id, title, summary, series, legendShape = "line", table, children }: { id: string; title: string; summary: string; series: ChartSeries[]; legendShape?: "line" | "rect"; table: ReactNode; children: ReactNode }) {
  return (
    <figure className="figure" id={id} data-chart={id}>
      <figcaption>
        <h3>{title}</h3>
        <p className="section-note">{summary}</p>
      </figcaption>
      {series.length >= 2 && (
        <ul className="chart-legend" aria-label="Legende">
          {series.map((entry) => (
            <li key={entry.key}><span className={`chart-legend__key chart-legend__key--${legendShape}`} style={{ background: entry.color }} aria-hidden="true" />{entry.label}</li>
          ))}
        </ul>
      )}
      {children}
      <details className="figure__table">
        <summary>Daten als Tabelle</summary>
        {table}
      </details>
    </figure>
  );
}
