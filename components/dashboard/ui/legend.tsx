// Chart legend with 12px squares in the series color (specification section 05), no line stubs.
// A dashed series (running period) is marked in the text, not only by the pattern.
export type LegendItem = { label: string; color: string; note?: string };

export function Legend({ items, label = "Legende" }: { items: readonly LegendItem[]; label?: string }) {
  return (
    <ul className="rw-legend" aria-label={label}>
      {items.map((item) => (
        <li key={item.label}>
          <span className="rw-legend__key" style={{ background: item.color }} aria-hidden="true" />
          {item.label}
          {item.note && <span className="rw-legend__note">{item.note}</span>}
        </li>
      ))}
    </ul>
  );
}

// Period of a chart as chip ("24 Monate", "90 Tage")
export function PeriodChip({ children }: { children: string }) {
  return <span className="rw-period-chip mono">{children}</span>;
}
