"use server";

import { formError, formSuccess, formValues, databaseErrorMessage, type FormState } from "@/lib/forms";
import { requireRole } from "@/lib/auth/session";

// Demonstration of the save contract without database writes (component overview only)
export async function saveExample(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const values = formValues(formData);
  const fieldErrors: Record<string, string> = {};
  if (!values.company?.trim()) fieldErrors.company = "Bitte einen Firmennamen eingeben.";
  const hours = Number((values.hours ?? "").replace(",", "."));
  if (!values.hours || !Number.isFinite(hours) || hours <= 0) fieldErrors.hours = "Bitte eine Stundenzahl größer 0 eingeben.";
  if (!values.priority) fieldErrors.priority = "Bitte eine Priorität wählen.";
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, fieldErrors);
  if (values.simulate_conflict === "on") return formError(databaseErrorMessage({ code: "RW409" }), values);
  return formSuccess("Gespeichert (Beispiel, keine Daten geändert)", values);
}
