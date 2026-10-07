"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { areasFor, type EmployeeRole } from "@/lib/auth/roles";

export function DashboardNav({ role }: { role: EmployeeRole }) {
  const pathname = usePathname();
  return (
    <nav className="dash-nav" aria-label="Dashboard-Navigation">
      <ul>
        {areasFor(role).map((area) => {
          const active = pathname === area.href || pathname.startsWith(`${area.href}/`);
          return (
            <li key={area.href}>
              <Link href={area.href} aria-current={active ? "page" : undefined}>{area.label}</Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
