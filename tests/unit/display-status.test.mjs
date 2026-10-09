// Unit tests for the displayed status (task-10-3, specification section 04): one status per request,
// fallback for unlisted combinations, exact inverse as database filter, invoice status with overdue days.
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { invoiceDisplayStatus, overdueText, priorityDisplay, REQUEST_DISPLAY_STATUSES, requestDisplayStatus, requestStatusFilter } from "../../lib/display-status.ts";

const show = (intake, work) => {
  const { label, tone } = requestDisplayStatus(intake, work);
  return `${label}|${tone}`;
};

test("Zuordnungstabelle der Spezifikation", () => {
  assert.equal(show("new", "not_planned"), "Neu|act");
  assert.equal(show("analyzing", "not_planned"), "Analyse|run");
  assert.equal(show("needs_review", "not_planned"), "Prüfung|act");
  assert.equal(show("awaiting_customer", "not_planned"), "Wartet auf Kunde|wait");
  assert.equal(show("processed", "not_planned"), "Zu planen|run");
  assert.equal(show("processed", "scheduled"), "Eingeplant|run");
  assert.equal(show("processed", "in_progress"), "In Arbeit|run");
  assert.equal(show("processed", "waiting_parts"), "Wartet auf Teile|wait");
  assert.equal(show("processed", "completed"), "Abgeschlossen|done");
  assert.equal(show("rejected", "cancelled"), "Abgelehnt|closed");
  assert.equal(show("rejected", "not_planned"), "Abgelehnt|closed");
  assert.equal(show("cancelled", "cancelled"), "Storniert|closed");
  assert.equal(show("processed", "cancelled"), "Storniert|closed");
});

test("nicht vorgesehene Kombinationen fallen auf die Erstbearbeitung zurück", () => {
  assert.equal(show("needs_review", "scheduled"), "Prüfung|act");
  assert.equal(show("awaiting_customer", "in_progress"), "Wartet auf Kunde|wait");
  assert.equal(show("new", "cancelled"), "Storniert|closed");
  assert.equal(show(null, null), "Unbekannt|wait");
  assert.equal(show("processed", "irgendwas"), "Unbekannt|wait");
});

test("Filter ist die exakte Umkehrung der Anzeige", () => {
  // Evaluate a PostgREST "or" expression against one row (subset used by requestStatusFilter)
  const evaluate = (expression, row) => {
    const parts = [];
    let depth = 0;
    let current = "";
    for (const char of expression) {
      if (char === "," && depth === 0) { parts.push(current); current = ""; continue; }
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      current += char;
    }
    parts.push(current);
    const condition = (text) => {
      const [field, op, value] = text.split(".");
      return op === "eq" ? row[field] === value : row[field] !== value;
    };
    return parts.some((part) => part.startsWith("and(") ? part.slice(4, -1).split(",").every(condition) : condition(part));
  };
  const intakes = ["new", "analyzing", "needs_review", "awaiting_customer", "processed", "rejected", "cancelled"];
  const works = ["not_planned", "scheduled", "in_progress", "waiting_parts", "completed", "cancelled"];
  for (const status of REQUEST_DISPLAY_STATUSES) {
    const filter = requestStatusFilter(status.key);
    assert.ok(filter, status.key);
    for (const intake_status of intakes) {
      for (const work_status of works) {
        const shown = requestDisplayStatus(intake_status, work_status).key === status.key;
        assert.equal(evaluate(filter, { intake_status, work_status }), shown, `${status.key}: ${intake_status}/${work_status}`);
      }
    }
  }
  assert.equal(requestStatusFilter("gibt-es-nicht"), null);
});

test("Priorität ohne Wert heißt „nicht bestimmt“", () => {
  assert.deepEqual(priorityDisplay(null), { label: "nicht bestimmt", determined: false });
  assert.deepEqual(priorityDisplay("critical"), { label: "Kritisch", determined: true });
});

test("Rechnungsstatus mit Überfälligkeit und Fälligkeit", () => {
  const today = "2026-10-08";
  assert.deepEqual(invoiceDisplayStatus("draft", null, today), { key: "entwurf", label: "Entwurf", tone: "wait", overdueDays: null, dueInDays: null });
  assert.equal(invoiceDisplayStatus("issued", "2026-10-20", today).label, "Ausgestellt · nicht versendet");
  assert.equal(invoiceDisplayStatus("issued", "2026-10-20", today).dueInDays, 12);
  assert.equal(invoiceDisplayStatus("sent", "2026-10-08", today).label, "Versendet · offen");
  assert.equal(invoiceDisplayStatus("sent", "2026-10-08", today).dueInDays, 0);
  // "Als versendet markiert" + overdue becomes one chip "Überfällig"
  const overdue = invoiceDisplayStatus("sent", "2026-10-01", today);
  assert.equal(overdue.label, "Überfällig");
  assert.equal(overdue.tone, "act");
  assert.equal(overdue.overdueDays, 7);
  assert.equal(invoiceDisplayStatus("issued", "2026-10-07", today).overdueDays, 1);
  assert.equal(invoiceDisplayStatus("paid", "2026-01-01", today).label, "Bezahlt");
  assert.equal(overdueText(1), "seit 1 Tag");
  assert.equal(overdueText(64), "seit 64 Tagen");
});

test("Fortschritt der Anfrage", async () => {
  const { requestProgress } = await import("../../lib/display-status.ts");
  const current = (intake, work) => requestProgress(intake, work)?.find((step) => step.state === "current")?.label ?? null;
  assert.equal(current("new", "not_planned"), "Eingang");
  assert.equal(current("needs_review", "not_planned"), "Prüfung");
  assert.equal(current("awaiting_customer", "not_planned"), "Prüfung");
  assert.equal(current("processed", "not_planned"), "Einsatzplanung");
  assert.equal(current("processed", "waiting_parts"), "Einsatz");
  assert.ok(requestProgress("processed", "completed").every((step) => step.state === "done"));
  assert.equal(requestProgress("rejected", "cancelled"), null);
  assert.deepEqual(requestProgress("needs_review", "not_planned").map((step) => step.state), ["done", "done", "current", "todo", "todo", "todo"]);
});

test("Überfällige Forderungen nach Alter", async () => {
  const { overdueAging } = await import("../../lib/display-status.ts");
  const today = "2026-10-08";
  const rows = [
    { status: "sent", payment_due_date: "2026-10-07", total: 100.1 },   // 1 day
    { status: "issued", payment_due_date: "2026-09-08", total: 50.2 },  // 30 days
    { status: "sent", payment_due_date: "2026-09-07", total: 20 },      // 31 days
    { status: "sent", payment_due_date: "2026-07-01", total: 10 },      // 99 days
    { status: "sent", payment_due_date: "2026-10-08", total: 999 },     // due today: not overdue
    { status: "paid", payment_due_date: "2026-01-01", total: 999 },
  ];
  const result = Object.fromEntries(overdueAging(rows, today).map((bucket) => [bucket.key, [bucket.count, bucket.total]]));
  assert.deepEqual(result, { "1-30": [2, 150.3], "31-60": [1, 20], "61-90": [0, 0], "90+": [1, 10] });
});
