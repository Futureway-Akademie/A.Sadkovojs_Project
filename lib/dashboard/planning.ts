import "server-only";
import { addDays, berlinToInstant, isDayKey, weekStart, dayKeyOf } from "@/lib/berlin-time";
import type { Employee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { QueueRow } from "./queues";

// Data of the planning page. Occupancy of all technicians comes from technician_busy_intervals
// (only technician, time and kind – no customer, address or absence reason). Details are added only
// for visits the user may read anyway via RLS (own requests for dispatchers, all for managers).
export type Technician = { id: string; name: string };
export type WorkingHours = { technicianId: string; weekday: number; start: string; end: string; validFrom: string | null; validTo: string | null };
export type BusyBlock = {
  technicianId: string;
  start: string;
  end: string;
  kind: "visit" | "absence";
  // Only for readable visits
  requestId: string | null;
  requestNumber: string | null;
};
export type PlanningRequest = Pick<QueueRow, "id" | "request_number" | "company_name" | "city" | "service_kind" | "priority" | "customer_urgency" | "safety_check_required" | "work_status" | "due_at" | "waiting_since" | "version">;

export type PlanningData = {
  week: string;
  days: string[];
  technicians: Technician[];
  workingHours: WorkingHours[];
  busy: BusyBlock[];
  queue: PlanningRequest[];
  selected: PlanningRequest | null;
  selectedPlanned: { id: string; request_number: string } | null;
  error: boolean;
};

export async function loadPlanning(employee: Employee, weekParam: string | undefined, requestParam: string | undefined): Promise<PlanningData> {
  const supabase = await createClient();
  const today = dayKeyOf(new Date());
  const week = weekStart(isDayKey(weekParam) ? weekParam : today);
  const days = Array.from({ length: 7 }, (_, index) => addDays(week, index));
  const rangeStart = berlinToInstant(week, "00:00").toISOString();
  const rangeEnd = berlinToInstant(addDays(week, 7), "00:00").toISOString();

  let queueQuery = supabase
    .from("dispatcher_queue")
    .select("id, request_number, company_name, city, service_kind, priority, customer_urgency, safety_check_required, work_status, due_at, waiting_since, version")
    .eq("queue", "planning")
    .order("priority_rank").order("due_at", { ascending: true, nullsFirst: false }).order("waiting_since").order("id");
  if (employee.role === "dispatcher") queueQuery = queueQuery.eq("dispatcher_id", employee.id);

  const [technicians, hours, busy, visits, queue] = await Promise.all([
    supabase.from("profiles").select("id, display_name").eq("role", "technician").eq("is_active", true).order("display_name"),
    supabase.from("employee_availability").select("employee_id, weekday, local_start, local_end, valid_from, valid_to").eq("kind", "working_hours"),
    supabase.rpc("technician_busy_intervals", { range_start: rangeStart, range_end: rangeEnd }),
    supabase.from("visits").select("id, request_id, technician_id, scheduled_start, scheduled_end").in("status", ["scheduled", "in_progress"]).lt("scheduled_start", rangeEnd).gt("scheduled_end", rangeStart),
    queueQuery,
  ]);

  // Request numbers of readable visits (RLS)
  const readable = visits.data ?? [];
  const requestIds = [...new Set(readable.map((visit) => visit.request_id))];
  const numbers = requestIds.length
    ? (await supabase.from("requests").select("id, request_number").in("id", requestIds)).data ?? []
    : [];
  const numberOf = new Map(numbers.map((request) => [request.id, request.request_number]));
  const readableBySlot = new Map(readable.map((visit) => [`${visit.technician_id}|${new Date(visit.scheduled_start).getTime()}|${new Date(visit.scheduled_end).getTime()}`, visit]));

  const queueRows = (queue.data ?? []) as PlanningRequest[];
  const selected = queueRows.find((row) => row.id === requestParam) ?? null;
  let selectedPlanned: PlanningData["selectedPlanned"] = null;
  if (!selected && requestParam && /^[0-9a-f-]{36}$/i.test(requestParam)) {
    const { data } = await supabase.from("requests").select("id, request_number").eq("id", requestParam).maybeSingle();
    selectedPlanned = data;
  }

  return {
    week,
    days,
    technicians: (technicians.data ?? []).map((tech) => ({ id: tech.id, name: tech.display_name })),
    workingHours: (hours.data ?? []).filter((row) => row.weekday !== null && row.local_start && row.local_end).map((row) => ({
      technicianId: row.employee_id,
      weekday: row.weekday as number,
      start: (row.local_start as string).slice(0, 5),
      end: (row.local_end as string).slice(0, 5),
      validFrom: row.valid_from,
      validTo: row.valid_to,
    })),
    busy: (busy.data ?? []).map((interval) => {
      const visit = interval.busy_kind === "visit"
        ? readableBySlot.get(`${interval.technician_id}|${new Date(interval.starts_at).getTime()}|${new Date(interval.ends_at).getTime()}`)
        : undefined;
      return {
        technicianId: interval.technician_id,
        start: interval.starts_at,
        end: interval.ends_at,
        kind: interval.busy_kind === "absence" ? "absence" : "visit",
        requestId: visit?.request_id ?? null,
        requestNumber: visit ? numberOf.get(visit.request_id) ?? null : null,
      };
    }),
    queue: queueRows,
    selected,
    selectedPlanned,
    error: Boolean(technicians.error || hours.error || busy.error || queue.error),
  };
}
