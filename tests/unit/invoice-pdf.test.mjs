// Unit tests for the invoice PDF (task-6-3, design task-6-4): demo marking on every page, pagination with
// carry-over, deterministic output, no PDF for drafts, characters outside the font subset.
// Embedded fonts encode glyph ids, so the drawn texts are captured through the onText hook.
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import { DEMO_MARK, invoicePdfFileName, renderInvoicePdf } from "../../lib/invoice-pdf.ts";
import { loadInvoiceFonts } from "../../lib/invoice-pdf-fonts.ts";

const fonts = await loadInvoiceFonts();
const seller = {
  company_name: "RheinWerk Industrieservice GmbH", street_house_number: "Rheinwerkstraße 12", postal_code: "68169", city: "Mannheim",
  phone: "+49 621 00000-0", email: "service@rheinwerk-industrieservice.example", managing_director: "Dr. Lena Hartmann",
  iban: "DE00 0000 0000 0000 0000 00 (Demo)", bank: "Demo-Bank", vat_id: "DE000000000 (Demo)",
  legal_note: "Fiktives Portfolio-Projekt. RheinWerk Industrieservice GmbH ist kein reales Unternehmen.",
};
const invoice = {
  invoice_number: "RE-2026-00042", status: "issued", issue_date: "2026-10-08", payment_due_date: "2026-10-22", issued_at: "2026-10-08T09:15:00Z",
  subtotal: 282.9, tax_total: 53.75, total: 336.65, currency: "EUR", seller_snapshot: seller,
  customer_snapshot: { company_name: "Łódź Glaswerk KG", contact_name: "Christian Weber", street_house_number: "Am Hafen 39", postal_code: "46045", city: "Oberhausen", request_number: "RIS-2026-00017", customer_number: "K-1001" },
};
const items = [
  { position: 1, description: "Diagnose und Reparatur vor Ort", unit: "hour", quantity: 1.5, unit_price: 156, tax_rate: 19, net_amount: 234, tax_amount: 44.46 },
  { position: 2, description: "Gleitringdichtung", unit: "piece", quantity: 1, unit_price: 48.9, tax_rate: 19, net_amount: 48.9, tax_amount: 9.29 },
];

async function render(input) {
  const pages = new Map();
  const bytes = await renderInvoicePdf({ serviceDate: "2026-10-07T13:00:00Z", fonts, ...input, onText: (page, text) => pages.set(page, `${pages.get(page) ?? ""}${text}\n`) });
  return { bytes, pages: [...pages.keys()].sort((a, b) => a - b).map((page) => pages.get(page)) };
}

test("PDF trägt die Kennzeichnung Musterrechnung / Demodaten und die Rechnungsdaten", async () => {
  const { bytes, pages } = await render({ invoice, items });
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(pdf.getTitle(), `${DEMO_MARK} RE-2026-00042`);
  const [text] = pages;
  assert.match(text, /MUSTERRECHNUNG \/ DEMODATEN – KEINE ECHTE RECHNUNG/);
  assert.match(text, /^MUSTERRECHNUNG\nDEMODATEN\n/);
  assert.match(text, /Musterrechnung \/ Demodaten – keine echte Rechnung · \nRE-2026-00042/);
  assert.match(text, /RheinWerk\nINDUSTRIESERVICE/);
  assert.match(text, /Rechnung \nRE-2026-00042/);
  assert.match(text, /Gleitringdichtung/);
  assert.match(text, /Summe netto\n282,90\s€/);
  assert.match(text, /Umsatzsteuer 19\s%\n53,75\s€/);
  assert.match(text, /Gesamtbetrag\n336,65\s€/);
  assert.match(text, /Leistungsdatum\n07\.10\.2026/);
  assert.match(text, /Geschäftsführung: Dr\. Lena Hartmann/);
  assert.match(text, /Seite 1 von 1/);
});

test("gleiche Rechnung ergibt byte-identisches PDF", async () => {
  const first = await renderInvoicePdf({ invoice, items, serviceDate: "2026-10-07T13:00:00Z", fonts });
  const second = await renderInvoicePdf({ invoice, items, serviceDate: "2026-10-07T13:00:00Z", fonts });
  assert.deepEqual(Buffer.from(first), Buffer.from(second));
});

test("Entwurf hat kein PDF", async () => {
  await assert.rejects(renderInvoicePdf({ invoice: { ...invoice, status: "draft", invoice_number: null }, items, serviceDate: null, fonts }));
});

test("viele Positionen: Folgeseiten mit Übertrag, jede Seite gekennzeichnet", async () => {
  const many = Array.from({ length: 75 }, (_, index) => ({ ...items[1], position: index + 1, description: `Teil ${index + 1} ${"Überlange-Bezeichnung-ohne-Leerzeichen".repeat(index % 9 === 0 ? 3 : 1)}`, net_amount: 10, tax_amount: 1.9 }));
  const { bytes, pages } = await render({ invoice: { ...invoice, subtotal: 750, tax_total: 142.5, total: 892.5 }, items: many });
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), pages.length);
  assert.ok(pages.length >= 3, `${pages.length} Seiten`);
  pages.forEach((text, index) => {
    assert.match(text, /MUSTERRECHNUNG\nDEMODATEN/);
    assert.match(text, /Musterrechnung \/ Demodaten – keine echte Rechnung · /);
    assert.match(text, new RegExp(`Seite ${index + 1} von ${pages.length}`));
    if (index > 0) {
      assert.match(text, /Rechnung \nRE-2026-00042\n \(Fortsetzung\)/);
      assert.match(text, new RegExp(`Übertrag von Seite ${index} \\(Pos\\. 1–\\d+\\)`));
    }
  });
  // Carry-over equals the net sum of all earlier rows
  const carried = pages[1].match(/Übertrag von Seite 1 \(Pos\. 1–(\d+)\)\n([\d.,]+)\s€/);
  assert.ok(carried);
  assert.equal(carried[2], `${Number(carried[1]) * 10},00`);
  assert.match(pages.at(-1), /Teil 75/);
  assert.match(pages.at(-1), /Summe netto \(Pos\. 1–75\)\n750,00\s€/);
  assert.doesNotMatch(pages[0], /Summe netto/);
});

test("Zeichen außerhalb der Schrift werden ersetzt, Latin Extended bleibt erhalten", async () => {
  const { bytes } = await render({ invoice, items: [{ ...items[1], description: "Dichtung 東京 Đakovo" }] });
  assert.ok(bytes.length > 0);
  // Łódź is part of the font subset and must not be simplified
  const { pages } = await render({ invoice, items });
  assert.match(pages[0], /Łódź Glaswerk KG/);
});

test("fehlende Anfragenummer im Snapshot wird aus der Anfrage ergänzt", async () => {
  const older = { ...invoice.customer_snapshot };
  delete older.request_number;
  const { pages } = await render({ invoice: { ...invoice, customer_snapshot: older }, items, requestNumber: "RIS-2024-00008" });
  assert.match(pages[0], /Anfrage\nRIS-2024-00008/);
  assert.match(pages[0], /zur Serviceanfrage \nRIS-2024-00008/);
});

test("Dateiname enthält die Rechnungsnummer", () => {
  assert.equal(invoicePdfFileName("RE-2026-00042"), "Musterrechnung-RE-2026-00042.pdf");
});
