"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { databaseErrorMessage, formError, formSuccess, formValues, type FormState } from "@/lib/forms";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

// Visit actions (task-6-2). Each action calls one controlled database operation with the user's rights
// and the request version the user saw; role, own visit, state and billing lock are checked there.
type Enums = Database["public"]["Enums"];
const ACTORS = ["technician", "manager", "admin"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

type Input = { values: Record<string, string>; visitId: string; requestId: string; version: number };

function input(formData: FormData): Input | null {
  const values = formValues(formData);
  const version = Number.parseInt(values.version ?? "", 10);
  if (!UUID.test(values.visit_id ?? "") || !UUID.test(values.request_id ?? "") || !Number.isInteger(version)) return null;
  return { values, visitId: values.visit_id, requestId: values.request_id, version };
}

const invalid = (formData: FormData) => formError("Ungültige Eingabe. Bitte die Seite neu laden.", formValues(formData));

async function run(values: Record<string, string>, success: string, call: () => PromiseLike<{ error: { code?: string; message?: string } | null }>): Promise<FormState> {
  const { error } = await call();
  if (error) return formError(databaseErrorMessage(error), values);
  refresh();
  return formSuccess(success, values);
}

// Decimal input: German "1.234,5" and "1,5" as well as "1.5"
function decimal(value: string | undefined): number | null {
  const text = value?.trim();
  if (!text) return null;
  const number = Number(text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text);
  return Number.isFinite(number) ? number : null;
}

export async function startVisit(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(ACTORS);
  const data = input(formData);
  if (!data) return invalid(formData);
  const supabase = await createClient();
  return run(data.values, "Arbeit gestartet.", () => supabase.rpc("start_visit", { visit_id: data.visitId, expected_version: data.version }));
}

export async function waitForParts(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(ACTORS);
  const data = input(formData);
  if (!data) return invalid(formData);
  if (!data.values.reason?.trim()) return formError("Bitte angeben, auf welche Teile gewartet wird.", data.values, { reason: "Pflichtangabe." });
  const supabase = await createClient();
  return run(data.values, "Einsatz pausiert: wartet auf Teile. Die Anfrage erscheint in der Planung als Folgeeinsatz.", () =>
    supabase.rpc("wait_for_parts", { visit_id: data.visitId, expected_version: data.version, reason: data.values.reason.trim() }));
}

export async function resumeVisit(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(ACTORS);
  const data = input(formData);
  if (!data) return invalid(formData);
  const supabase = await createClient();
  return run(data.values, "Einsatz fortgesetzt.", () => supabase.rpc("resume_visit", { visit_id: data.visitId, expected_version: data.version }));
}

export async function completeVisit(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(ACTORS);
  const data = input(formData);
  if (!data) return invalid(formData);
  const { values } = data;
  const fieldErrors: Record<string, string> = {};
  const minutes = Number.parseInt(values.minutes ?? "", 10);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 24 * 60) fieldErrors.minutes = "Bitte die Arbeitszeit in Minuten angeben (0 bis 1440).";
  if (!values.summary?.trim()) fieldErrors.summary = "Bitte einen kurzen Bericht angeben.";
  const followUp = values.follow_up === "on";
  if (followUp && !values.follow_up_reason?.trim()) fieldErrors.follow_up_reason = "Bitte den Grund für den Folgeeinsatz angeben.";
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, fieldErrors);
  const supabase = await createClient();
  return run(values, followUp ? "Einsatz beendet. Folgeeinsatz angefordert – die Anfrage steht wieder in der Planung." : "Einsatz beendet. Die Anfrage bleibt offen, bis sie abgeschlossen wird.", () =>
    supabase.rpc("complete_visit", {
      visit_id: data.visitId,
      expected_version: data.version,
      actual_work_minutes: minutes,
      summary: values.summary.trim(),
      follow_up_reason: followUp ? values.follow_up_reason.trim() : undefined,
    }));
}

