import { notFound } from "next/navigation";
import { requireEmployee } from "@/lib/auth/session";

// Unknown dashboard paths: login first, then the dashboard's own 404 page
export default async function UnknownDashboardPage() {
  await requireEmployee();
  notFound();
}
