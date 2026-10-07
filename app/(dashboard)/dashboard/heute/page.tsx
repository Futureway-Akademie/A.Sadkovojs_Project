import type { Metadata } from "next";
import { AreaPlaceholder } from "@/components/dashboard/area-placeholder";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Mein Tag" };

export default async function Page() {
  await requireRole(rolesFor("/dashboard/heute"));
  return <AreaPlaceholder title="Mein Tag" body="Nächster Einsatz und heutige Arbeit folgen in diesem Bereich." />;
}
