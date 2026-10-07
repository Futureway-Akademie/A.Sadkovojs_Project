"use server";

import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { databaseErrorMessage, formError, formSuccess, formValues, type FormState } from "@/lib/forms";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

// Review actions of the request page (task-5-2). Every action calls a controlled database operation
// (phase 2) with the user's rights; role, assignment, state transition and expected_version are checked there.
// No action sends e-mails: messages end as draft or queue entry; only the integration confirms sending.
type Enums = Database["public"]["Enums"];
const STAFF = ["dispatcher", "manager", "admin"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIORITIES: readonly string[] = ["low", "normal", "high", "critical"];
const SERVICE_KINDS: readonly string[] = ["inspection", "scheduled_maintenance", "diagnosis_repair"];
const MESSAGE_KINDS: readonly string[] = ["clarification", "other"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Context = { values: Record<string, string>; id: string; version: number };

// Common input: request id and the version the user saw
function context(formData: FormData): Context | null {
  const values = formValues(formData);
  const version = Number.parseInt(values.version ?? "", 10);
  if (!UUID.test(values.request_id ?? "") || !Number.isInteger(version)) return null;
  return { values, id: values.request_id, version };
}

async function run(values: Record<string, string>, success: string, call: () => PromiseLike<{ error: { code?: string; message?: string } | null }>): Promise<FormState> {
  const { error } = await call();
  if (error) return formError(databaseErrorMessage(error), values);
  refresh();
  return formSuccess(success, values);
}

const invalid = (values: Record<string, string>) => formError("Ungültige Anfrage. Bitte die Seite neu laden.", values);

export async function completeIntake(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const input = context(formData);
  if (!input) return invalid(formValues(formData));
  const { values } = input;
  if (!PRIORITIES.includes(values.priority ?? "")) return formError("Bitte die Priorität festlegen.", values, { priority: "Pflichtangabe für den Abschluss." });
  const supabase = await createClient();
  return run(values, "Erstbearbeitung abgeschlossen. Die Anfrage steht jetzt zur Einsatzplanung bereit.", () =>
    supabase.rpc("complete_intake", { request_id: input.id, expected_version: input.version, priority: values.priority as Enums["request_priority"], note: values.note?.trim() || undefined }));
}

export async function correctAnalysis(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const input = context(formData);
  if (!input) return invalid(formValues(formData));
  const { values } = input;
  const fieldErrors: Record<string, string> = {};
  const priority = values.priority && values.priority !== values.current_priority ? values.priority : "";
  const serviceKind = values.service_kind && values.service_kind !== values.current_service_kind ? values.service_kind : "";
  if (priority && !PRIORITIES.includes(priority)) fieldErrors.priority = "Ungültige Priorität.";
  if (serviceKind && !SERVICE_KINDS.includes(serviceKind)) fieldErrors.service_kind = "Ungültige Leistungsart.";
  if (!priority && !serviceKind) fieldErrors.priority = "Priorität oder Leistungsart ändern.";
  if (!values.reason?.trim()) fieldErrors.reason = "Bitte den Grund der Korrektur angeben.";
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, fieldErrors);
  const runId = UUID.test(values.automation_run_id ?? "") ? values.automation_run_id : undefined;
  const supabase = await createClient();
  return run(values, "Korrektur gespeichert.", () =>
    supabase.rpc("correct_analysis", {
      request_id: input.id,
      expected_version: input.version,
      reason: values.reason.trim(),
      priority: (priority || undefined) as Enums["request_priority"] | undefined,
      service_kind: (serviceKind || undefined) as Enums["service_kind"] | undefined,
      automation_run_id: runId,
    }));
}

export async function markAwaitingCustomer(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const input = context(formData);
  if (!input) return invalid(formValues(formData));
  const supabase = await createClient();
  return run(input.values, "Status „Wartet auf Kunde“ gesetzt.", () =>
    supabase.rpc("mark_awaiting_customer", { request_id: input.id, expected_version: input.version, note: input.values.note?.trim() || undefined }));
}

export async function rejectRequest(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const input = context(formData);
  if (!input) return invalid(formValues(formData));
  const { values } = input;
  if (!values.reason?.trim()) return formError("Bitte den Ablehnungsgrund angeben.", values, { reason: "Pflichtangabe." });
  const supabase = await createClient();
  return run(values, "Anfrage abgelehnt.", () =>
    supabase.rpc("reject_request", { request_id: input.id, expected_version: input.version, reason: values.reason.trim() }));
}

function emailErrors(values: Record<string, string>): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  if (!EMAIL.test(values.to_address?.trim() ?? "")) fieldErrors.to_address = "Bitte eine gültige E-Mail-Adresse angeben.";
  if (!values.subject?.trim()) fieldErrors.subject = "Bitte einen Betreff angeben.";
  if (!values.body_text?.trim()) fieldErrors.body_text = "Bitte einen Text angeben.";
  return fieldErrors;
}

export async function createDraft(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const input = context(formData);
  if (!input) return invalid(formValues(formData));
  const { values } = input;
  const fieldErrors = emailErrors(values);
  if (!MESSAGE_KINDS.includes(values.kind ?? "")) fieldErrors.kind = "Bitte die Art wählen.";
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, fieldErrors);
  const supabase = await createClient();
  return run(values, "Entwurf gespeichert (nicht versendet).", () =>
    supabase.rpc("create_message_draft", {
      request_id: input.id,
      expected_version: input.version,
      kind: values.kind as Enums["message_kind"],
      to_address: values.to_address.trim(),
      subject: values.subject.trim(),
      body_text: values.body_text,
    }));
}

export async function updateDraft(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const input = context(formData);
  if (!input || !UUID.test(input.values.message_id ?? "")) return invalid(formValues(formData));
  const { values } = input;
  const fieldErrors = emailErrors(values);
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, fieldErrors);
  const supabase = await createClient();
  return run(values, "Entwurf aktualisiert (nicht versendet).", () =>
    supabase.rpc("update_message_draft", {
      message_id: values.message_id,
      expected_version: input.version,
      to_address: values.to_address.trim(),
      subject: values.subject.trim(),
      body_text: values.body_text,
    }));
}

export async function queueDraft(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const input = context(formData);
  if (!input || !UUID.test(input.values.message_id ?? "")) return invalid(formValues(formData));
  const supabase = await createClient();
  return run(input.values, "In die Warteschlange gestellt – noch nicht versendet.", () =>
    supabase.rpc("queue_message", { message_id: input.values.message_id, expected_version: input.version }));
}
