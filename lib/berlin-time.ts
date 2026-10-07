// Calendar arithmetic in Europe/Berlin, independent of the server or browser time zone.
// Day keys are "YYYY-MM-DD" (local calendar day in Berlin), times "HH:MM".
import { TIME_ZONE } from "./format";

const partsFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parts(date: Date) {
  const map = Object.fromEntries(partsFormat.formatToParts(date).map((part) => [part.type, part.value]));
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day), hour: Number(map.hour), minute: Number(map.minute) };
}

export function isDayKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Berlin calendar day of an instant */
export function dayKeyOf(date: Date): string {
  const p = parts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Minutes since local midnight in Berlin */
export function minutesOfDay(date: Date): number {
  const p = parts(date);
  return p.hour * 60 + p.minute;
}

export function addDays(dayKey: string, days: number): string {
  const date = new Date(`${dayKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** ISO weekday 1 (Monday) … 7 (Sunday) of a day key */
export function isoWeekday(dayKey: string): number {
  const day = new Date(`${dayKey}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Monday of the week containing the day */
export function weekStart(dayKey: string): string {
  return addDays(dayKey, 1 - isoWeekday(dayKey));
}

/** ISO calendar week number */
export function isoWeek(dayKey: string): number {
  const thursday = new Date(`${addDays(dayKey, 4 - isoWeekday(dayKey))}T00:00:00Z`);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Local Berlin date and time → instant. For times skipped by the switch to summer time the result
 * moves forward; for repeated times in autumn the first (summer time) occurrence is used.
 */
export function berlinToInstant(dayKey: string, time: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted - 60 * 60 * 1000;
  for (let i = 0; i < 3; i += 1) {
    const p = parts(new Date(guess));
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    if (shown === wanted) break;
    guess += wanted - shown;
  }
  return new Date(guess);
}
