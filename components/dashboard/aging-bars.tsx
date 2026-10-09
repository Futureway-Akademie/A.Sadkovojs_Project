import { formatCurrency, formatNumber } from "@/lib/format";
import type { overdueAging } from "@/lib/display-status";

// Overdue receivables by age (Rechnungen and the overview tile "Überfällige Forderungen")
export function AgingBars({ buckets }: { buckets: ReturnType<typeof overdueAging> }) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.total));
  return (
    <ul className="rw-bars rw-bars--aging">
      {buckets.map((bucket) => (
        <li key={bucket.key}>
          <span className="rw-bars__row">
            <span className="rw-bars__label">{bucket.label} <span className="rw-sub">{formatNumber(bucket.count)} {bucket.count === 1 ? "Rechnung" : "Rechnungen"}</span></span>
            <span className="mono rw-bars__value">{formatCurrency(bucket.total)}</span>
            <span className="rw-bars__track rw-bars__track--warn" aria-hidden="true"><span style={{ width: `${(bucket.total / max) * 100}%` }} /></span>
          </span>
        </li>
      ))}
    </ul>
  );
}
