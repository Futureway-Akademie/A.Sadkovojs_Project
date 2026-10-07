"use client";

import Link from "next/link";
import { dayKeyOf, isoWeekday, minutesOfDay } from "@/lib/berlin-time";
import { formatTime, formatTimeRange, formatWeekdayDate } from "@/lib/format";

// Week timeline for visit planning and the technician's own calendar (own component; library evaluation in docs/decisions.md).
// All positions are computed in Europe/Berlin, independent of the browser time zone.
type Technician = { id: string; name: string };
type WorkingHours = { technicianId: string; weekday: number; start: string; end: string; validFrom: string | null; validTo: string | null };
type BusyBlock = { technicianId: string; start: string; end: string; kind: "visit" | "absence"; requestId: string | null; requestNumber: string | null; done?: boolean; note?: string };

const DAY_START = 6 * 60;
const DAY_END = 20 * 60;
const SPAN = DAY_END - DAY_START;
const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const percent = (minutes: number) => `${((Math.min(Math.max(minutes, DAY_START), DAY_END) - DAY_START) / SPAN) * 100}%`;

function hoursFor(technicianId: string, day: string, workingHours: WorkingHours[]) {
  const weekday = isoWeekday(day);
  return workingHours.filter((row) => row.technicianId === technicianId && row.weekday === weekday
    && (!row.validFrom || row.validFrom <= day) && (!row.validTo || row.validTo >= day));
}

// Part of an interval that falls on the given Berlin day, in minutes since midnight
function onDay(start: string, end: string, day: string): [number, number] | null {
  const from = new Date(start);
  const to = new Date(end);
  const startDay = dayKeyOf(from);
  const endDay = dayKeyOf(to);
  if (startDay > day || endDay < day) return null;
  const a = startDay === day ? minutesOfDay(from) : 0;
  const b = endDay === day ? minutesOfDay(to) : 24 * 60;
  return b > a ? [a, b] : null;
}

function setField(name: string, value: string) {
  const element = document.getElementById(`field-${name}`) as HTMLInputElement | HTMLSelectElement | null;
  if (!element) return;
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

export function PlanningCalendar({ days, technicians, workingHours, busy, canPick, ownOnly = false }: { days: string[]; technicians: Technician[]; workingHours: WorkingHours[]; busy: BusyBlock[]; canPick: boolean; ownOnly?: boolean }) {
  // Weekend days only when someone works or is booked
  const visibleDays = days.filter((day) => isoWeekday(day) <= 5
    || technicians.some((tech) => hoursFor(tech.id, day, workingHours).length > 0)
    || busy.some((block) => onDay(block.start, block.end, day)));

  const pick = (technicianId: string, day: string, event: React.MouseEvent<HTMLDivElement>) => {
    if (!canPick || (event.target as HTMLElement).closest(".plan-block")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const minute = DAY_START + Math.round((((event.clientX - rect.left) / rect.width) * SPAN) / 30) * 30;
    const start = Math.min(Math.max(minute, DAY_START), DAY_END - 30);
    const startField = document.getElementById("field-start") as HTMLInputElement | null;
    const endField = document.getElementById("field-end") as HTMLInputElement | null;
    const duration = startField?.value && endField?.value && endField.value > startField.value ? toMinutes(endField.value) - toMinutes(startField.value) : 120;
    setField("technician_id", technicianId);
    setField("date", day);
    setField("start", toTime(start));
    setField("end", toTime(Math.min(start + duration, 23 * 60 + 30)));
    document.getElementById("booking")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="plan-calendar">
      <div className="plan-legend" aria-hidden="true">
        <span><i className="plan-swatch plan-swatch--own" />{ownOnly ? "Mein Einsatz" : "Eigene Anfrage"}</span>
        {ownOnly ? <span><i className="plan-swatch plan-swatch--done" />Erledigt oder pausiert</span> : <span><i className="plan-swatch plan-swatch--busy" />Belegt</span>}
        <span><i className="plan-swatch plan-swatch--absence" />Nicht verfügbar</span>
        <span><i className="plan-swatch plan-swatch--off" />Außerhalb der Arbeitszeit</span>
      </div>
      {canPick && <p className="section-note">Freien Bereich in einer Zeile anklicken, um Techniker, Datum und Uhrzeit in das Formular zu übernehmen.</p>}
      {visibleDays.map((day) => (
        <section key={day} className="plan-day" aria-label={formatWeekdayDate(`${day}T12:00:00Z`)}>
          <h3>{formatWeekdayDate(`${day}T12:00:00Z`)}</h3>
          <div className="plan-scale" aria-hidden="true">
            {Array.from({ length: SPAN / 120 + 1 }, (_, index) => DAY_START + index * 120).map((minute) => (
              <span key={minute} style={{ left: percent(minute) }}>{toTime(minute)}</span>
            ))}
          </div>
          {technicians.map((tech) => {
            const hours = hoursFor(tech.id, day, workingHours);
            const blocks = busy.filter((block) => block.technicianId === tech.id).map((block) => ({ block, range: onDay(block.start, block.end, day) })).filter((item) => item.range);
            const summary = hours.length ? hours.map((row) => `${row.start}–${row.end}`).join(", ") : "kein Arbeitstag";
            return (
              <div key={tech.id} className="plan-row">
                <div className="plan-name">{tech.name}<span className="cell-sub">{summary}</span></div>
                <div className={`plan-lane${canPick ? " plan-lane--pick" : ""}`} onClick={(event) => pick(tech.id, day, event)} role="presentation">
                  {/* Non-working time shaded: whole day, then working hours cut out */}
                  <div className="plan-off" style={{ left: 0, width: "100%" }} />
                  {hours.map((row) => (
                    <div key={`${row.start}-${row.end}`} className="plan-work" style={{ left: percent(toMinutes(row.start)), width: `calc(${percent(toMinutes(row.end))} - ${percent(toMinutes(row.start))})` }} />
                  ))}
                  {blocks.map(({ block, range }) => {
                    const [a, b] = range as [number, number];
                    const label = block.kind === "absence" ? "Nicht verfügbar" : `${block.requestNumber ?? "Belegt"}${block.note ? ` · ${block.note}` : ""}`;
                    const when = formatTimeRange(block.start, block.end);
                    const style = { left: percent(a), width: `calc(${percent(b)} - ${percent(a)})` };
                    const className = `plan-block plan-block--${block.kind === "absence" ? "absence" : block.requestNumber ? "own" : "busy"}${block.done ? " plan-block--done" : ""}`;
                    return block.requestId ? (
                      <Link key={`${block.start}-${block.end}`} href={`/dashboard/anfragen/${block.requestId}`} className={className} style={style} title={`${label}: ${when}`} aria-label={`${tech.name}: ${label}, ${when}`}>
                        <span>{label}</span>
                      </Link>
                    ) : (
                      <span key={`${block.start}-${block.end}`} className={className} style={style} title={`${label}: ${formatTime(block.start)}–${formatTime(block.end)}`} aria-label={`${tech.name}: ${label}, ${when}`}>
                        <span>{label}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
