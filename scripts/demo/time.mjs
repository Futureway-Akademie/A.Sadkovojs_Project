// Local business time in Europe/Berlin, converted to UTC instants.

const TZ = "Europe/Berlin";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export { MINUTE, HOUR, DAY };

const partsFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});
const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

// Local calendar parts of an instant
export function berlinParts(date) {
  const parts = Object.fromEntries(partsFormat.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday],
  };
}

// Instant of a local wall-clock time
export function berlinTime(year, month, day, hour = 0, minute = 0) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let instant = guess;
  for (let i = 0; i < 2; i += 1) {
    const p = berlinParts(new Date(instant));
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    instant += guess - shown;
  }
  return new Date(instant);
}

// Local midnight of the day containing the instant, shifted by whole days
export function berlinDay(date, offsetDays = 0) {
  const p = berlinParts(date);
  const base = new Date(Date.UTC(p.year, p.month - 1, p.day + offsetDays));
  return berlinTime(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate());
}

export function isoDate(date) {
  const p = berlinParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * MINUTE);
export const addHours = (date, hours) => new Date(date.getTime() + hours * HOUR);

// Next local business moment (Mon-Fri 08:00-17:00) at or after the instant
export function nextBusinessTime(date) {
  let candidate = date;
  for (let i = 0; i < 14; i += 1) {
    const p = berlinParts(candidate);
    if (p.weekday <= 5 && p.hour >= 8 && p.hour < 17) return candidate;
    if (p.weekday <= 5 && p.hour < 8) return berlinTime(p.year, p.month, p.day, 8, 0);
    candidate = berlinTime(p.year, p.month, p.day + 1, 8, 0);
  }
  return candidate;
}
