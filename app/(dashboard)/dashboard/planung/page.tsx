import type { Metadata } from "next";
import { AreaPlaceholder } from "@/components/dashboard/area-placeholder";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Einsatzplanung" };

export default async function Page() {
  await requireRole(rolesFor("/dashboard/planung"));
  return <AreaPlaceholder title="Einsatzplanung" body="Kalender mit belegten Technikerzeiten und Terminvergabe folgen in diesem Bereich." />;
}
