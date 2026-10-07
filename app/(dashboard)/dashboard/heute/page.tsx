import type { Metadata } from "next";
import Link from "next/link";
import { VisitCard } from "@/components/dashboard/visit-card";
import { EmptyState, ErrorState, PageHeader } from "@/components/dashboard/ui/states";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadToday } from "@/lib/dashboard/technician";
import { formatDate, formatNumber, formatWeekdayDate } from "@/lib/format";

export const metadata: Metadata = { title: "Mein Tag" };

export default async function TodayPage() {
  const employee = await requireRole(rolesFor("/dashboard/heute"));
  const data = await loadToday(employee.id);
  const others = data.todays.filter((visit) => visit.id !== data.next?.id);

  return (
    <div className="dash-page tech-page">
      <PageHeader title="Mein Tag" description={formatWeekdayDate(data.now)} />
      {data.error && <ErrorState><p>Ein Teil der Daten konnte nicht geladen werden. Bitte die Seite neu laden.</p></ErrorState>}

      <section className="dash-section" aria-labelledby="next-title">
        <h2 id="next-title">{data.next?.status === "in_progress" ? "Laufender Einsatz" : "Nächster Einsatz"}</h2>
        {data.next ? <VisitCard visit={data.next} emphasis /> : <EmptyState title="Kein Einsatz geplant." />}
      </section>

      <section className="dash-section" aria-labelledby="today-title">
        <h2 id="today-title">Heute ({data.todays.length})</h2>
        {data.todays.length === 0 ? (
          <EmptyState title="Heute keine Einsätze." action={<Link href="/dashboard/kalender">Zum Wochenkalender</Link>} />
        ) : others.length === 0 ? (
          <p className="section-note">Der Einsatz oben ist der einzige heute.</p>
        ) : (
          <div className="visit-list">{others.map((visit) => <VisitCard key={visit.id} visit={visit} />)}</div>
        )}
      </section>

      <section className="dash-section" aria-labelledby="parts-title">
        <h2 id="parts-title">Ausstehende Teile ({data.pending.length})</h2>
        {data.pending.length === 0 ? (
          <EmptyState title="Keine Anfrage wartet auf Teile." />
        ) : (
          <ul className="parts-list">
            {data.pending.map((item) => (
              <li key={item.request.id}>
                <Link href={`/dashboard/anfragen/${item.request.id}`}><span className="mono">{item.request.request_number}</span> · {item.request.company_name}</Link>
                {item.waitingReason && <span className="cell-sub">Einsatz pausiert: {item.waitingReason}</span>}
                {item.parts.length > 0 && (
                  <ul>
                    {item.parts.map((part) => (
                      <li key={part.id}>{formatNumber(part.quantity)} × {part.description}{part.ordered_at && <span className="cell-sub cell-sub--inline"> · bestellt am {formatDate(part.ordered_at)}</span>}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
