import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import {
  DeadlinesCard, FinanceCard, HazardBanner, HazardCard, OverdueCard, PerformanceKpis, QueuesCard, QueueStages,
  ServiceDeskCard, TeamTable, TechniciansCard, ToPlanCard,
} from "@/components/dashboard/overview";
import { PeriodControl, periodDescription } from "@/components/dashboard/period-bar";
import { Card, Zone } from "@/components/dashboard/ui/card";
import { ErrorState, LoadingState } from "@/components/dashboard/ui/states";
import { parsePeriodParams, periodQuery, type PeriodParams } from "@/lib/analytics";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { getAttentionNow, getNow, getOverview, getTeamNow } from "@/lib/dashboard/overview";
import { berlinDayKey, formatDateTime, formatWeekdayDate } from "@/lib/format";

export const metadata: Metadata = { title: "Übersicht" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Overview (task-7-2, redesigned in task-10-3 after the Claude Design canvas). Order by urgency:
// zone 1 "Handlungsbedarf" is the current state and never filtered by the period; zone 2 shows the
// period with comparison, the period control sits at that block; zone 3 holds details.
// Admin and manager share the route with the layouts "Übersicht – Admin" and "– Manager".
export default async function OverviewPage({ searchParams }: Props) {
  const employee = await requireRole(rolesFor("/dashboard/uebersicht"));
  const period = parsePeriodParams(await searchParams);
  const now = new Date();
  return (
    <div className="dash-page rw-page overview">
      <header className="dash-page-header">
        <div>
          <h1>Übersicht</h1>
          <p className="rw-page__sub">
            {employee.role === "manager"
              ? <>{formatWeekdayDate(now).replace(/^(\w+)\./, (day) => LONG_DAYS[day] ?? day)}, <span className="mono">{formatDateTime(now).slice(-5)}</span> · Team und Warteschlangen</>
              : <>Stand <span className="mono">{formatDateTime(now)}</span> · Handlungsbedarf, Leistung im Zeitraum, Finanzen und Team</>}
          </p>
        </div>
      </header>
      {employee.role === "manager" ? <ManagerOverview period={period} /> : <AdminOverview period={period} />}
    </div>
  );
}

const LONG_DAYS: Record<string, string> = { "Mo.": "Montag", "Di.": "Dienstag", "Mi.": "Mittwoch", "Do.": "Donnerstag", "Fr.": "Freitag", "Sa.": "Samstag", "So.": "Sonntag" };

const BASE = "/dashboard/uebersicht";

// Each block loads and fails on its own; the rest of the page stays usable
async function Guard({ load, title, children }: { load: () => Promise<unknown>; title: string; children: (data: never) => ReactNode }) {
  let data: unknown;
  try {
    data = await load();
  } catch {
    return (
      <Card stripe="danger" title={title}>
        <ErrorState title={`${title}: Daten konnten nicht geladen werden.`} action={<Link className="rw-button-secondary" href={BASE}>Erneut versuchen</Link>}>
          Die übrigen Bereiche der Seite sind aktuell.
        </ErrorState>
      </Card>
    );
  }
  return <>{children(data as never)}</>;
}

const loadingCard = (title: string, shape: "kpi" | "table" | "rows" = "table") => (
  <Card title={title} busy><LoadingState shape={shape} rows={3} label={`${title} wird geladen …`} /></Card>
);

function AdminOverview({ period }: { period: PeriodParams }) {
  return (
    <>
      <Zone id="z-now" title="Handlungsbedarf" note="Stand jetzt · unabhängig vom gewählten Zeitraum">
        <div className="rw-split">
          <div className="rw-split__main">
            <Suspense fallback={loadingCard("Sicherheitsgefahr offen")}>
              <Guard title="Sicherheitsgefahren" load={getAttentionNow}>
                {(attention: Awaited<ReturnType<typeof getAttentionNow>>) => (
                  <>
                    <HazardCard items={attention.items} checkedAt={attention.checkedAt} />
                    <DeadlinesCard items={attention.items} checkedAt={attention.checkedAt} />
                  </>
                )}
              </Guard>
            </Suspense>
          </div>
          <div className="rw-split__side">
            <Suspense fallback={<>{loadingCard("Warteschlangen", "rows")}{loadingCard("Überfällige Forderungen", "kpi")}</>}>
              <Guard title="Warteschlangen und Forderungen" load={getNow}>
                {(now: Awaited<ReturnType<typeof getNow>>) => (
                  <>
                    <QueuesCard now={now} />
                    <OverdueCard now={now} />
                  </>
                )}
              </Guard>
            </Suspense>
          </div>
        </div>
      </Zone>
      <Suspense key={`${period.param}-${period.anchor ?? ""}`} fallback={<PeriodZonesLoading />}>
        <PeriodZones period={period} withFinance />
      </Suspense>
    </>
  );
}

function ManagerOverview({ period }: { period: PeriodParams }) {
  const today = berlinDayKey(new Date());
  return (
    <>
      <Suspense fallback={<LoadingState rows={1} label="Sicherheitsgefahren werden geladen …" />}>
        <Guard title="Sicherheitsgefahren" load={getAttentionNow}>
          {(attention: Awaited<ReturnType<typeof getAttentionNow>>) => <HazardBanner items={attention.items} checkedAt={attention.checkedAt} />}
        </Guard>
      </Suspense>

      <Suspense fallback={<Zone id="z-queues" title="Warteschlangen jetzt"><LoadingState rows={2} /></Zone>}>
        <Guard title="Warteschlangen" load={getNow}>
          {(now: Awaited<ReturnType<typeof getNow>>) => (
            <Zone
              id="z-queues"
              title="Warteschlangen jetzt"
              note={<><span className="mono">{now.openRequests}</span> offene Anfragen · Verlauf der letzten 14 Tage</>}
              controls={<Link className="rw-link-btn" href="/dashboard/auswertung#queues">90-Tage-Verlauf</Link>}
            >
              <QueueStages now={now} />
            </Zone>
          )}
        </Guard>
      </Suspense>

      <Suspense fallback={<Zone id="z-team" title="Team"><div className="rw-split">{loadingCard("Service Desk", "rows")}{loadingCard("Techniker")}</div></Zone>}>
        <Guard title="Team" load={getTeamNow}>
          {(team: Awaited<ReturnType<typeof getTeamNow>>) => (
            <>
              <Zone id="z-team" title="Team" note="Stand jetzt">
                <div className="rw-split rw-split--team">
                  <div className="rw-split__side"><ServiceDeskCard team={team} /></div>
                  <div className="rw-split__main"><TechniciansCard team={team} today={today} /></div>
                </div>
              </Zone>
              <Suspense fallback={null}>
                <Guard title="Fristen" load={getAttentionNow}>
                  {(attention: Awaited<ReturnType<typeof getAttentionNow>>) => <DeadlinesCard items={attention.items} checkedAt={attention.checkedAt} />}
                </Guard>
              </Suspense>
              <ToPlanCard items={team.toPlan} />
            </>
          )}
        </Guard>
      </Suspense>

      <Suspense key={`${period.param}-${period.anchor ?? ""}`} fallback={<PeriodZonesLoading title="Durchsatz im Zeitraum" />}>
        <PeriodZones period={period} title="Durchsatz im Zeitraum" />
      </Suspense>
    </>
  );
}

function PeriodZonesLoading({ title = "Leistung im Zeitraum" }: { title?: string }) {
  return (
    <Zone id="z-period" title={title}>
      <div className="rw-kpi-grid">{[1, 2, 3, 4].map((index) => <Card key={index} busy><LoadingState shape="kpi" label="Kennzahl wird geladen …" /></Card>)}</div>
    </Zone>
  );
}

async function PeriodZones({ period, title = "Leistung im Zeitraum", withFinance = false }: { period: PeriodParams; title?: string; withFinance?: boolean }) {
  let data: Awaited<ReturnType<typeof getOverview>>;
  try {
    data = await getOverview(period);
  } catch {
    return (
      <Zone id="z-period" title={title}>
        <Card stripe="danger" title="Kennzahlen">
          <ErrorState title="Kennzahlen konnten nicht geladen werden." action={<Link className="rw-button-secondary" href={`${BASE}${periodQuery(period.param, period.anchor)}`}>Erneut versuchen</Link>}>
            Handlungsbedarf und Warteschlangen oben sind aktuell.
          </ErrorState>
        </Card>
      </Zone>
    );
  }
  const control = <PeriodControl basePath={BASE} period={period} window={data.window} hash="#z-period" />;
  return (
    <>
      <Zone id="z-period" title={title} note={periodDescription(period, data.window)} controls={control}>
        <PerformanceKpis data={data} />
      </Zone>
      {withFinance && (
        <div className="rw-split rw-split--details">
          <div className="rw-split__side">
            <Zone id="z-finance" title="Finanzen" note="im gewählten Zeitraum">
              <FinanceCard data={data} />
            </Zone>
          </div>
          <div className="rw-split__main">
            <Zone id="z-team" title="Team" note="Tätigkeit im gewählten Zeitraum · offen zugewiesen">
              <TeamTable rows={data.team} idle={data.idleEmployees} />
            </Zone>
          </div>
        </div>
      )}
    </>
  );
}
