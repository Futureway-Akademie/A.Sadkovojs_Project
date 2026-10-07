import { redirect } from "next/navigation";
import { startPageFor } from "@/lib/auth/roles";
import { requireEmployee } from "@/lib/auth/session";

// /dashboard has no content of its own and leads to the start page of the role.
export default async function DashboardIndex() {
  const employee = await requireEmployee();
  redirect(startPageFor(employee.role));
}
