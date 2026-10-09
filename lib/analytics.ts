// Manager analytics in the UI (task-7-2): period parameters, KPI definitions with list links and the
// formatting of values and changes. Pure functions without data access (usable in tests and on the client).
import { formatCurrency, formatDate, formatDateTime, formatMinutes, formatNumber, formatPercent, formatTime } from "./format";

export type PeriodKind = "week" | "month" | "quarter" | "year";

export const PERIOD_OPTIONS: ReadonlyArray<{ param: string; kind: PeriodKind; label: string }> = [
  { param: "woche", kind: "week", label: "Woche" },
  { param: "monat", kind: "month", label: "Monat" },
  { param: "quartal", kind: "quarter", label: "Quartal" },
  { param: "jahr", kind: "year", label: "Jahr" },
];

export type PeriodParams = { kind: PeriodKind; param: string; anchor: string | null };

// ?zeitraum=monat&datum=2026-09-01; unknown values fall back to the current month
export function parsePeriodParams(params: Record<string, string | string[] | undefined>): PeriodParams {
  const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const option = PERIOD_OPTIONS.find((entry) => entry.param === single(params.zeitraum)) ?? PERIOD_OPTIONS[1];
  const date = single(params.datum);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(`${date}T00:00:00Z`).getTime());
  return { kind: option.kind, param: option.param, anchor: valid ? date : null };
}

export function periodQuery(param: string, anchor: string | null) {
  return anchor ? `?zeitraum=${param}&datum=${anchor}` : `?zeitraum=${param}`;
}

