// Unit tests for the chart data of the analysis page (task-7-3): cumulative comparison, seasonality
// without invented zeros, automation per month, queue history in wide form.
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { automationSeries, cumulativeComparison, dayLabel, monthLabel, queueSeries, seasonality } from "../../lib/insights.ts";
import { CHART_COLORS } from "../../lib/chart-colors.ts";

const row = (bucket_start, values = {}) => ({ bucket_start, received: 0, intake_completed: 0, automatic_completed: 0, completed: 0, invoiced_gross: 0, payments_received: 0, saved_requests: 0, saved_minutes: 0, baseline_minutes: null, ...values });

test("Beschriftungen", () => {
  assert.equal(monthLabel("2026-03-01"), "Mär 26");
  assert.equal(dayLabel("2026-03-07"), "07.03.");
});

test("kumulierter Vergleich: laufender Zeitraum endet am letzten Tag, Vorzeitraum läuft weiter", () => {
  const current = [1, 2, 0].map((value, index) => ({ bucket_start: `2026-10-0${index + 1}`, value }));
  const previous = [2, 0, 1, 4].map((value, index) => ({ bucket_start: `2026-09-0${index + 1}`, value }));
  assert.deepEqual(cumulativeComparison(current, previous), [
    { day: 1, current: 1, previous: 2 },
    { day: 2, current: 3, previous: 2 },
    { day: 3, current: 3, previous: 3 },
    { day: 4, current: null, previous: 7 },
  ]);
});

test("Saisonalität: keine Nullen vor dem ersten Datenmonat und nach dem aktuellen Monat", () => {
  const rows = [row("2024-10-01"), row("2024-11-01", { received: 5 }), row("2024-12-01", { received: 0 }), row("2025-01-01", { received: 7 }), row("2025-02-01", { received: 3 })];
  const { years, data } = seasonality(rows, "2025-02-08");
  assert.deepEqual(years, ["2024", "2025"]);
  assert.equal(data[9]["2024"], null, "Okt 2024 vor dem ersten Datenmonat");
  assert.equal(data[10]["2024"], 5);
  assert.equal(data[11]["2024"], 0, "echter Nullmonat bleibt 0");
  assert.equal(data[0]["2025"], 7);
  assert.equal(data[2]["2025"], null, "März 2025 liegt nach dem aktuellen Monat");
});

test("Automatisierung je Monat: Anteil nur mit Basis, korrigierte, Zeitersparnis in Stunden", () => {
  const [empty, month] = automationSeries([row("2026-01-01"), row("2026-02-01", { intake_completed: 8, automatic_completed: 6, saved_requests: 5, saved_minutes: 75, baseline_minutes: 15 })]);
  assert.equal(empty.share, null);
  assert.deepEqual({ share: month.share, corrected: month.corrected, savedHours: month.savedHours, savedRequests: month.savedRequests, baseline: month.baseline }, { share: 75, corrected: 1, savedHours: 1.3, savedRequests: 5, baseline: 15 });
});

test("Warteschlangen je Tag in breiter Form", () => {
  const data = queueSeries([
    { day: "2026-10-01", queue: "review", requests: 2 },
    { day: "2026-10-01", queue: "planning", requests: 1 },
    { day: "2026-10-02", queue: "review", requests: 0 },
  ]);
  assert.deepEqual(data, [{ day: "01.10.", date: "2026-10-01", review: 2, planning: 1 }, { day: "02.10.", date: "2026-10-02", review: 0 }]);
});

test("Diagrammfarben: feste Reihenfolge, Markenblau zuerst", () => {
  assert.deepEqual([...CHART_COLORS], ["#2F80C9", "#EB6834", "#4A3AA7", "#008300"]);
});
