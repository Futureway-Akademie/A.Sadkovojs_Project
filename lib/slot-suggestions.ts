// Planning suggestions (design rework task-10-3, specification section 07): per technician the earliest
// free window of the chosen duration within the working hours, in Europe/Berlin.
// Ranking (user decision 08.10.2026): technicians who already completed visits for the same customer
// come first (earliest window first). For a new customer: experience with the manufacturer, then with
// the equipment type, then lower load in the planning window, then the earliest window.
import { addDays, berlinToInstant, dayKeyOf, isoWeekday } from "./berlin-time";

export type SlotTechnician = { id: string; name: string };
export type SlotWorkingHours = { technicianId: string; weekday: number; start: string; end: string; validFrom: string | null; validTo: string | null };
export type SlotBusy = { technicianId: string; start: string; end: string; kind: "visit" | "absence" };
// Completed visits of a technician: for this customer, for this manufacturer + equipment type, for this equipment type
export type SlotExperience = { customerVisits: number; manufacturerVisits: number; equipmentVisits: number };

export type SlotReason = "earliest" | "knows_customer" | "knows_manufacturer" | "knows_equipment" | "lowest_load" | "today";

export type SlotSuggestion = {
  technicianId: string;
  name: string;
  day: string;
  start: string;
  end: string;
  startTime: string;
  endTime: string;
  customerVisits: number;
  // 2 = manufacturer and equipment type known, 1 = equipment type known, 0 = none
  experienceLevel: 0 | 1 | 2;
  loadMinutes: number;
  reasons: SlotReason[];
};

export type SlotInput = {
  technicians: readonly SlotTechnician[];
  workingHours: readonly SlotWorkingHours[];
  busy: readonly SlotBusy[];
  days: readonly string[];
  now: Date;
  durationMinutes: number;
  experience: Readonly<Record<string, SlotExperience | undefined>>;
  stepMinutes?: number;
};

export const SLOT_DURATIONS = [60, 120, 180, 240] as const;

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** The next working days (Monday to Friday) starting with today */
export function nextWorkingDays(today: string, count: number): string[] {
  const days: string[] = [];
  for (let day = today; days.length < count; day = addDays(day, 1)) {
    if (isoWeekday(day) <= 5) days.push(day);
  }
  return days;
}

export function hoursOn(workingHours: readonly SlotWorkingHours[], technicianId: string, day: string): SlotWorkingHours[] {
  const weekday = isoWeekday(day);
  return workingHours
    .filter((row) => row.technicianId === technicianId && row.weekday === weekday && (!row.validFrom || row.validFrom <= day) && (!row.validTo || row.validTo >= day))
    .sort((a, b) => a.start.localeCompare(b.start));
}

// Earliest window of the duration for one technician; starts on the step grid of the working hours
export function earliestWindow(input: SlotInput, technicianId: string): { day: string; start: Date; end: Date; startTime: string; endTime: string } | null {
  const step = input.stepMinutes ?? 30;
  const busy = input.busy
    .filter((block) => block.technicianId === technicianId)
    .map((block) => ({ start: Date.parse(block.start), end: Date.parse(block.end) }));
  for (const day of input.days) {
    for (const hours of hoursOn(input.workingHours, technicianId, day)) {
      const last = toMinutes(hours.end) - input.durationMinutes;
      for (let minute = toMinutes(hours.start); minute <= last; minute += step) {
        const start = berlinToInstant(day, toTime(minute));
        const end = berlinToInstant(day, toTime(minute + input.durationMinutes));
        if (start.getTime() < input.now.getTime()) continue;
        if (busy.some((block) => start.getTime() < block.end && end.getTime() > block.start)) continue;
        return { day, start, end, startTime: toTime(minute), endTime: toTime(minute + input.durationMinutes) };
      }
    }
  }
  return null;
}

const experienceLevel = (experience: SlotExperience | undefined): 0 | 1 | 2 =>
  !experience ? 0 : experience.manufacturerVisits > 0 ? 2 : experience.equipmentVisits > 0 ? 1 : 0;

// Booked visit minutes of a technician within the planning days
function loadMinutes(input: SlotInput, technicianId: string): number {
  if (input.days.length === 0) return 0;
  const from = berlinToInstant(input.days[0], "00:00").getTime();
  const to = berlinToInstant(addDays(input.days[input.days.length - 1], 1), "00:00").getTime();
  return input.busy
    .filter((block) => block.technicianId === technicianId && block.kind === "visit")
    .reduce((total, block) => total + Math.max(0, Math.min(Date.parse(block.end), to) - Math.max(Date.parse(block.start), from)) / 60000, 0);
}

export function compareSuggestions(a: SlotSuggestion, b: SlotSuggestion): number {
  const knowsA = a.customerVisits > 0;
  const knowsB = b.customerVisits > 0;
  if (knowsA !== knowsB) return knowsA ? -1 : 1;
  if (knowsA) return a.start.localeCompare(b.start) || b.customerVisits - a.customerVisits || a.name.localeCompare(b.name, "de");
  return b.experienceLevel - a.experienceLevel || a.loadMinutes - b.loadMinutes || a.start.localeCompare(b.start) || a.name.localeCompare(b.name, "de");
}

// One suggestion per technician with a free window, ranked; technicians without a window are left out
export function suggestSlots(input: SlotInput): SlotSuggestion[] {
  const today = dayKeyOf(input.now);
  const suggestions: SlotSuggestion[] = [];
  for (const technician of input.technicians) {
    const window = earliestWindow(input, technician.id);
    if (!window) continue;
    const experience = input.experience[technician.id];
    suggestions.push({
      technicianId: technician.id,
      name: technician.name,
      day: window.day,
      start: window.start.toISOString(),
      end: window.end.toISOString(),
      startTime: window.startTime,
      endTime: window.endTime,
      customerVisits: experience?.customerVisits ?? 0,
      experienceLevel: experienceLevel(experience),
      loadMinutes: Math.round(loadMinutes(input, technician.id)),
      reasons: [],
    });
  }
  suggestions.sort(compareSuggestions);

  const earliest = suggestions.reduce<string | null>((min, entry) => (min === null || entry.start < min ? entry.start : min), null);
  const loads = suggestions.map((entry) => entry.loadMinutes);
  const minLoad = Math.min(...loads);
  const uniqueMinLoad = suggestions.length > 1 && loads.filter((load) => load === minLoad).length === 1;
  for (const entry of suggestions) {
    if (entry.start === earliest) entry.reasons.push("earliest");
    if (entry.customerVisits > 0) entry.reasons.push("knows_customer");
    else if (entry.experienceLevel === 2) entry.reasons.push("knows_manufacturer");
    else if (entry.experienceLevel === 1) entry.reasons.push("knows_equipment");
    if (uniqueMinLoad && entry.loadMinutes === minLoad) entry.reasons.push("lowest_load");
    if (entry.day === today) entry.reasons.push("today");
  }
  return suggestions;
}

export function slotReasonText(reason: SlotReason, suggestion: Pick<SlotSuggestion, "customerVisits">): string {
  switch (reason) {
    case "earliest": return "Frühester Termin";
    case "knows_customer": return suggestion.customerVisits === 1 ? "Kennt die Firma (1 Einsatz)" : `Kennt die Firma (${suggestion.customerVisits} Einsätze)`;
    case "knows_manufacturer": return "Erfahrung mit Hersteller und Anlagentyp";
    case "knows_equipment": return "Erfahrung mit dem Anlagentyp";
    case "lowest_load": return "Geringste Auslastung";
    case "today": return "Heute";
  }
}
