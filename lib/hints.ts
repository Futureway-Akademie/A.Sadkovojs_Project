// Automatic hints (design rework task-10-3, specification section 07). Generated only by these fixed
// rules from database values, never maintained by hand; without a match there is no hint (null).
import { addDays } from "./berlin-time";

export type Hint = { kind: "peak" | "record" | "small_base" | "due_soon"; text: string };

// Bottleneck: today's queue length equals the maximum of the last 90 days (today included) and is > 1.
// Days without a row count as 0.
export function queuePeakHint(history: ReadonlyArray<{ day: string; value: number }>, today: string): Hint | null {
  const from = addDays(today, -89);
  const window = history.filter((row) => row.day >= from && row.day <= today);
  const current = window.find((row) => row.day === today)?.value ?? 0;
  if (current <= 1) return null;
  const maximum = Math.max(...window.map((row) => Number(row.value)));
  return current >= maximum ? { kind: "peak", text: "Höchststand der letzten 90 Tage" } : null;
}

// Highest monthly value: the last completed month is above every previous month. The running month
// (currentMonth, YYYY-MM-01) does not count; at least one previous month is required.
export function monthRecordHint(months: ReadonlyArray<{ bucket_start: string; value: number }>, currentMonth: string): Hint | null {
  const completed = months.filter((row) => row.bucket_start.slice(0, 7) < currentMonth.slice(0, 7)).sort((a, b) => a.bucket_start.localeCompare(b.bucket_start));
  if (completed.length < 2) return null;
  const last = completed[completed.length - 1];
  const previous = completed.slice(0, -1);
  return Number(last.value) > Math.max(...previous.map((row) => Number(row.value)))
    ? { kind: "record", text: "Höchster Monatswert bisher" }
    : null;
}

export const SMALL_BASE_LIMIT = 20;

// A share computed from fewer than 20 cases
export function smallBaseHint(cases: number | null | undefined): Hint | null {
  if (cases === null || cases === undefined || cases >= SMALL_BASE_LIMIT) return null;
  return { kind: "small_base", text: `Kleine Basis: ${cases === 1 ? "1 Fall" : `${cases} Fälle`}` };
}

// Open invoice due within the next 7 days (today included); overdue invoices are not "due soon"
export function dueSoonHint(status: string | null | undefined, paymentDueDate: string | null | undefined, today: string): Hint | null {
  if ((status !== "issued" && status !== "sent") || !paymentDueDate) return null;
  if (paymentDueDate < today || paymentDueDate > addDays(today, 7)) return null;
  const days = Math.round((Date.parse(`${paymentDueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  return { kind: "due_soon", text: days === 0 ? "Heute fällig" : days === 1 ? "Morgen fällig" : `Fällig in ${days} Tagen` };
}
