import Link from "next/link";
import { formatNumber } from "@/lib/format";

// Lists with deactivated entries (employees, rates) show only active ones by default; "Alle" via ?status=alle.
// Deactivated entries are kept for history, so they stay reachable but out of the way.
export const ACTIVE_FILTER_PARAM = "status";

export function showsInactive(params: Record<string, string | string[] | undefined>): boolean {
  const value = params[ACTIVE_FILTER_PARAM];
  return (Array.isArray(value) ? value[0] : value) === "alle";
}

export function ActiveFilter({ basePath, all, active, total, label = "Anzeige" }: {
  basePath: string;
  all: boolean;
  active: number;
  total: number;
  label?: string;
}) {
  const views = [
    { key: "aktiv", href: basePath, label: "Aktive", count: active, current: !all },
    { key: "alle", href: `${basePath}?${ACTIVE_FILTER_PARAM}=alle`, label: "Alle", count: total, current: all },
  ];
  return (
    <nav className="rw-views" aria-label={label}>
      {views.map((view) => (
        <Link key={view.key} className="rw-view" href={view.href} aria-current={view.current ? "page" : undefined} scroll={false}>
          {view.label}<span className="rw-view__count mono">{formatNumber(view.count)}</span>
        </Link>
      ))}
    </nav>
  );
}
