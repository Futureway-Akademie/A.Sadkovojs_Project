import type { Metadata } from "next";
import { AreaPlaceholder } from "@/components/dashboard/area-placeholder";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Kalender" };

export default async function Page() {
  await requireRole(rolesFor("/dashboard/kalender"));
  return <AreaPlaceholder title="Kalender" body="Der eigene Wochenkalender folgt in diesem Bereich." />;
}
