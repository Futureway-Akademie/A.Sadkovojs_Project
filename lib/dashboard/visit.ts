import "server-only";
import type { Employee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

// Visit workspace (task-6-2). Reads with the user's rights; technicians only get their own visits here,
// although RLS lets them read other technicians' visits on their current requests.
type Tables = Database["public"]["Tables"];
export type VisitWorkspace = {
  visit: Tables["visits"]["Row"];
  request: Tables["requests"]["Row"];
  entries: Tables["work_entries"]["Row"][];
  photos: Tables["attachments"]["Row"][];
  rates: Pick<Tables["service_rates"]["Row"], "id" | "display_name" | "billing_model" | "unit_price">[];
  invoiceIssued: boolean;
  elapsedMinutes: number | null;
  // Proposal for the actual work time: elapsed time, or the planned duration if the visit was started long ago
  suggestedMinutes: number | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadVisitWorkspace(visitId: string, employee: Employee): Promise<VisitWorkspace | null> {
  if (!UUID.test(visitId)) return null;
  const supabase = await createClient();
  const { data: visit } = await supabase.from("visits").select("*").eq("id", visitId).maybeSingle();
  if (!visit || (employee.role === "technician" && visit.technician_id !== employee.id)) return null;

  const { data: request } = await supabase.from("requests").select("*").eq("id", visit.request_id).maybeSingle();
  if (!request) return null;

  const [entries, photos, rates, invoice] = await Promise.all([
    supabase.from("work_entries").select("*").eq("request_id", request.id).order("created_at"),
    supabase.from("attachments").select("*").eq("visit_id", visit.id).in("mime_type", ["image/jpeg", "image/png"]).order("created_at"),
    supabase.from("service_rates").select("id, display_name, billing_model, unit_price").eq("service_kind", request.service_kind).eq("is_active", true),
    supabase.from("invoices").select("status").eq("request_id", request.id).maybeSingle(),
  ]);
  const elapsedMinutes = visit.actual_start ? Math.max(0, Math.round((Date.now() - new Date(visit.actual_start).getTime()) / 60000)) : null;
  const plannedMinutes = Math.round((new Date(visit.scheduled_end).getTime() - new Date(visit.scheduled_start).getTime()) / 60000);
  const suggestedMinutes = elapsedMinutes === null ? null : elapsedMinutes <= 12 * 60 ? elapsedMinutes : plannedMinutes;

  return {
    visit,
    request,
    entries: entries.data ?? [],
    photos: photos.data ?? [],
    rates: rates.data ?? [],
    invoiceIssued: Boolean(invoice.data && invoice.data.status !== "draft"),
    elapsedMinutes,
    suggestedMinutes,
  };
}
