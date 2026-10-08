// Unit tests for the overview helpers (task-7-2): period parameters, titles, ranges, value and change
// formatting (no percentage on a zero base, points for percentages), KPI links.
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatKpiChange, formatKpiValue, formatRange, KPI_GROUPS, KPI_INFO, neighbourAnchors, parsePeriodParams, periodQuery, periodTitle } from "../../lib/analytics.ts";

const nbsp = (text) => text.replace(/[  ]/g, " ");

test("Zeitraum aus der URL, ungültige Werte ergeben den aktuellen Monat", () => {
  assert.deepEqual(parsePeriodParams({ zeitraum: "quartal", datum: "2026-04-15" }), { kind: "quarter", param: "quartal", anchor: "2026-04-15" });
  assert.deepEqual(parsePeriodParams({ zeitraum: "dekade", datum: "15.04.2026" }), { kind: "month", param: "monat", anchor: null });
  assert.equal(periodQuery("woche", null), "?zeitraum=woche");
  assert.equal(periodQuery("jahr", "2025-01-01"), "?zeitraum=jahr&datum=2025-01-01");
});

test("Nachbarzeiträume und Titel", () => {
  assert.deepEqual(neighbourAnchors("2026-03-01", "2026-03-31"), { previous: "2026-02-28", next: "2026-04-01" });
  assert.equal(periodTitle("month", "2026-10-01"), "Oktober 2026");
  assert.equal(periodTitle("quarter", "2026-10-01"), "Q4 2026");
  assert.equal(periodTitle("year", "2026-01-01"), "2026");
  assert.equal(periodTitle("week", "2026-10-05"), "KW 41/2026");
  assert.equal(periodTitle("week", "2026-12-28"), "KW 53/2026");
  assert.equal(periodTitle("week", "2024-12-30"), "KW 1/2025");
});

test("Bereich: Mitternacht beendet den Vortag, sonst mit Uhrzeit", () => {
  assert.equal(formatRange("2026-02-28T23:00:00Z", "2026-03-31T22:00:00Z"), "01.03.2026 – 31.03.2026");
  assert.equal(formatRange("2026-09-30T22:00:00Z", "2026-10-08T08:00:00Z"), "01.10.2026 – 08.10.2026, 10:00");
});

test("Werte je Einheit", () => {
  assert.equal(formatKpiValue("count", 1234), "1.234");
  assert.equal(nbsp(formatKpiValue("percent", 63.6)), "63,6 %");
  assert.equal(formatKpiValue("days", 13.66), "13,7 Tage");
  assert.equal(nbsp(formatKpiValue("eur", 4109.08)), "4.109,08 €");
  assert.equal(formatKpiValue("minutes", 105), "1 h 45 min");
  assert.equal(formatKpiValue("count", null), "–");
});

test("Änderung: Prozent, Punkte, Null-Basis ohne Prozentwert, Richtung", () => {
  assert.deepEqual(formatKpiChange({ key: "completed", unit: "count", current_value: 16, previous_value: 6, difference: 10, change_percent: 166.7 }), { text: "+166,7 %", tone: "good", note: null });
  assert.deepEqual(formatKpiChange({ key: "lead_time_days", unit: "days", current_value: 13.7, previous_value: 11.6, difference: 2.1, change_percent: 18.1 }), { text: "+18,1 %", tone: "bad", note: null });
  assert.deepEqual(formatKpiChange({ key: "automatic_share", unit: "percent", current_value: 63.6, previous_value: 41.7, difference: 21.9, change_percent: null }), { text: "+21,9 Pkt.", tone: "good", note: null });
  assert.deepEqual(formatKpiChange({ key: "review_queue", unit: "count", current_value: 5, previous_value: 0, difference: 5, change_percent: null }), { text: "+5", tone: "bad", note: "Vorperiode 0 – kein Prozentwert" });
  assert.deepEqual(formatKpiChange({ key: "received", unit: "count", current_value: 8, previous_value: 10, difference: -2, change_percent: -20 }), { text: "−20,0 %", tone: "neutral", note: null });
  assert.deepEqual(formatKpiChange({ key: "response_on_time", unit: "percent", current_value: null, previous_value: 50, difference: null, change_percent: null }), { text: "–", tone: "neutral", note: "Kein Vergleichswert" });
});

test("jede Kennzahl der Übersicht hat Definition und Listen-Link", () => {
  const window = { current_start: "2026-09-30T22:00:00+00:00", current_end: "2026-10-08T08:00:00+00:00" };
  for (const key of [...KPI_GROUPS.events, ...KPI_GROUPS.snapshots, ...KPI_GROUPS.finance]) {
    assert.ok(KPI_INFO[key]?.definition, `${key}: Definition`);
    assert.match(KPI_INFO[key].href(window), /^\/dashboard\/(anfragen|rechnungen|planung)/, `${key}: Link`);
  }
  assert.equal(KPI_INFO.received.href(window), "/dashboard/anfragen?feld=eingang&von=2026-09-30T22%3A00%3A00%2B00%3A00&bis=2026-10-08T08%3A00%3A00%2B00%3A00");
  assert.match(KPI_INFO.payments_received.href(window), /^\/dashboard\/rechnungen\?feld=bezahlt&/);
});
