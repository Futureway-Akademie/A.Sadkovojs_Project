import type { Metadata } from "next";
import { AreaPlaceholder } from "@/components/dashboard/area-placeholder";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Verwaltung" };

export default async function Page() {
  await requireRole(rolesFor("/dashboard/verwaltung"));
  return <AreaPlaceholder title="Verwaltung" body="Mitarbeitende, Rollen, Tarife, Arbeitszeiten und Einstellungen folgen in diesem Bereich." />;
}
