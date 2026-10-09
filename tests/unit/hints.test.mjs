// Unit tests for the automatic hints (task-10-3, specification section 07): a hint only when its
// fixed rule matches. Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays } from "../../lib/berlin-time.ts";
import { dueSoonHint, monthRecordHint, queuePeakHint, smallBaseHint } from "../../lib/hints.ts";

const today = "2026-10-08";
const days = (values) => values.map((value, index) => ({ day: addDays(today, index - values.length + 1), value }));

test("Höchststand: heute = Maximum der letzten 90 Tage und > 1", () => {
  assert.deepEqual(queuePeakHint(days([2, 3, 5]), today), { kind: "peak", text: "Höchststand der letzten 90 Tage" });
  assert.deepEqual(queuePeakHint(days([5, 3, 5]), today)?.kind, "peak", "Gleichstand mit früherem Maximum zählt");
  assert.equal(queuePeakHint(days([6, 3, 5]), today), null);
  assert.equal(queuePeakHint(days([0, 1, 1]), today), null, "Wert 1 ist kein Engpass");
  assert.equal(queuePeakHint(days([3, 2]).slice(0, 1), today), null, "ohne Wert für heute: 0");
  // A higher value older than 90 days does not count
  const old = [{ day: addDays(today, -90), value: 9 }, { day: today, value: 4 }];
  assert.equal(queuePeakHint(old, today)?.kind, "peak");
  const inside = [{ day: addDays(today, -89), value: 9 }, { day: today, value: 4 }];
  assert.equal(queuePeakHint(inside, today), null);
});

test("Höchster Monatswert nur für den letzten abgeschlossenen Monat", () => {
  const months = [
    { bucket_start: "2026-07-01", value: 10 },
    { bucket_start: "2026-08-01", value: 12 },
    { bucket_start: "2026-09-01", value: 15 },
    { bucket_start: "2026-10-01", value: 30 },
  ];
  assert.deepEqual(monthRecordHint(months, "2026-10-01"), { kind: "record", text: "Höchster Monatswert bisher" });
  assert.equal(monthRecordHint(months.map((row) => (row.bucket_start === "2026-08-01" ? { ...row, value: 15 } : row)), "2026-10-01"), null, "Gleichstand ist kein Höchstwert");
  assert.equal(monthRecordHint(months.slice(2), "2026-10-01"), null, "ohne Vormonat kein Hinweis");
});

test("Kleine Basis unter 20 Fällen", () => {
  assert.deepEqual(smallBaseHint(19), { kind: "small_base", text: "Kleine Basis: 19 Fälle" });
  assert.equal(smallBaseHint(1)?.text, "Kleine Basis: 1 Fall");
  assert.equal(smallBaseHint(20), null);
  assert.equal(smallBaseHint(null), null);
});

test("Bald fällig: offene Rechnung, Fälligkeit in höchstens 7 Tagen", () => {
  assert.equal(dueSoonHint("sent", "2026-10-08", today)?.text, "Heute fällig");
  assert.equal(dueSoonHint("issued", "2026-10-09", today)?.text, "Morgen fällig");
  assert.equal(dueSoonHint("sent", "2026-10-15", today)?.text, "Fällig in 7 Tagen");
  assert.equal(dueSoonHint("sent", "2026-10-16", today), null);
  assert.equal(dueSoonHint("sent", "2026-10-07", today), null, "überfällig ist nicht bald fällig");
  assert.equal(dueSoonHint("paid", "2026-10-09", today), null);
  assert.equal(dueSoonHint("draft", "2026-10-09", today), null);
});
