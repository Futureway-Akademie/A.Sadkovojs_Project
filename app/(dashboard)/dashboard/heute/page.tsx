import type { Metadata } from "next";
import Link from "next/link";
import { NowCard, VisitRow } from "@/components/dashboard/visit-card";
import { Card } from "@/components/dashboard/ui/card";
import { EmptyState, ErrorState } from "@/components/dashboard/ui/states";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadToday } from "@/lib/dashboard/technician";
import { formatCalendarDate, formatDate, formatNumber, formatTime, formatWeekdayDate } from "@/lib/format";
import { label } from "@/lib/status";

export const metadata: Metadata = { title: "Mein Tag" };

const LONG_DAYS: Record<string, string> = { "Mo.": "Montag", "Di.": "Dienstag", "Mi.": "Mittwoch", "Do.": "Donnerstag", "Fr.": "Freitag", "Sa.": "Samstag", "So.": "Sonntag" };
const longDate = (value: string | number) => formatWeekdayDate(value).replace(/^(\S+)/, (day) => LONG_DAYS[day] ?? day);

// Technician's day (task-6-1, redesigned in task-10-3 for 390 px, canvas "Techniker – Mein Tag"):
// "Jetzt" as large card, today's list, parts, and "Morgen" always shown.
export default async function TodayPage() {
  const employee = await requireRole(rolesFor("/dashboard/heute"));
  const data = await loadToday(employee.id);
  const done = data.todays.filter((visit) => visit.status === "completed").length;
  const running = data.todays.filter((visit) => visit.status === "in_progress").length;
  const hours = data.hours.length ? `${data.hours[0].start}–${data.hours[data.hours.length - 1].end}` : null;
  const lastEnd = data.todays.length ? data.todays[data.todays.length - 1].scheduled_end : null;

  return (
    <div className="dash-page rw-page rw-page--tight tech-page">
      <header className="dash-page-header">
        <div>
          <h1>Mein Tag</h1>
          <p className="rw-page__sub">{longDate(data.now)}{hours && <> · Arbeitszeit <span className="mono">{hours}</span></>}</p>
          {data.todays.length > 0 && (
            <p className="tech-progress">
              <span className="mono">{done}</span> von <span className="mono">{data.todays.length}</span> {data.todays.length === 1 ? "Einsatz" : "Einsätzen"} erledigt
              {running > 0 && <> · <span className="mono">{running}</span> läuft</>}
            </p>
          )}
        </div>
      </header>
      {data.error && (
        <ErrorState title="Ein Teil der Daten konnte nicht geladen werden." action={<Link className="rw-button-secondary" href="/dashboard/heute">Erneut versuchen</Link>}>
          Angezeigte Einsätze können unvollständig sein.
        </ErrorState>
      )}

      {data.next && (
        <section className="rw-zone" aria-labelledby="now-title">
          <h2 id="now-title" className="tech-h2">{data.next.status === "in_progress" ? "Jetzt" : "Als Nächstes"}</h2>
          <NowCard visit={data.next} now={data.now} />
        </section>
      )}

      <section className="rw-zone" aria-labelledby="today-title">
        <h2 id="today-title" className="tech-h2">Heute</h2>
        {data.todays.length === 0 ? (
          <Card>
            <EmptyState
              title="Heute keine Einsätze geplant"
              action={<Link className="rw-button-secondary" href="/dashboard/kalender">Kalender öffnen</Link>}
            >
              {data.nextLater
                ? <>Nächster Einsatz: <span className="mono">{formatWeekdayDate(data.nextLater.scheduled_start).replace(/\d{4}$/, "")} {formatTime(data.nextLater.scheduled_start)}</span> · {data.nextLater.request.company_name}</>
                : "Noch kein weiterer Einsatz geplant."}
            </EmptyState>
          </Card>
        ) : (
          <ul className="rw-card rw-card--neutral tech-rows">
            {data.todays.map((visit) => <VisitRow key={visit.id} visit={visit} />)}
            {lastEnd && (
              <li className="tech-row tech-row--end">
                <span className="tech-row__time mono">{formatTime(lastEnd)}</span>
                <span className="tech-meta">{hours ? <>Keine weiteren Einsätze bis <span className="mono">{data.hours[data.hours.length - 1].end}</span></> : "Keine weiteren Einsätze"}</span>
              </li>
            )}
          </ul>
        )}
      </section>

      {data.pending.length > 0 && (
        <Card stripe="attention" headingLevel={2} title="Wartet auf Teile" count={data.pending.length}>
          <ul className="tech-parts">
            {data.pending.map((item) => (
              <li key={item.request.id}>
                <Link href={`/dashboard/anfragen/${item.request.id}`}><strong>{item.request.company_name}</strong></Link>
                <span className="tech-meta"><span className="mono">{item.request.request_number}</span> · {label("equipment_kind", item.request.equipment_kind)} · {item.request.city}</span>
                {item.parts.map((part) => (
                  <span key={part.id} className="tech-meta">{formatNumber(part.quantity)} × {part.description}{part.ordered_at && <> · bestellt am <span className="mono">{formatDate(part.ordered_at)}</span></>}</span>
                ))}
                {item.waitingReason && <span className="tech-meta">Einsatz pausiert: {item.waitingReason}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <section className="rw-zone" aria-labelledby="tomorrow-title">
        <div className="rw-zone__header">
          <h2 id="tomorrow-title" className="tech-h2">Morgen, {formatWeekdayDate(`${data.tomorrowDay}T12:00:00Z`).replace(/\d{4}$/, "")}</h2>
          <Link className="rw-link-btn" href="/dashboard/kalender">Kalender</Link>
        </div>
        {data.tomorrow.length === 0 ? (
          <p className="rw-collapsed">Noch keine Einsätze geplant ({formatCalendarDate(data.tomorrowDay)}).</p>
        ) : (
          <ul className="rw-card rw-card--meta tech-rows">{data.tomorrow.map((visit) => <VisitRow key={visit.id} visit={visit} />)}</ul>
        )}
      </section>
    </div>
  );
}
