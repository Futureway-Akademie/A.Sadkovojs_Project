import type { Metadata } from "next";
import Link from "next/link";
import { PlanningCalendar } from "@/components/dashboard/planning-calendar";
import { VisitCard } from "@/components/dashboard/visit-card";
import { EmptyState, ErrorState, PageHeader } from "@/components/dashboard/ui/states";
import { addDays, dayKeyOf, isoWeek } from "@/lib/berlin-time";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadWeek } from "@/lib/dashboard/technician";
import { formatDate } from "@/lib/format";
import { statusInfo } from "@/lib/status";

export const metadata: Metadata = { title: "Kalender" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Own week only: visits and absences of the signed-in technician, no other technicians
export default async function CalendarPage({ searchParams }: Props) {
  const employee = await requireRole(rolesFor("/dashboard/kalender"));
  const params = await searchParams;
  const data = await loadWeek(employee.id, typeof params.woche === "string" ? params.woche : undefined);
  const link = (week: string) => `/dashboard/kalender?woche=${week}`;
  const busy = [
    // All own visits of the week; finished or paused ones are shown muted with their status
    ...data.visits.map((visit) => ({
      technicianId: employee.id, start: visit.scheduled_start, end: visit.scheduled_end, kind: "visit" as const, requestId: visit.request_id, requestNumber: visit.request.request_number,
      done: !["scheduled", "in_progress"].includes(visit.status),
      note: visit.status === "scheduled" ? undefined : statusInfo("visit_status", visit.status).label,
    })),
    ...data.absences.map((absence) => ({ technicianId: employee.id, start: absence.start, end: absence.end, kind: "absence" as const, requestId: null, requestNumber: null })),
  ];

  return (
    <div className="dash-page tech-page">
      <PageHeader title="Kalender" description="Ihre Einsätze und Abwesenheiten." />
      {data.error && <ErrorState><p>Ein Teil der Daten konnte nicht geladen werden. Bitte die Seite neu laden.</p></ErrorState>}
      <section className="dash-section" aria-labelledby="week-title">
        <div className="plan-week">
          <h2 id="week-title">KW {isoWeek(data.week)} · {formatDate(`${data.week}T12:00:00Z`)} – {formatDate(`${addDays(data.week, 6)}T12:00:00Z`)}</h2>
          <nav className="plan-week__nav" aria-label="Woche wechseln">
            <Link href={link(addDays(data.week, -7))}>← Vorherige</Link>
            <Link href={link(dayKeyOf(new Date()))}>Heute</Link>
            <Link href={link(addDays(data.week, 7))}>Nächste →</Link>
          </nav>
        </div>
        <PlanningCalendar days={data.days} technicians={[{ id: employee.id, name: "Meine Einsätze" }]} workingHours={data.workingHours} busy={busy} canPick={false} ownOnly />
      </section>
      <section className="dash-section" aria-labelledby="list-title">
        <h2 id="list-title">Einsätze dieser Woche ({data.visits.length})</h2>
        {data.visits.length === 0 ? <EmptyState title="Keine Einsätze in dieser Woche." /> : <div className="visit-list">{data.visits.map((visit) => <VisitCard key={visit.id} visit={visit} />)}</div>}
      </section>
    </div>
  );
}
