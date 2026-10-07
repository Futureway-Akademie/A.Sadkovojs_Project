import type { Metadata } from "next";
import { AreaPlaceholder } from "@/components/dashboard/area-placeholder";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Übersicht" };

export default async function Page() {
  await requireRole(rolesFor("/dashboard/uebersicht"));
  return <AreaPlaceholder title="Übersicht" body="Kennzahlen, Aufmerksamkeitsliste, Team und Finanzen folgen in diesem Bereich." />;
}