export async function addWorkEntry(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(ACTORS);
  const data = input(formData);
  if (!data) return invalid(formData);
  const { values } = data;
  const kind = values.kind as Enums["work_entry_kind"];
  if (!["labor", "part", "fixed_service"].includes(kind)) return invalid(formData);
  const fieldErrors: Record<string, string> = {};
  const quantity = decimal(values.quantity);
  if (quantity === null || quantity <= 0) fieldErrors.quantity = kind === "labor" ? "Stunden größer 0, z. B. 1,5." : "Menge größer 0.";
  if (!values.description?.trim()) fieldErrors.description = "Bitte eine Beschreibung angeben.";
  const price = kind === "part" ? decimal(values.unit_price) : null;
  if (kind === "part" && (price === null || price < 0)) fieldErrors.unit_price = "Bitte den Preis je Stück (netto) angeben.";
  const status = kind === "part" ? values.item_status : "performed";
  if (kind === "part" && !["ordered", "used"].includes(status)) fieldErrors.item_status = "Bitte wählen.";
  if ((kind === "labor" || kind === "fixed_service") && !UUID.test(values.service_rate_id ?? "")) return formError("Für diese Leistungsart ist kein passender Tarif aktiv.", values);
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, fieldErrors);
  const supabase = await createClient();
  const label = kind === "part" ? (status === "ordered" ? "Teil als bestellt erfasst." : "Verbautes Teil erfasst.") : kind === "labor" ? "Arbeitszeit erfasst." : "Pauschale erfasst.";
  return run(values, label, () =>
    supabase.rpc("add_work_entry", {
      request_id: data.requestId,
      expected_version: data.version,
      kind,
      description: values.description.trim(),
      quantity: quantity as number,
      item_status: status as Enums["work_item_status"],
      unit_price: price ?? undefined,
      visit_id: data.visitId,
      service_rate_id: kind === "part" ? undefined : values.service_rate_id,
    }));
}

export async function setEntryStatus(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(ACTORS);
  const data = input(formData);
  if (!data || !UUID.test(data.values.entry_id ?? "") || !["used", "cancelled", "performed"].includes(data.values.new_status)) return invalid(formData);
  const supabase = await createClient();
  return run(data.values, data.values.new_status === "cancelled" ? "Position storniert." : "Status aktualisiert.", () =>
    supabase.rpc("set_work_entry_status", { work_entry_id: data.values.entry_id, expected_version: data.version, new_status: data.values.new_status as Enums["work_item_status"] }));
}

// JPEG and PNG are recognised by their first bytes, not by the file name or the browser's type
function imageType(bytes: Uint8Array): { mime: "image/jpeg" | "image/png"; extension: string } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", extension: "jpg" };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mime: "image/png", extension: "png" };
  return null;
}

// Photo upload: the server writes the file to the private bucket (service key, server only), then
// add_visit_photo checks the user's rights and registers it; on any error the file is removed again.
export async function uploadPhoto(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(ACTORS);
  const data = input(formData);
  if (!data) return invalid(formData);
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return formError("Bitte ein Foto auswählen.", data.values, { photo: "Pflichtangabe." });
  if (file.size > MAX_PHOTO_BYTES) return formError("Das Foto ist größer als 10 MB.", data.values, { photo: "Höchstens 10 MB." });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = imageType(bytes);
  if (!type) return formError("Nur JPEG- oder PNG-Fotos sind erlaubt.", data.values, { photo: "JPEG oder PNG." });

  // Cheap pre-check with the user's rights before anything is written to storage
  const supabase = await createClient();
  const { data: visit } = await supabase.from("visits").select("id, request_id").eq("id", data.visitId).eq("request_id", data.requestId).maybeSingle();
  if (!visit) return formError("Einsatz nicht gefunden oder kein Zugriff.", data.values);

  const admin = createAdminClient();
  const path = `visits/${data.requestId}/${data.visitId}/${randomUUID()}.${type.extension}`;
  const upload = await admin.storage.from("dashboard").upload(path, bytes, { contentType: type.mime, upsert: false });
  if (upload.error) return formError("Das Foto konnte nicht gespeichert werden. Bitte erneut versuchen.", data.values);

  const name = file.name.replace(/[\\/\u0000-\u001f]/g, "").slice(0, 120) || `foto.${type.extension}`;
  const { error } = await supabase.rpc("add_visit_photo", {
    visit_id: data.visitId,
    expected_version: data.version,
    storage_path: path,
    file_name: name,
    mime_type: type.mime,
    size_bytes: bytes.length,
  });
  if (error) {
    await admin.storage.from("dashboard").remove([path]);
    return formError(databaseErrorMessage(error), data.values);
  }
  refresh();
  return formSuccess("Foto gespeichert (privat, nur für berechtigte Mitarbeitende sichtbar).", data.values);
}
