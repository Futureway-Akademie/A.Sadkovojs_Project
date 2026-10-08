// Chart data of the analysis page (task-7-3): pure transformations of database rows (analytics_series,
// analytics_queue_history). No hard-coded series; usable on server and in tests.

export type SeriesRow = {
  bucket_start: string;
  received: number;
  intake_completed: number;
  automatic_completed: number;
  completed: number;
  invoiced_gross: number;
  payments_received: number;
  saved_requests: number;
  saved_minutes: number;
  baseline_minutes: number | null;
};

export type QueueRow = { day: string; queue: string; requests: number };

const MONTH_SHORT = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

/** 2026-03-01 → Mär 26 */
export function monthLabel(bucket: string): string {
  const [year, month] = bucket.split("-").map(Number);
  return `${MONTH_SHORT[month - 1]} ${String(year).slice(2)}`;
}

/** 2026-03-07 → 07.03. */
export function dayLabel(day: string): string {
  const [, month, date] = day.split("-");
  return `${date}.${month}.`;
}

// Cumulative count per day index for the current and the comparison span. The current span stops at
// its last elapsed day; days of the comparison span beyond its length stay empty.
export function cumulativeComparison(current: Array<{ bucket_start: string; value: number }>, previous: Array<{ bucket_start: string; value: number }>) {
  const length = Math.max(current.length, previous.length);
  let currentSum = 0;
  let previousSum = 0;
  return Array.from({ length }, (_, index) => {
    if (index < current.length) currentSum += current[index].value;
    if (index < previous.length) previousSum += previous[index].value;
    return {
      day: index + 1,
      current: index < current.length ? currentSum : null,
      previous: index < previous.length ? previousSum : null,
    };
  });
}

// Received requests per calendar month, one series per year (seasonality)
export function seasonality(rows: Array<Pick<SeriesRow, "bucket_start" | "received">>, lastBucket: string) {
  const years = [...new Set(rows.map((row) => row.bucket_start.slice(0, 4)))].sort();
  const byKey = new Map(rows.map((row) => [row.bucket_start.slice(0, 7), row.received]));
  // Months before the first data and after the current month have no data (empty, not zero)
  const firstKey = rows.find((row) => row.received > 0)?.bucket_start.slice(0, 7) ?? "9999-99";
  const data = MONTH_SHORT.map((month, index) => {
    const entry: Record<string, string | number | null> = { month };
    for (const year of years) {
      const key = `${year}-${String(index + 1).padStart(2, "0")}`;
      entry[year] = key > lastBucket.slice(0, 7) || key < firstKey ? null : byKey.get(key) ?? null;
    }
    return entry;
  });
  return { years, data };
}

// Automation per month: share of automatic initial processing and estimated time saved
export function automationSeries(rows: SeriesRow[]) {
  return rows.map((row) => ({
    month: monthLabel(row.bucket_start),
    share: row.intake_completed > 0 ? Math.round((1000 * row.automatic_completed) / row.intake_completed) / 10 : null,
    automatic: row.automatic_completed,
    total: row.intake_completed,
    corrected: Math.max(0, row.automatic_completed - row.saved_requests),
    savedHours: Math.round((row.saved_minutes / 60) * 10) / 10,
    savedMinutes: Number(row.saved_minutes),
    savedRequests: row.saved_requests,
    baseline: row.baseline_minutes === null ? null : Number(row.baseline_minutes),
  }));
}

export const QUEUE_LABELS: Record<string, string> = {
  analysis: "In Analyse",
  review: "Prüfung",
  awaiting_customer: "Wartet auf Kunde",
  planning: "Einsatzplanung",
};

// Queue history in wide form: one row per day, one column per queue
export function queueSeries(rows: QueueRow[]) {
  const days = new Map<string, Record<string, string | number>>();
  for (const row of rows) {
    const entry = days.get(row.day) ?? { day: dayLabel(row.day), date: row.day };
    entry[row.queue] = row.requests;
    days.set(row.day, entry);
  }
  return [...days.values()];
}

export function sum(values: number[]): number {
  return Math.round(values.reduce((total, value) => total + Number(value), 0) * 100) / 100;
}
