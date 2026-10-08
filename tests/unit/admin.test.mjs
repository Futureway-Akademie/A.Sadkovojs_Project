// Unit tests for the administration helpers (task-8-1): weekly hours form, overview text, absence interval,
// validation of new accounts, decimal input and merging of company details.
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { absenceInterval, companyDetailsFrom, parseDecimal, parseWorkingHours, summarizeWorkingHours, validateNewEmployee } from "../../lib/admin.ts";

test("Wochenarbeitszeit aus dem Formular, nur angehakte Tage", () => {
  const { hours, fieldErrors } = parseWorkingHours({ day_1: "on", day_1_start: "07:00", day_1_end: "16:00", day_2_start: "07:00", day_2_end: "16:00", day_5: "on", day_5_start: "08:00", day_5_end: "12:30" });
  assert.deepEqual(hours, [{ weekday: 1, local_start: "07:00", local_end: "16:00" }, { weekday: 5, local_start: "08:00", local_end: "12:30" }]);
  assert.deepEqual(fieldErrors, {});
  assert.deepEqual(parseWorkingHours({ day_3: "on", day_3_start: "16:00", day_3_end: "07:00" }).fieldErrors, { day_3_end: "Ende muss nach dem Beginn liegen." });
  assert.ok(parseWorkingHours({ day_4: "on", day_4_start: "7 Uhr", day_4_end: "16:00" }).fieldErrors.day_4_start);
});

test("Übersicht fasst gleiche aufeinanderfolgende Tage zusammen", () => {
  const day = (weekday, start = "07:00:00", end = "16:00:00") => ({ weekday, local_start: start, local_end: end });
  assert.equal(summarizeWorkingHours([1, 2, 3, 4, 5].map((d) => day(d))), "Mo–Fr 07:00–16:00");
  assert.equal(summarizeWorkingHours([day(1), day(2), day(3, "08:00:00", "12:00:00"), day(5)]), "Mo–Di 07:00–16:00, Mi 08:00–12:00, Fr 07:00–16:00");
  assert.equal(summarizeWorkingHours([]), "Keine Arbeitszeiten");
});

test("Abwesenheit als ganze Tage in Europe/Berlin", () => {
  assert.deepEqual(absenceInterval("2027-03-01", "2027-03-02"), { starts_at: "2027-02-28T23:00:00.000Z", ends_at: "2027-03-02T23:00:00.000Z" });
  // Sommerzeitbeginn 28.03.2027
  assert.deepEqual(absenceInterval("2027-03-28", "2027-03-28"), { starts_at: "2027-03-27T23:00:00.000Z", ends_at: "2027-03-28T22:00:00.000Z" });
  assert.equal(absenceInterval("2027-03-02", "2027-03-01"), null);
  assert.equal(absenceInterval("", "2027-03-01"), null);
});

test("Neues Konto: Name, E-Mail, Rolle, Passwortlänge", () => {
  const roles = ["admin", "technician"];
  assert.deepEqual(validateNewEmployee({ display_name: "Eva", email: "eva@x.test", role: "technician", password: "123456789012" }, roles), {});
  assert.deepEqual(Object.keys(validateNewEmployee({ display_name: " ", email: "eva", role: "chef", password: "kurz" }, roles)).sort(), ["display_name", "email", "password", "role"]);
});

test("Dezimaleingabe mit Komma oder Punkt", () => {
  assert.equal(parseDecimal("19,5"), 19.5);
  assert.equal(parseDecimal(" 1234.56 "), 1234.56);
  assert.equal(parseDecimal("12,3,4"), null);
  assert.equal(parseDecimal(""), null);
});

test("Firmenangaben: bekannte Felder ersetzen, leere entfernen, unbekannte behalten", () => {
  const stored = { company_name: "Alt", city: "Mannheim", vat_id: "DE1", custom: "bleibt" };
  assert.deepEqual(companyDetailsFrom({ company_company_name: " Neu GmbH ", company_city: "", company_vat_id: "DE2" }, stored), { company_name: "Neu GmbH", vat_id: "DE2", custom: "bleibt" });
});
