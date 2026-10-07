"use server";

import { refresh } from "next/cache";
import { berlinToInstant, isDayKey, isTime } from "@/lib/berlin-time";
import { requireRole } from "@/lib/auth/session";
import { formatTimeRange } from "@/lib/format";
import { databaseErrorMessage, formError, formSuccess, formValues, type FormState } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Books a visit via schedule_visit (task-2-2). The database checks role, assignment, state,
// working hours, absences, the past and overlaps (exclusion constraint, RW410) – also for concurrent bookings.
export async function scheduleVisit(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["dispatcher", "manager"]);
  const values = formValues(formData);
  const version = Number.parseInt(values.version ?? "", 10);
  if (!UUID.test(values.request_id ?? "") || !Number.isInteger(version)) return formError("Ungültige Anfrage. Bitte die Seite neu laden.", values);

  const fieldErrors: Record<string, string> = {};
  if (!UUID.test(values.technician_id ?? "")) fieldErrors.technician_id = "Bitte einen Techniker wählen.";
  if (!isDayKey(values.date)) fieldErrors.date = "Bitte ein Datum wählen.";
  if (!isTime(values.start)) fieldErrors.start = "Bitte eine Beginnzeit wählen.";
  if (!isTime(values.end)) fieldErrors.end = "Bitte eine Endzeit wählen.";
  if (!fieldErrors.start && !fieldErrors.end && values.end <= values.start) fieldErrors.end = "Ende muss nach dem Beginn liegen.";
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, fieldErrors);

  const start = berlinToInstant(values.date, values.start);
  const end = berlinToInstant(values.date, values.end);
  const supabase = await createClient();
  const { error } = await supabase.rpc("schedule_visit", {
    request_id: values.request_id,
    expected_version: version,
    technician_id: values.technician_id,
    scheduled_start: start.toISOString(),
    scheduled_end: end.toISOString(),
  });
  if (error) {
    const hint = error.code === "RW410" ? " Bitte im Kalender einen freien Zeitraum wählen." : "";
    return formError(`${databaseErrorMessage(error)}${hint}`, values, error.code === "RW410" ? { start: "Zeitraum belegt." } : {});
  }
  refresh();
  return formSuccess(`Einsatz geplant: ${formatTimeRange(start, end)}.`, values);
}
