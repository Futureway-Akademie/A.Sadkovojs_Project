import { statusInfo, type StatusKind } from "@/lib/status";

// Status as text plus color; the text alone is sufficient (also for screen readers and print).
export function StatusBadge({ kind, value }: { kind: StatusKind; value: string | boolean | null | undefined }) {
  const { label, tone } = statusInfo(kind, value === null || value === undefined ? null : String(value));
  return (
    <span className={`status-badge status-badge--${tone}`}>
      <span className="status-badge__dot" aria-hidden="true" />
      {label}
    </span>
  );
}