// Anchor dates of the neighbouring periods: the day before the first and after the last local day
export function neighbourAnchors(startDay: string, endDay: string) {
  const shift = (day: string, days: number) => {
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  return { previous: shift(startDay, -1), next: shift(endDay, 1) };
}

export type KpiRow = {
  key: string;
  label: string;
  measure: "event" | "snapshot";
  unit: "count" | "percent" | "days" | "eur" | "minutes";
  current_value: number | null;
  previous_value: number | null;
  difference: number | null;
  change_percent: number | null;
  detail: Record<string, unknown> | null;
};

type Window = { current_start: string; current_end: string };
type KpiInfo = {
  definition: string;
  // Direction in which a change is good; null = neutral
  better: "up" | "down" | null;
  href?: (window: Window) => string;
};

const range = (path: string, field: string, window: Window, extra = "") =>
  `${path}?feld=${field}&von=${encodeURIComponent(window.current_start)}&bis=${encodeURIComponent(window.current_end)}${extra}`;

export const KPI_INFO: Record<string, KpiInfo> = {
  received: { definition: "Neue Anfragen nach Eingangszeitpunkt.", better: null, href: (w) => range("/dashboard/anfragen", "eingang", w) },
  intake_completed: { definition: "Abgeschlossene Erstbearbeitungen (bearbeitet oder abgelehnt) nach Abschlusszeitpunkt.", better: null, href: (w) => range("/dashboard/anfragen", "erstbearbeitung", w) },
  automatic_share: {
    definition: "Anteil automatisch abgeschlossener Erstbearbeitungen; später korrigierte automatische Ergebnisse zählen als automatisch.",
    better: "up",
    href: (w) => range("/dashboard/anfragen", "erstbearbeitung", w, "&modus=automatic"),
  },
  completed: { definition: "Technisch abgeschlossene Anfragen nach Abschlusszeitpunkt.", better: "up", href: (w) => range("/dashboard/anfragen", "abschluss", w) },
  lead_time_days: { definition: "Durchschnittliche Tage vom Eingang bis zum Abschluss der im Zeitraum abgeschlossenen Anfragen.", better: "down", href: (w) => range("/dashboard/anfragen", "abschluss", w) },
  response_on_time: {
    definition: "Anfragen mit Antwortfrist im Zeitraum, bei denen erste inhaltliche Antwort oder Abschluss der Erstbearbeitung rechtzeitig erfolgte.",
    better: "up",
    href: (w) => range("/dashboard/anfragen", "antwortfrist", w),
  },
  service_on_time: { definition: "Im Zeitraum abgeschlossene Anfragen mit Servicefrist, die bis zur Frist abgeschlossen wurden.", better: "up", href: (w) => range("/dashboard/anfragen", "abschluss", w) },
  time_saved_minutes: {
    definition: "Geschätzt: Basiswert der manuellen Bearbeitung je automatisch und ohne Korrektur abgeschlossener Erstbearbeitung.",
    better: "up",
    href: (w) => range("/dashboard/anfragen", "erstbearbeitung", w, "&modus=automatic"),
  },
  open_requests: { definition: "Nicht abgeschlossene, nicht stornierte und nicht abgelehnte Anfragen am Ende des Zeitraums.", better: null, href: () => "/dashboard/anfragen?status=offen" },
  review_queue: { definition: "Anfragen in der Prüfung am Ende des Zeitraums.", better: "down", href: () => "/dashboard/anfragen?erstbearbeitung=needs_review" },
  planning_queue: { definition: "Bearbeitete Anfragen ohne geplanten Einsatz am Ende des Zeitraums.", better: "down", href: () => "/dashboard/planung" },
  invoiced_gross: { definition: "Bruttobetrag der im Zeitraum ausgestellten Rechnungen. Ausgestellt ist nicht eingenommen.", better: null, href: (w) => range("/dashboard/rechnungen", "ausgestellt", w) },
  revenue_net: { definition: "Nettobetrag der im Zeitraum ausgestellten Rechnungen.", better: "up", href: (w) => range("/dashboard/rechnungen", "ausgestellt", w) },
  payments_received: { definition: "Bruttobetrag der im Zeitraum als bezahlt erfassten Rechnungen.", better: "up", href: (w) => range("/dashboard/rechnungen", "bezahlt", w) },
  open_receivables: { definition: "Ausgestellte, am Ende des Zeitraums nicht bezahlte Rechnungen (brutto).", better: "down", href: () => "/dashboard/rechnungen?status=offen" },
  overdue_receivables: { definition: "Offene Rechnungen, deren Fälligkeit am Ende des Zeitraums überschritten war (brutto).", better: "down", href: () => "/dashboard/rechnungen?status=ueberfaellig" },
};

export const KPI_GROUPS = {
  events: ["received", "intake_completed", "automatic_share", "completed", "lead_time_days", "response_on_time", "service_on_time", "time_saved_minutes"],
  snapshots: ["open_requests", "review_queue", "planning_queue"],
  finance: ["invoiced_gross", "revenue_net", "payments_received", "open_receivables", "overdue_receivables"],
} as const;

export function formatKpiValue(unit: KpiRow["unit"], value: number | null | undefined): string {
  if (value === null || value === undefined) return "–";
  switch (unit) {
    case "count": return formatNumber(value);
    case "percent": return formatPercent(value);
    case "days": return `${formatNumber(value, 1)} Tage`;
    case "eur": return formatCurrency(value);
    case "minutes": return formatMinutes(value);
  }
}

export type KpiTone = "good" | "bad" | "neutral";
export type KpiChange = { text: string; tone: KpiTone; word: string | null; note: string | null };

// Assessment of a change (specification section 03): green and red mean better and worse, not more
// and less. Metrics without direction say "mehr"/"weniger" in grey. The word is always shown,
// so the color is never the only cue.
export function kpiAssessment(key: string, difference: number): { tone: KpiTone; word: string } {
  if (difference === 0) return { tone: "neutral", word: "unverändert" };
  const better = KPI_INFO[key]?.better ?? null;
  if (better === null) return { tone: "neutral", word: difference > 0 ? "mehr" : "weniger" };
  return (difference > 0) === (better === "up") ? { tone: "good", word: "besser" } : { tone: "bad", word: "schlechter" };
}

// Change against the comparison period: percent for amounts, points for percentages,
// never a percentage on a zero or missing base
export function formatKpiChange(row: Pick<KpiRow, "key" | "unit" | "current_value" | "previous_value" | "difference" | "change_percent">): KpiChange {
  const { unit, current_value: current, previous_value: previous, difference } = row;
  if (current === null || previous === null || difference === null) return { text: "–", tone: "neutral", word: null, note: "Kein Vergleichswert" };
  const { tone, word } = kpiAssessment(row.key, difference);
  const sign = difference > 0 ? "+" : difference < 0 ? "−" : "±";
  if (unit === "percent") return { text: `${sign}${formatNumber(Math.abs(difference), 1)} Pkt.`, tone, word, note: null };
  if (previous === 0) {
    const absolute = unit === "eur" ? formatCurrency(Math.abs(difference)) : unit === "minutes" ? formatMinutes(Math.abs(difference)) : formatNumber(Math.abs(difference), unit === "days" ? 1 : 0);
    return { text: `${sign}${absolute}`, tone, word, note: "Vorperiode 0 – kein Prozentwert" };
  }
  if (row.change_percent === null) return { text: "–", tone: "neutral", word: null, note: "Kein Vergleichswert" };
  return { text: `${sign}${formatNumber(Math.abs(row.change_percent), 1)} %`, tone, word, note: null };
}

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

// ISO 8601 week number of a calendar date (YYYY-MM-DD)
function isoWeek(day: string): { week: number; year: number } {
  const date = new Date(`${day}T00:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return { week, year: date.getUTCFullYear() };
}

/** Oktober 2026 · KW 41/2026 · Q4 2026 · 2026 (startDay: first local day of the period) */
export function periodTitle(kind: PeriodKind, startDay: string): string {
  const [year, month] = startDay.split("-").map(Number);
  switch (kind) {
    case "week": {
      const { week, year: weekYear } = isoWeek(startDay);
      return `KW ${week}/${weekYear}`;
    }
    case "month": return `${MONTHS[month - 1]} ${year}`;
    case "quarter": return `Q${Math.floor((month - 1) / 3) + 1} ${year}`;
    case "year": return String(year);
  }
}

/** 01.10.2026 – 08.10.2026, 10:00 · 01.03.2026 – 31.03.2026 (end exclusive; midnight ends the previous day) */
export function formatRange(start: string, end: string): string {
  const to = new Date(end);
  const last = formatTime(to) === "00:00" ? formatDate(new Date(to.getTime() - 1)) : formatDateTime(to);
  return `${formatDate(start)} – ${last}`;
}
