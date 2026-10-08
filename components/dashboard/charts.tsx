"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { formatMinutes, formatNumber, formatPercent, formatCurrency } from "@/lib/format";

// Charts of the analysis page (task-7-3), Recharts 3 (evaluation in docs/decisions.md).
// Marks follow the dataviz rules: 2px lines, bars <= 24px with 4px rounded data end, 2px gap between
// bars, hairline grid, crosshair tooltip on lines, value first in the tooltip. Colors come from
// lib/chart-colors.ts (validated palette); text always uses text colors, never the series color.
export type ChartSeries = { key: string; label: string; color: string };
export type ChartFormat = "count" | "percent" | "eur" | "hours";

const AXIS = { fontSize: 12, fill: "#526574" };
const GRID = "#D5DCE2";
const SURFACE = "#FCFBF7";

function formatValue(format: ChartFormat, value: unknown): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "–";
  const number = Number(value);
  switch (format) {
    case "count": return formatNumber(number);
    case "percent": return formatPercent(number);
    case "eur": return formatCurrency(number);
    case "hours": return `${formatNumber(number, 1)} h`;
  }
}

function axisValue(format: ChartFormat, value: number): string {
  if (format === "eur") return value >= 1000 ? `${formatNumber(value / 1000, value % 1000 === 0 ? 0 : 1)} T€` : `${formatNumber(value)} €`;
  if (format === "percent") return `${formatNumber(value)} %`;
  return formatNumber(value);
}

type TooltipProps = TooltipContentProps<number, string> & { series: ChartSeries[]; format: ChartFormat; variant?: "savings" | "share" };

function ChartTooltip({ active, payload, label, series, format, variant }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Record<string, unknown>;
  return (
    <div className="chart-tooltip" role="status">
      <p className="chart-tooltip__label">{String(label)}</p>
      <ul>
        {series.map((entry) => (
          <li key={entry.key}>
            <span className="chart-tooltip__key" style={{ background: entry.color }} aria-hidden="true" />
            <strong>{formatValue(format, row[entry.key])}</strong>
            <span>{entry.label}</span>
          </li>
        ))}
      </ul>
      {variant === "savings" && (
        <p className="chart-tooltip__note" data-savings-detail>
          {formatMinutes(Number(row.savedMinutes ?? 0))} = {formatNumber(Number(row.savedRequests ?? 0))} Anfragen × Basiswert {row.baseline === null || row.baseline === undefined ? "–" : formatMinutes(Number(row.baseline))}
        </p>
      )}
      {variant === "share" && (
        <p className="chart-tooltip__note">{formatNumber(Number(row.automatic))} von {formatNumber(Number(row.total))} automatisch</p>
      )}
    </div>
  );
}

export function TimeChart({
  kind,
  data,
  xKey,
  series,
  format,
  variant,
  height = 260,
  label,
}: {
  kind: "line" | "bar";
  data: Array<Record<string, string | number | null>>;
  xKey: string;
  series: ChartSeries[];
  format: ChartFormat;
  variant?: "savings" | "share";
  height?: number;
  label: string;
}) {
  const common = {
    data,
    margin: { top: 8, right: 12, bottom: 4, left: 4 },
    accessibilityLayer: true,
  };
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
      <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={12} interval="preserveStartEnd" />
      <YAxis tick={AXIS} tickLine={false} axisLine={false} width={52} allowDecimals={format !== "count"} tickFormatter={(value: number) => axisValue(format, value)} />
      <Tooltip
        content={(props) => <ChartTooltip {...(props as TooltipContentProps<number, string>)} series={series} format={format} variant={variant} />}
        cursor={kind === "line" ? { stroke: "#7A8B99", strokeWidth: 1 } : { fill: "#E5EAEE", fillOpacity: 0.6 }}
        isAnimationActive={false}
      />
    </>
  );
  return (
    <div className="chart" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height={height}>
        {kind === "line" ? (
          <LineChart {...common}>
            {axes}
            {series.map((entry) => (
              <Line key={entry.key} type="linear" dataKey={entry.key} name={entry.label} stroke={entry.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" dot={false} activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
            ))}
          </LineChart>
        ) : (
          <BarChart {...common} barGap={2} barCategoryGap="20%">
            {axes}
            {series.map((entry) => (
              <Bar key={entry.key} dataKey={entry.key} name={entry.label} fill={entry.color} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
