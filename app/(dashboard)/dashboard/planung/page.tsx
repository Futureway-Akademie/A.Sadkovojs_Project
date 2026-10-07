import type { Metadata } from "next";
import Link from "next/link";
import { PlanningCalendar } from "@/components/dashboard/planning-calendar";
import { HiddenField, SaveForm, SelectField, TextField } from "@/components/dashboard/ui/save-form";
import { EmptyState, ErrorState, PageHeader } from "@/components/dashboard/ui/states";
import { StatusBadge } from "@/components/dashboard/ui/status-badge";
import { addDays, dayKeyOf, isoWeek } from "@/lib/berlin-time";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadPlanning } from "@/lib/dashboard/planning";
import { formatDate, formatDateTime } from "@/lib/format";
import { label } from "@/lib/status";
import { scheduleVisit } from "./actions";

export const metadata: Metadata = { title: "Einsatzplanung" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function PlanningPage({ searchParams }: Props) {
  const employee = await requireRole(rolesFor("/dashboard/planung"));
  const params = await searchParams;
  const weekParam = typeof params.woche === "string" ? params.woche : undefined;
  const requestParam = typeof params.anfrage === "string" ? params.anfrage : undefined;
  const data = await loadPlanning(employee, weekParam, requestParam);
  const link = (overrides: { woche?: string; anfrage?: string | null }) => {
    const query = new URLSearchParams();
    const week = overrides.woche ?? data.week;
    const request = overrides.anfrage === undefined ? data.selected?.id ?? null : overrides.anfrage;
    query.set("woche", week);
    if (request) query.set("anfrage", request);
    return `/dashboard/planung?${query.toString()}`;
  };
  const today = dayKeyOf(new Date());
  const selected = data.selected;

  return (
    <div className="dash-page">
      <PageHeader
        title="Einsatzplanung"
        description={employee.role === "dispatcher" ? "Ihre Anfragen, die einen Einsatz brauchen, und die Belegung aller Techniker." : "Alle Anfragen, die einen Einsatz brauchen, und die Belegung aller Techniker."}
      />
      {data.error && <ErrorState><p>Ein Teil der Planungsdaten konnte nicht geladen werden. Bitte die Seite neu laden.</p></ErrorState>}

      <div className="plan-layout">
        <section className="dash-section plan-queue" aria-labelledby="queue-title">
          <h2 id="queue-title">Zu planen ({data.queue.length})</h2>
          {data.queue.length === 0 ? (
            <EmptyState title="Keine Anfrage wartet auf einen Einsatz." />
          ) : (
            <ul className="plan-queue__list">
              {data.queue.map((row) => (
                <li key={row.id}>
                  <Link href={link({ anfrage: row.id })} className="plan-queue__item" aria-current={row.id === selected?.id ? "true" : undefined}>
                    <span className="mono">{row.request_number}</span>
                    <strong>{row.company_name}</strong>
                    <span className="cell-sub">{row.city} · {label("service_kind", row.service_kind)}</span>
                    <span className="badge-row">
                      {row.priority && <StatusBadge kind="request_priority" value={row.priority} />}
                      {row.work_status === "waiting_parts" && <span className="hint hint--info">Folgeeinsatz</span>}
                      {row.safety_check_required && <span className="hint hint--danger">Sicherheitsprüfung nötig</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section id="booking" className="dash-section plan-booking" aria-labelledby="booking-title">
          <h2 id="booking-title">Einsatz planen</h2>
          {selected ? (
            <>
              <p className="plan-booking__request">
                <Link href={`/dashboard/anfragen/${selected.id}`} className="mono">{selected.request_number}</Link> · {selected.company_name}
                {selected.due_at && <span className="cell-sub">Servicefrist {formatDateTime(selected.due_at)}</span>}
              </p>
              {selected.safety_check_required && (
                <p className="request-alert" role="note">Automatisch bearbeitet mit Sicherheitsgefahr: vor der Planung auf der Anfrageseite prüfen (z. B. Analyse korrigieren).</p>
              )}
              <SaveForm action={scheduleVisit} submitLabel="Einsatz planen">
                <HiddenField name="request_id" value={selected.id ?? ""} />
                <HiddenField name="version" value={selected.version ?? 0} />
                <SelectField name="technician_id" label="Techniker" required options={data.technicians.map((tech) => ({ value: tech.id, label: tech.name }))} />
                <div className="form-grid plan-booking__times">
                  <TextField name="date" label="Datum" type="date" required defaultValue={addDays(today, 1)} />
                  <TextField name="start" label="Beginn" type="time" required defaultValue="08:00" />
                  <TextField name="end" label="Ende" type="time" required defaultValue="10:00" />
                </div>
              </SaveForm>
            </>
          ) : data.selectedPlanned ? (
            <EmptyState title={`${data.selectedPlanned.request_number} braucht keine Planung mehr.`} action={<Link href={`/dashboard/anfragen/${data.selectedPlanned.id}`}>Zur Anfrage</Link>}>
              <p>Die Anfrage ist eingeplant oder nicht mehr offen.</p>
            </EmptyState>
          ) : (
            <EmptyState title="Anfrage auswählen">Links eine Anfrage wählen, dann Techniker und Zeitraum festlegen.</EmptyState>
          )}
        </section>
      </div>

      <section className="dash-section" aria-labelledby="calendar-title">
        <div className="plan-week">
          <h2 id="calendar-title">KW {isoWeek(data.week)} · {formatDate(`${data.week}T12:00:00Z`)} – {formatDate(`${addDays(data.week, 6)}T12:00:00Z`)}</h2>
          <nav className="plan-week__nav" aria-label="Woche wechseln">
            <Link href={link({ woche: addDays(data.week, -7) })}>← Vorherige</Link>
            <Link href={link({ woche: today })}>Heute</Link>
            <Link href={link({ woche: addDays(data.week, 7) })}>Nächste →</Link>
          </nav>
        </div>
        <PlanningCalendar days={data.days} technicians={data.technicians} workingHours={data.workingHours} busy={data.busy} canPick={Boolean(selected)} />
      </section>
    </div>
  );
}
