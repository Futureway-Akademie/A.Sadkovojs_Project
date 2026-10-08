import Link from "next/link";
import { formatRange, neighbourAnchors, PERIOD_OPTIONS, periodQuery, periodTitle, type PeriodParams } from "@/lib/analytics";

// Period selection of the manager pages (task-7-2/7-3): kind, previous/next period, comparison span
export function PeriodBar({ basePath, period, window }: {
  basePath: string;
  period: PeriodParams;
  window: { current_start: string; current_end: string; previous_start: string; previous_end: string; is_complete: boolean; startDay: string; endDay: string };
}) {
  const { previous, next } = neighbourAnchors(window.startDay, window.endDay);
  return (
    <nav className="period-bar" aria-label="Zeitraum">
      <ul className="period-bar__kinds">
        {PERIOD_OPTIONS.map((option) => (
          <li key={option.param}>
            <Link href={`${basePath}${periodQuery(option.param, period.anchor)}`} aria-current={option.kind === period.kind ? "page" : undefined}>{option.label}</Link>
          </li>
        ))}
      </ul>
      <div className="period-bar__step">
        <Link href={`${basePath}${periodQuery(period.param, previous)}`} aria-label="Vorheriger Zeitraum">←</Link>
        <p>
          <strong>{periodTitle(period.kind, window.startDay)}</strong>
          <span>{formatRange(window.current_start, window.current_end)}{window.is_complete ? "" : " (laufend)"}</span>
          <span>Vergleich: {formatRange(window.previous_start, window.previous_end)}</span>
        </p>
        {window.is_complete ? <Link href={`${basePath}${periodQuery(period.param, next)}`} aria-label="Nächster Zeitraum">→</Link> : <span aria-hidden="true" />}
      </div>
      {period.anchor && <Link className="period-bar__today" href={`${basePath}${periodQuery(period.param, null)}`}>Aktueller Zeitraum</Link>}
    </nav>
  );
}
