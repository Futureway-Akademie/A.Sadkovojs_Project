import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import type { EmployeeRole } from "@/lib/auth/roles";

// Reads for the request list and the request page. All queries run with the signed-in user's rights,
// so RLS decides which requests, messages, events and documents are returned.
type Tables = Database["public"]["Tables"];
type Enums = Database["public"]["Enums"];
export type RequestRow = Tables["requests"]["Row"];

export const PAGE_SIZE = 25;

export type RequestFilters = {
  q: string;
  intake: Enums["intake_status"] | "";
  work: Enums["work_status"] | "";
  priority: Enums["request_priority"] | "";
  page: number;
};

const INTAKE: readonly string[] = ["new", "analyzing", "needs_review", "awaiting_customer", "processed", "rejected", "cancelled"];
const WORK: readonly string[] = ["not_planned", "scheduled", "in_progress", "waiting_parts", "completed", "cancelled"];
const PRIORITY: readonly string[] = ["low", "normal", "high", "critical"];

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

// Unknown filter values are ignored instead of producing an error
export function parseRequestFilters(params: Record<string, string | string[] | undefined>): RequestFilters {
  const intake = single(params.erstbearbeitung);
  const work = single(params.arbeit);
  const priority = single(params.prioritaet);
  const page = Number.parseInt(single(params.seite), 10);
  return {
    q: single(params.suche).slice(0, 100),
    intake: INTAKE.includes(intake) ? (intake as Enums["intake_status"]) : "",
    work: WORK.includes(work) ? (work as Enums["work_status"]) : "",
    priority: PRIORITY.includes(priority) ? (priority as Enums["request_priority"]) : "",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export function filterQuery(filters: RequestFilters, overrides: Partial<RequestFilters> = {}): string {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (merged.q) params.set("suche", merged.q);
  if (merged.intake) params.set("erstbearbeitung", merged.intake);
  if (merged.work) params.set("arbeit", merged.work);
  if (merged.priority) params.set("prioritaet", merged.priority);
  if (merged.page > 1) params.set("seite", String(merged.page));
  const query = params.toString();
  return query ? `?${query}` : "";
}

const LIST_COLUMNS = "id, request_number, company_name, city, service_kind, equipment_kind, intake_status, work_status, priority, created_at, dispatcher_id, technician_id, is_demo, safety_risk";
export type RequestListItem = Pick<RequestRow, "id" | "request_number" | "company_name" | "city" | "service_kind" | "equipment_kind" | "intake_status" | "work_status" | "priority" | "created_at" | "dispatcher_id" | "technician_id" | "is_demo" | "safety_risk">;

export async function listRequests(filters: RequestFilters): Promise<{ rows: RequestListItem[]; total: number; error: boolean }> {
  const supabase = await createClient();
  const from = (filters.page - 1) * PAGE_SIZE;
  let query = supabase.from("requests").select(LIST_COLUMNS, { count: "exact" }).order("created_at", { ascending: false }).order("id").range(from, from + PAGE_SIZE - 1);
  if (filters.intake) query = query.eq("intake_status", filters.intake);
  if (filters.work) query = query.eq("work_status", filters.work);
  if (filters.priority) query = query.eq("priority", filters.priority);
  if (filters.q) {
    // Characters with meaning in PostgREST filter syntax or LIKE patterns are removed
    const term = filters.q.replace(/[,()*%_\\:"']/g, " ").replace(/\s+/g, " ").trim();
    if (term) query = query.or(["request_number", "company_name", "contact_name", "city"].map((column) => `${column}.ilike.*${term}*`).join(","));
  }
  const { data, count, error } = await query;
  // A page beyond the end (e.g. after narrowing a filter) is answered with 416 by PostgREST
  if (error && error.code !== "PGRST103") return { rows: [], total: 0, error: true };
  return { rows: data ?? [], total: count ?? 0, error: false };
}

// Names of all employees for display (profiles are readable for every active employee)
export const getEmployeeNames = cache(async (): Promise<Map<string, string>> => {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, display_name");
  return new Map((data ?? []).map((profile) => [profile.id, profile.display_name]));
});

// Sections of the request page per role. Messages and automation runs are not readable for
// technicians anyway (RLS); the page neither queries nor shows them.
export const REQUEST_SECTIONS = [
  { id: "zusammenfassung", label: "Zusammenfassung", roles: ["admin", "manager", "dispatcher", "technician"] },
  { id: "kontakt", label: "Kontakt", roles: ["admin", "manager", "dispatcher", "technician"] },
  { id: "anlage", label: "Anlage", roles: ["admin", "manager", "dispatcher", "technician"] },
  { id: "erstbearbeitung", label: "Erstbearbeitung", roles: ["admin", "manager", "dispatcher"] },
  { id: "korrespondenz", label: "Korrespondenz", roles: ["admin", "manager", "dispatcher"] },
  { id: "einsaetze", label: "Einsätze", roles: ["admin", "manager", "dispatcher", "technician"] },
  { id: "arbeit", label: "Arbeit", roles: ["admin", "manager", "dispatcher", "technician"] },
  { id: "dokumente", label: "Dokumente", roles: ["admin", "manager", "dispatcher", "technician"] },
  { id: "rechnung", label: "Rechnung", roles: ["admin", "manager", "dispatcher", "technician"] },
  { id: "verlauf", label: "Verlauf", roles: ["admin", "manager", "dispatcher", "technician"] },
] as const satisfies ReadonlyArray<{ id: string; label: string; roles: readonly EmployeeRole[] }>;

export type SectionId = (typeof REQUEST_SECTIONS)[number]["id"];

export function sectionsFor(role: EmployeeRole) {
  return REQUEST_SECTIONS.filter((section) => (section.roles as readonly EmployeeRole[]).includes(role));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RequestDetail = {
  request: RequestRow;
  messages: Tables["messages"]["Row"][] | null;
  automationRuns: Tables["automation_runs"]["Row"][] | null;
  visits: Tables["visits"]["Row"][];
  workEntries: Tables["work_entries"]["Row"][];
  attachments: Tables["attachments"]["Row"][];
  invoice: Tables["invoices"]["Row"] | null;
  invoiceItems: Tables["invoice_items"]["Row"][];
  events: Tables["request_events"]["Row"][];
  failed: string[];
};

// null = not found or no access (deliberately indistinguishable). Memoized per request (metadata and page).
export const getRequestDetail = cache(async (id: string, role: EmployeeRole): Promise<RequestDetail | null> => {
  if (!UUID.test(id)) return null;
  const supabase = await createClient();
  const { data: request, error } = await supabase.from("requests").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("Anfrage konnte nicht geladen werden.");
  if (!request) return null;

  const staff = role !== "technician";
  const [messages, automationRuns, visits, workEntries, attachments, invoice, events] = await Promise.all([
    staff ? supabase.from("messages").select("*").eq("request_id", id).order("created_at") : null,
    staff ? supabase.from("automation_runs").select("*").eq("request_id", id).order("started_at") : null,
    supabase.from("visits").select("*").eq("request_id", id).order("scheduled_start"),
    supabase.from("work_entries").select("*").eq("request_id", id).order("created_at"),
    supabase.from("attachments").select("*").eq("request_id", id).order("created_at"),
    supabase.from("invoices").select("*").eq("request_id", id).maybeSingle(),
    supabase.from("request_events").select("*").eq("request_id", id).order("occurred_at", { ascending: false }).order("seq", { ascending: false }),
  ]);
  const invoiceItems = invoice?.data
    ? await supabase.from("invoice_items").select("*").eq("invoice_id", invoice.data.id).order("position")
    : null;

  // Partial failures are shown per section instead of failing the whole page
  const failed: string[] = [];
  const pick = <T,>(name: string, result: { data: T | null; error: unknown } | null, fallback: T): T => {
    if (!result) return fallback;
    if (result.error) failed.push(name);
    return result.data ?? fallback;
  };
  return {
    request,
    messages: messages ? pick("korrespondenz", messages, []) : null,
    automationRuns: automationRuns ? pick("erstbearbeitung", automationRuns, []) : null,
    visits: pick("einsaetze", visits, []),
    workEntries: pick("arbeit", workEntries, []),
    attachments: pick("dokumente", attachments, []),
    invoice: pick("rechnung", invoice, null),
    invoiceItems: pick("rechnung", invoiceItems, []),
    events: pick("verlauf", events, []),
    failed,
  };
});
