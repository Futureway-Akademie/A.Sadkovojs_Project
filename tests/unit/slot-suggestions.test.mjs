// Unit tests for the planning suggestions (task-10-3, specification section 07 with the user decision
// of 08.10.2026): earliest free window per technician, ranking by customer, experience and load.
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { berlinToInstant } from "../../lib/berlin-time.ts";
import { earliestWindow, nextWorkingDays, slotReasonText, suggestSlots } from "../../lib/slot-suggestions.ts";

// Thursday 08.10.2026, 13:20 in Berlin
const now = berlinToInstant("2026-10-08", "13:20");
const days = nextWorkingDays("2026-10-08", 3); // Do, Fr, Mo
const hours = (technicianId, start = "07:00", end = "16:00") =>
  [1, 2, 3, 4, 5].map((weekday) => ({ technicianId, weekday, start, end, validFrom: null, validTo: null }));
const at = (day, time) => berlinToInstant(day, time).toISOString();
const block = (technicianId, day, start, end, kind = "visit") => ({ technicianId, start: at(day, start), end: at(day, end), kind });

const technicians = [{ id: "a", name: "Anna Lehmann" }, { id: "d", name: "Dariusz Nowak" }, { id: "t", name: "Tobias Krüger" }];
const base = { technicians, workingHours: [...hours("a"), ...hours("d"), ...hours("t")], busy: [], days, now, durationMinutes: 120, experience: {} };

test("Arbeitstage überspringen das Wochenende", () => {
  assert.deepEqual(days, ["2026-10-08", "2026-10-09", "2026-10-12"]);
});

test("frühestes Fenster: nicht in der Vergangenheit, im Raster, ohne Überschneidung, innerhalb der Arbeitszeit", () => {
  assert.equal(earliestWindow(base, "a")?.startTime, "13:30");
  const busy = [block("a", "2026-10-08", "13:00", "15:00")];
  const window = earliestWindow({ ...base, busy }, "a");
  assert.deepEqual([window?.day, window?.startTime, window?.endTime], ["2026-10-09", "07:00", "09:00"], "ab 15:00 passen keine 2 h mehr bis 16:00");
  const absence = [block("a", "2026-10-08", "00:00", "23:59", "absence"), block("a", "2026-10-09", "00:00", "23:59", "absence")];
  assert.equal(earliestWindow({ ...base, busy: absence }, "a")?.day, "2026-10-12");
  assert.equal(earliestWindow({ ...base, workingHours: [] }, "a"), null);
  // Validity of working hours
  const limited = [{ technicianId: "a", weekday: 4, start: "07:00", end: "16:00", validFrom: null, validTo: "2026-10-01" }];
  assert.equal(earliestWindow({ ...base, workingHours: limited }, "a"), null);
});

test("Wer die Firma kennt, steht zuerst – auch mit späterem Fenster", () => {
  const busy = [block("t", "2026-10-08", "13:00", "16:00")];
  const experience = { t: { customerVisits: 2, manufacturerVisits: 0, equipmentVisits: 0 } };
  const result = suggestSlots({ ...base, busy, experience });
  assert.equal(result[0].name, "Tobias Krüger");
  assert.equal(result[0].day, "2026-10-09");
  assert.ok(result[0].reasons.includes("knows_customer"));
  assert.equal(slotReasonText("knows_customer", result[0]), "Kennt die Firma (2 Einsätze)");
  assert.ok(!result[0].reasons.includes("earliest"));
  assert.ok(result[1].reasons.includes("earliest"));
});

test("Neukunde: Erfahrung mit Hersteller vor Anlagentyp vor Auslastung", () => {
  const experience = {
    a: { customerVisits: 0, manufacturerVisits: 0, equipmentVisits: 4 },
    d: { customerVisits: 0, manufacturerVisits: 1, equipmentVisits: 1 },
  };
  const result = suggestSlots({ ...base, experience });
  assert.deepEqual(result.map((entry) => entry.technicianId), ["d", "a", "t"]);
  assert.ok(result[0].reasons.includes("knows_manufacturer"));
  assert.ok(result[1].reasons.includes("knows_equipment"));
});

test("Neukunde ohne Erfahrung: geringere Auslastung zuerst, dann frühestes Fenster", () => {
  const busy = [
    block("a", "2026-10-12", "07:00", "12:00"),
    block("d", "2026-10-12", "07:00", "09:00"),
    block("t", "2026-10-08", "13:30", "16:00"), // also blocks today's window
    block("t", "2026-10-12", "07:00", "09:00"),
  ];
  const result = suggestSlots({ ...base, busy });
  assert.deepEqual(result.map((entry) => entry.technicianId), ["d", "t", "a"]);
  assert.deepEqual(result.map((entry) => entry.loadMinutes), [120, 270, 300]);
  assert.ok(result[0].reasons.includes("lowest_load"));
  assert.ok(result[0].reasons.includes("today"));
  // Absences do not count as load
  const absent = suggestSlots({ ...base, busy: [block("a", "2026-10-09", "07:00", "16:00", "absence")] });
  assert.ok(absent.every((entry) => entry.loadMinutes === 0));
});

test("Techniker ohne freies Fenster erscheinen nicht", () => {
  const busy = days.map((day) => block("a", day, "07:00", "16:00"));
  assert.deepEqual(suggestSlots({ ...base, busy }).map((entry) => entry.technicianId).includes("a"), false);
});
