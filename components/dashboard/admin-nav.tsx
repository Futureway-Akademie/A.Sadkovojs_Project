import Link from "next/link";

// Sub-navigation of the administration area (task-8-1)
const ITEMS = [
  { key: "mitarbeitende", href: "/dashboard/verwaltung", label: "Mitarbeitende" },
  { key: "arbeitszeiten", href: "/dashboard/verwaltung/arbeitszeiten", label: "Arbeitszeiten" },
  { key: "tarife", href: "/dashboard/verwaltung/tarife", label: "Tarife" },
  { key: "einstellungen", href: "/dashboard/verwaltung/einstellungen", label: "Einstellungen" },
] as const;

export function AdminNav({ current }: { current: (typeof ITEMS)[number]["key"] }) {
  return (
    <nav className="section-nav" aria-label="Verwaltung">
      <ul>
        {ITEMS.map((item) => (
          <li key={item.key}><Link href={item.href} aria-current={item.key === current ? "page" : undefined}>{item.label}</Link></li>
        ))}
      </ul>
    </nav>
  );
}
