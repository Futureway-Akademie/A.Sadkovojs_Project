import "server-only";
import type { EmployeeRole } from "@/lib/auth/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

// Data of the administration area (task-8-1). Profiles, rates, availability and settings are read with the
// admin's own rights (RLS). Login data (e-mail, last sign-in) only exists in Supabase Auth and is read with the
// secret key; callers have checked the admin role before.
type Tables = Database["public"]["Tables"];
export type Profile = Tables["profiles"]["Row"];
export type Availability = Tables["employee_availability"]["Row"];
export type ServiceRate = Tables["service_rates"]["Row"];
export type Settings = Tables["settings"]["Row"];
export type Assignment = Database["public"]["Functions"]["admin_employee_assignments"]["Returns"][number];

export type EmployeeListItem = Profile & { email: string | null; lastSignInAt: string | null; workingHours: Availability[] };

type Login = { email: string | null; lastSignInAt: string | null };

async function loginData(): Promise<Map<string, Login>> {
  const admin = createAdminClient();
  const logins = new Map<string, Login>();
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error("Anmeldedaten konnten nicht geladen werden.");
    for (const user of data.users) logins.set(user.id, { email: user.email ?? null, lastSignInAt: user.last_sign_in_at ?? null });
    if (data.users.length < 200) return logins;
  }
}

const ROLE_ORDER: Record<EmployeeRole, number> = { admin: 0, manager: 1, dispatcher: 2, technician: 3 };

export async function listEmployees(): Promise<{ rows: EmployeeListItem[]; error: boolean }> {
  const supabase = await createClient();
  const [profiles, hours, logins] = await Promise.all([
    supabase.from("profiles").select("*"),
    supabase.from("employee_availability").select("*").eq("kind", "working_hours"),
    loginData().catch(() => null),
  ]);
  if (profiles.error || hours.error) return { rows: [], error: true };
  const rows = profiles.data
    .map((profile) => ({
      ...profile,
      email: logins?.get(profile.id)?.email ?? null,
      lastSignInAt: logins?.get(profile.id)?.lastSignInAt ?? null,
      workingHours: hours.data.filter((row) => row.employee_id === profile.id),
    }))
    .sort((a, b) => Number(b.is_active) - Number(a.is_active) || ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.display_name.localeCompare(b.display_name, "de"));
  return { rows, error: !logins };
}

export type EmployeeDetail = {
  profile: Profile;
  login: Login | null;
  workingHours: Availability[];
  absences: Availability[];
  assignments: Assignment[];
  replacements: Array<Pick<Profile, "id" | "display_name">>;
};

export async function getEmployee(id: string): Promise<EmployeeDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
  if (!profile) return null;

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [availability, assignments, replacements, login] = await Promise.all([
    supabase.from("employee_availability").select("*").eq("employee_id", id).or(`kind.eq.working_hours,ends_at.gte.${since}`).order("weekday").order("starts_at"),
    supabase.rpc("admin_employee_assignments", { employee_id: id }),
    supabase.from("profiles").select("id, display_name").eq("role", profile.role).eq("is_active", true).neq("id", id).order("display_name"),
    createAdminClient().auth.admin.getUserById(id).then(({ data, error }) => (error || !data.user ? null : { email: data.user.email ?? null, lastSignInAt: data.user.last_sign_in_at ?? null })),
  ]);
  if (availability.error || assignments.error || replacements.error) throw new Error("Mitarbeiterdaten konnten nicht geladen werden.");
  return {
    profile,
    login,
    workingHours: availability.data.filter((row) => row.kind === "working_hours"),
    absences: availability.data.filter((row) => row.kind === "absence"),
    assignments: assignments.data ?? [],
    replacements: replacements.data,
  };
}

// Technicians with their weekly hours and absences from today on (overview "Arbeitszeiten")
export async function listAvailability(): Promise<{ technicians: Array<Pick<Profile, "id" | "display_name" | "is_active">>; rows: Availability[] } | null> {
  const supabase = await createClient();
  const [technicians, rows] = await Promise.all([
    supabase.from("profiles").select("id, display_name, is_active").eq("role", "technician").eq("is_active", true).order("display_name"),
    supabase.from("employee_availability").select("*").or(`kind.eq.working_hours,ends_at.gte.${new Date().toISOString()}`).order("weekday").order("starts_at"),
  ]);
  if (technicians.error || rows.error) return null;
  return { technicians: technicians.data, rows: rows.data };
}

export async function listRates(): Promise<ServiceRate[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("service_rates").select("*").order("is_active", { ascending: false }).order("service_kind").order("code");
  return error ? null : data;
}

export async function getSettings(): Promise<(Settings & { updatedByName: string | null }) | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").select("*").eq("id", 1).maybeSingle();
  if (error || !data) return null;
  let updatedByName: string | null = null;
  if (data.updated_by) {
    const { data: author } = await supabase.from("profiles").select("display_name").eq("id", data.updated_by).maybeSingle();
    updatedByName = author?.display_name ?? null;
  }
  return { ...data, updatedByName };
}
