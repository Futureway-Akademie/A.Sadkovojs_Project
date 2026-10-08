import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, degrees, rgb, setCharacterSpacing, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { formatCalendarDate, formatCurrency, formatDate, formatNumber, formatPercent } from "./format";
import { WORDMARK_PATH, WORDMARK_UNITS_PER_EM } from "./invoice-pdf-brand";
import type { InvoiceFonts } from "./invoice-pdf-fonts";
import { label } from "./status";

// PDF of an issued invoice in the RheinWerk design (task-6-4). Layout follows the Claude Design template
// docs/design/RheinWerk Rechnungsvorlage.html and its Maßtabelle: all positions in mm from the top left
// corner of the sheet, texts placed on their baseline.
// Content comes only from the frozen invoice (task-6-3): items, amounts and the seller/customer snapshots
// written by issue_invoice, which the database never changes afterwards. Later rate, settings or customer
// changes therefore cannot change the PDF. Output is deterministic (fixed metadata and font names).
export const DEMO_MARK = "Musterrechnung / Demodaten";

type Snapshot = Record<string, unknown>;

export type InvoicePdfInput = {
  invoice: {
    invoice_number: string | null;
    status: string;
    issue_date: string | null;
    payment_due_date: string | null;
    issued_at: string | null;
    subtotal: number;
    tax_total: number;
    total: number;
    currency: string;
    seller_snapshot: unknown;
    customer_snapshot: unknown;
  };
  items: Array<{ position: number; description: string; unit: string; quantity: number; unit_price: number; tax_rate: number; net_amount: number; tax_amount: number }>;
  // Technical completion of the request (immutable once completed)
  serviceDate: string | null;
  // Request number (immutable, guarded by trigger); used when an older snapshot lacks it
  requestNumber?: string | null;
  fonts: InvoiceFonts;
  // Test hook: receives every drawn text with its page number (1-based)
  onText?: (page: number, text: string) => void;
};

const MM = 72 / 25.4;
const PAGE = { width: 210 * MM, height: 297 * MM };
const hex = (value: string) => rgb(parseInt(value.slice(1, 3), 16) / 255, parseInt(value.slice(3, 5), 16) / 255, parseInt(value.slice(5, 7), 16) / 255);
const COLOR = {
  navy: hex("#0B1F33"),
  lime: hex("#B7D83D"),
  white: hex("#FFFFFF"),
  warmWhite: hex("#FCFBF7"),
  steel700: hex("#526574"),
  steel300: hex("#B9C3CB"),
  steel200: hex("#D5DCE2"),
  steel500: hex("#7A8B99"),
  steel100: hex("#E5EAEE"),
};

// Content area and table grid (mm)
const LEFT = 25;
const RIGHT = 190;
const COL = { position: 25, description: 35, descriptionWidth: 64, quantityRight: 108, unit: 109.5, unitMax: 126, priceRight: 146, taxRight: 160, netRight: 190 };
const ROWS_MAX_Y = 258;
const SUMMARY_MAX_E = 230;
const FIRST_PAGE_ROWS_Y = 129;
const NEXT_PAGE_ROWS_Y = 51;

// Letters without a Unicode decomposition to a base letter of the font subset
const FALLBACK: Record<string, string> = { Đ: "D", đ: "d" };

const text = (value: unknown) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
const round2 = (value: number) => Math.round(value * 100) / 100;
// "DE00 … (Demo)" → value in mono, marker in the text font
const splitDemo = (value: string): [string, string] => (value.endsWith(" (Demo)") ? [value.slice(0, -7), " (Demo)"] : [value, ""]);

type Run = [string, PDFFont, number?];
type TextOptions = { size: number; color?: RGB; spacing?: number };

export async function renderInvoicePdf({ invoice, items, serviceDate, requestNumber: fallbackRequestNumber, fonts, onText }: InvoicePdfInput): Promise<Uint8Array> {
  if (invoice.status === "draft" || !invoice.invoice_number) throw new Error("Nur ausgestellte Rechnungen haben ein PDF.");
  const number = invoice.invoice_number;
  const seller = (invoice.seller_snapshot ?? {}) as Snapshot;
  const customer = { ...((invoice.customer_snapshot ?? {}) as Snapshot) };
  customer.request_number ||= fallbackRequestNumber ?? null;
  const currency = invoice.currency || "EUR";
  const money = (value: number) => formatCurrency(value, currency);

  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.registerFontkit(fontkit);
  // Fixed names keep the output deterministic (pdf-lib would add a random suffix)
  const embed = (bytes: Uint8Array, name: string) => pdf.embedFont(bytes, { subset: true, customName: name });
  const [regular, medium, semibold, mono] = await Promise.all([
    embed(fonts.regular, "RWInter-Regular"),
    embed(fonts.medium, "RWInter-Medium"),
    embed(fonts.semibold, "RWInter-SemiBold"),
    embed(fonts.mono, "RWPlexMono-Medium"),
  ]);
  const issuedAt = new Date(invoice.issued_at ?? `${invoice.issue_date}T00:00:00Z`);
  pdf.setTitle(`${DEMO_MARK} ${number}`);
  pdf.setSubject(DEMO_MARK);
  pdf.setAuthor(text(seller.company_name) || "RheinWerk Industrieservice");
  pdf.setCreator("RheinWerk Service-Dashboard");
  pdf.setProducer("RheinWerk Service-Dashboard");
  pdf.setCreationDate(issuedAt);
  pdf.setModificationDate(issuedAt);

  // Characters outside the font subset are simplified instead of rendering as empty boxes
  const charset = new Set(regular.getCharacterSet());
  const safe = (value: string) =>
    [...value.replace(/[  ]/g, " ").replace(/[Đđ]/g, (char) => FALLBACK[char])]
      .map((char) => (charset.has(char.codePointAt(0)!) ? char : [...char.normalize("NFD")].filter((part) => charset.has(part.codePointAt(0)!)).join("") || "?"))
      .join("");

  // Drawing helpers in mm (y from the top edge)
  const x = (mm: number) => mm * MM;
  const y = (mm: number) => PAGE.height - mm * MM;
  const pages: PDFPage[] = [];
  const pageNumber = (page: PDFPage) => pages.indexOf(page) + 1;
  const width = (value: string, font: PDFFont, size: number, spacing = 0) => font.widthOfTextAtSize(safe(value), size) + spacing * [...value].length;
  const runsWidth = (runs: Run[], size: number) => runs.reduce((sum, [value, font, runSize]) => sum + width(value, font, runSize ?? size), 0);

  const draw = (page: PDFPage, value: string, font: PDFFont, xPt: number, yMm: number, { size, color = COLOR.navy, spacing = 0 }: TextOptions) => {
    if (!value) return;
    onText?.(pageNumber(page), value);
    if (spacing) page.pushOperators(setCharacterSpacing(spacing));
    page.drawText(safe(value), { x: xPt, y: y(yMm), font, size, color });
    if (spacing) page.pushOperators(setCharacterSpacing(0));
  };
  const drawRuns = (page: PDFPage, runs: Run[], xMm: number, yMm: number, options: TextOptions) => {
    let cursor = x(xMm);
    for (const [value, font, size] of runs) {
      draw(page, value, font, cursor, yMm, { ...options, size: size ?? options.size });
      cursor += width(value, font, size ?? options.size);
    }
  };
  const drawRight = (page: PDFPage, runs: Run[], rightMm: number, yMm: number, options: TextOptions) => drawRuns(page, runs, rightMm - runsWidth(runs, options.size) / MM, yMm, options);
  const rect = (page: PDFPage, xMm: number, topMm: number, widthMm: number, heightMm: number, color: RGB, border?: RGB) =>
    page.drawRectangle({ x: x(xMm), y: y(topMm + heightMm), width: widthMm * MM, height: heightMm * MM, color, ...(border ? { borderColor: border, borderWidth: 0.5 } : {}) });
  const line = (page: PDFPage, fromMm: number, toMm: number, yMm: number, thickness: number, color: RGB) =>
    page.drawLine({ start: { x: x(fromMm), y: y(yMm) }, end: { x: x(toMm), y: y(yMm) }, thickness, color });
  const hairline = (page: PDFPage, yMm: number) => line(page, LEFT, RIGHT, yMm, 0.5, COLOR.steel200);
  const rule = (page: PDFPage, yMm: number) => line(page, LEFT, RIGHT, yMm, 0.75, COLOR.navy);

  // Shortens a single line to a width (mm) with an ellipsis
  const fit = (value: string, font: PDFFont, size: number, maxMm: number) => {
    if (width(value, font, size) <= maxMm * MM) return value;
    let cut = value.length;
    while (cut > 1 && width(`${value.slice(0, cut)}…`, font, size) > maxMm * MM) cut -= 1;
    return `${value.slice(0, cut).trimEnd()}…`;
  };
  // Word wrap at a width (mm); long words are cut hard
  const wrap = (value: string, font: PDFFont, size: number, maxMm: number) => {
    const max = maxMm * MM;
    const lines: string[] = [];
    for (const paragraph of value.split(/\r?\n/)) {
      let current = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        let rest = word;
        while (width(rest, font, size) > max) {
          let cut = rest.length - 1;
          while (cut > 1 && width(rest.slice(0, cut), font, size) > max) cut -= 1;
          if (current) { lines.push(current); current = ""; }
          lines.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        const candidate = current ? `${current} ${rest}` : rest;
        if (width(candidate, font, size) <= max) current = candidate;
        else { lines.push(current); current = rest; }
      }
      lines.push(current);
    }
    const filled = lines.filter((entry, index) => entry || index === 0);
    return filled.length > 0 ? filled : [""];
  };

  // Logo lockup: bars as rectangles (Maßtabelle 8), wordmark as outlines, descriptor in Inter 500
  const logo = (page: PDFPage, variant: "large" | "small") => {
    const spec = variant === "large"
      ? { bars: [[25, 18.72, 9.49], [27.18, 21.64, 7.3], [25, 24.56, 9.49]], barHeight: 1.46, wordX: 39.59, wordBaseline: 22.37, wordSize: 18.8, descBaseline: 25.55, descSize: 7.9, descSpacing: 0.45 }
      : { bars: [[150.61, 17.59, 7.3], [152.3, 19.84, 5.61], [150.61, 22.08, 7.3]], barHeight: 1.12, wordX: 161.84, wordBaseline: 20.4, wordSize: 14.5, descBaseline: 22.85, descSize: 6.1, descSpacing: 0.34 };
    spec.bars.forEach(([barX, barTop, barWidth], index) => rect(page, barX, barTop, barWidth, spec.barHeight, index === 1 ? COLOR.lime : COLOR.navy));
    page.drawSvgPath(WORDMARK_PATH, { x: x(spec.wordX), y: y(spec.wordBaseline), scale: spec.wordSize / WORDMARK_UNITS_PER_EM, color: COLOR.navy });
    onText?.(pageNumber(page), "RheinWerk");
    draw(page, "INDUSTRIESERVICE", medium, x(spec.wordX), spec.descBaseline, { size: spec.descSize, color: COLOR.steel700, spacing: spec.descSpacing * MM });
  };

  // Watermark first, then demo band and marks; every page
  const newPage = () => {
    const page = pdf.addPage([PAGE.width, PAGE.height]);
    pages.push(page);
    const size = 44;
    const spacing = 0.04 * size;
    const angle = (35 * Math.PI) / 180;
    const along = { x: Math.cos(angle), y: Math.sin(angle) };
    const up = { x: -Math.sin(angle), y: Math.cos(angle) };
    const center = { x: x(105), y: y(152) };
    const capHeight = 0.727 * size;
    ["MUSTERRECHNUNG", "DEMODATEN"].forEach((word, index) => {
      const offset = ((index === 0 ? 1 : -1) * 17.85 * MM) / 2 - capHeight / 2;
      const wordWidth = semibold.widthOfTextAtSize(word, size) + spacing * (word.length - 1);
      onText?.(pages.length, word);
      page.pushOperators(setCharacterSpacing(spacing));
      page.drawText(word, {
        x: center.x + up.x * offset - (along.x * wordWidth) / 2,
        y: center.y + up.y * offset - (along.y * wordWidth) / 2,
        font: semibold,
        size,
        color: COLOR.steel100,
        rotate: degrees(35),
      });
      page.pushOperators(setCharacterSpacing(0));
    });
    rect(page, 0, 0, 210, 11, COLOR.navy);
    rect(page, LEFT, 4.25, 2.5, 2.5, COLOR.lime);
    draw(page, `${DEMO_MARK} – keine echte Rechnung`.toUpperCase(), semibold, x(30), 6.7, { size: 8.5, color: COLOR.white, spacing: 0.06 * 8.5 });
    drawRight(page, [["Demo-Anwendung · Keine Zahlung leisten", regular]], RIGHT, 6.7, { size: 8, color: COLOR.steel300 });
    if (pages.length === 1) for (const fold of [105, 210]) line(page, 4, 9, fold, 0.5, COLOR.steel500);
    line(page, 4, 11, 148.5, 0.5, COLOR.steel500);
    return page;
  };

  const tableHeader = (page: PDFPage, top: number) => {
    rect(page, LEFT, top, RIGHT - LEFT, 8, COLOR.warmWhite);
    hairline(page, top);
    const base = top + 5;
    const options = { size: 7.5 };
    drawRuns(page, [["Pos.", semibold]], COL.position, base, options);
    drawRuns(page, [["Beschreibung", semibold]], COL.description, base, options);
    drawRight(page, [["Menge", semibold]], COL.quantityRight, base, options);
    drawRuns(page, [["Einheit", semibold]], COL.unit, base, options);
    drawRight(page, [["Einzelpreis", semibold]], COL.priceRight, base, options);
    drawRight(page, [["USt.", semibold]], COL.taxRight, base, options);
    drawRight(page, [["Netto", semibold]], COL.netRight, base, options);
    rule(page, top + 8);
  };

  // ---- Page 1 header, address and information block
  const first = newPage();
  logo(first, "large");
  const sellerName = text(seller.company_name) || "RheinWerk Industrieservice GmbH";
  const sellerStreet = text(seller.street_house_number);
  const sellerCity = [text(seller.postal_code), text(seller.city)].filter(Boolean).join(" ");
  draw(first, sellerName, semibold, x(125), 19.5, { size: 8 });
  [[sellerStreet, sellerCity].filter(Boolean).join(" · "), text(seller.phone) && `Tel. ${text(seller.phone)}`, text(seller.email)]
    .filter(Boolean)
    .forEach((entry, index) => draw(first, fit(entry, regular, 8, RIGHT - 125), regular, x(125), 23.5 + index * 4, { size: 8, color: COLOR.steel700 }));
  hairline(first, 38);

  draw(first, fit([sellerName, sellerStreet, sellerCity].filter(Boolean).join(" · "), regular, 6.5, 95), regular, x(LEFT), 59.5, { size: 6.5, color: COLOR.steel700 });
  const recipient = [
    ...wrap(text(customer.company_name), regular, 10, 78),
    text(customer.contact_name) && `z. Hd. ${text(customer.contact_name)}`,
    text(customer.street_house_number),
    [text(customer.postal_code), text(customer.city)].filter(Boolean).join(" "),
  ].filter(Boolean).slice(0, 6);
  recipient.forEach((entry, index) => draw(first, fit(entry, regular, 10, 78), regular, x(LEFT), 67.5 + index * 4.5, { size: 10 }));

  const info: Array<{ term: string; value: string; due?: boolean; plain?: boolean }> = [
    { term: "Rechnungsdatum", value: formatCalendarDate(invoice.issue_date) },
    { term: "Leistungsdatum", value: formatDate(serviceDate) },
    { term: "Fällig am", value: formatCalendarDate(invoice.payment_due_date), due: true },
    { term: "Anfrage", value: text(customer.request_number) },
    { term: "Kundennummer", value: text(customer.customer_number) },
    { term: "Standort", value: text(customer.site_label), plain: true },
  ].filter((row) => row.value && row.value !== "–");
  rect(first, 125, 48.5, 0.53, 1 + info.length * 5, COLOR.navy);
  info.forEach((row, index) => {
    const base = 52.5 + index * 5;
    draw(first, row.term, row.due ? semibold : regular, x(128.5), base, { size: 8, color: row.due ? COLOR.navy : COLOR.steel700 });
    const font = row.plain ? regular : mono;
    // Value may use the space right of its label (3 mm gap)
    const room = RIGHT - 128.5 - width(row.term, row.due ? semibold : regular, 8) / MM - 3;
    drawRight(first, [[fit(row.value, font, 8.5, room), font]], RIGHT, base, { size: 8.5 });
  });

  drawRuns(first, [["Rechnung ", semibold], [number, mono]], LEFT, 104, { size: 18 });
  const requestNumber = text(customer.request_number);
  drawRuns(first, requestNumber
    ? [["Wir berechnen die folgenden Leistungen zur Serviceanfrage ", regular], [requestNumber, mono, 9], [".", regular]]
    : [["Wir berechnen die folgenden Leistungen.", regular]], LEFT, 112, { size: 9.5 });

  // ---- Pagination: rows up to y 258; the page with the summary must end at E ≤ 230
  const rows = items.map((item) => {
    const lines = wrap(item.description, regular, 9, COL.descriptionWidth);
    return { item, lines, height: 3.8 + 4.2 * lines.length };
  });
  const plan: Array<typeof rows> = [[]];
  let cursor = FIRST_PAGE_ROWS_Y;
  for (const row of rows) {
    if (cursor + row.height > ROWS_MAX_Y && plan.at(-1)!.length > 0) {
      plan.push([]);
      cursor = NEXT_PAGE_ROWS_Y;
    }
    plan.at(-1)!.push(row);
    cursor += row.height;
  }
  if (cursor > SUMMARY_MAX_E) {
    // Move the last row onto a new page so the summary follows at least one item there
    const moved = plan.at(-1)!.pop()!;
    plan.push([moved]);
    cursor = NEXT_PAGE_ROWS_Y + moved.height;
  }

  let page = first;
  let carried = 0;
  const firstPosition = rows[0]?.item.position ?? 1;
  let lastPosition = firstPosition;
  plan.forEach((pageRows, index) => {
    let top: number;
    if (index === 0) {
      tableHeader(page, 121);
      top = FIRST_PAGE_ROWS_Y;
    } else {
      page = newPage();
      logo(page, "small");
      drawRuns(page, [["Rechnung ", semibold], [number, mono], [" (Fortsetzung)", semibold]], LEFT, 22.5, { size: 12 });
      const issueDate = formatCalendarDate(invoice.issue_date);
      const customerNumber = text(customer.customer_number);
      const tail: Run[] = [...(customerNumber ? [[" · Kundennummer ", regular], [customerNumber, mono]] as Run[] : []), [" · Rechnungsdatum ", regular], [issueDate, mono]];
      const company = fit(text(customer.company_name), regular, 8, 122 - runsWidth(tail, 8) / MM);
      drawRuns(page, [[company, regular], ...tail], LEFT, 27, { size: 8, color: COLOR.steel700 });
      hairline(page, 31.5);
      tableHeader(page, 35);
      drawRuns(page, [[`Übertrag von Seite ${index} (Pos. ${firstPosition}–${lastPosition})`, medium]], COL.description, 47.8, { size: 9, color: COLOR.steel700 });
      drawRight(page, [[money(carried), mono]], COL.netRight, 47.8, { size: 9, color: COLOR.steel700 });
      hairline(page, 51);
      top = NEXT_PAGE_ROWS_Y;
    }
    pageRows.forEach((row, rowIndex) => {
      const { item } = row;
      const base = top + 4.8;
      const digits = item.unit === "hour" ? 2 : Number.isInteger(Number(item.quantity)) ? 0 : 2;
      const taxDigits = Number.isInteger(Number(item.tax_rate)) ? 0 : 2;
      const options = { size: 9 };
      drawRuns(page, [[String(item.position), mono]], COL.position, base, options);
      row.lines.forEach((entry, lineIndex) => drawRuns(page, [[entry, regular]], COL.description, base + lineIndex * 4.2, options));
      drawRight(page, [[formatNumber(item.quantity, digits), mono]], COL.quantityRight, base, options);
      drawRuns(page, [[fit(label("work_unit", item.unit), regular, 9, COL.unitMax - COL.unit), regular]], COL.unit, base, options);
      drawRight(page, [[money(item.unit_price), mono]], COL.priceRight, base, options);
      drawRight(page, [[formatPercent(item.tax_rate, taxDigits), mono]], COL.taxRight, base, options);
      drawRight(page, [[money(item.net_amount), mono]], COL.netRight, base, options);
      top += row.height;
      const last = index === plan.length - 1 && rowIndex === pageRows.length - 1;
      if (last) rule(page, top);
      else hairline(page, top);
      carried = round2(carried + Number(item.net_amount));
      lastPosition = item.position;
    });
    if (index < plan.length - 1) rule(page, top);
  });

  // ---- Summary relative to the table end E; one line per tax rate
  const end = cursor;
  const taxByRate = new Map<number, number>();
  for (const item of items) taxByRate.set(Number(item.tax_rate), round2((taxByRate.get(Number(item.tax_rate)) ?? 0) + Number(item.tax_amount)));
  const taxLines = [...taxByRate].sort(([a], [b]) => a - b);
  const shift = Math.max(0, taxLines.length - 1) * 5.5;
  const multiPage = plan.length > 1;
  const sumLabel = multiPage ? `Summe netto (Pos. ${firstPosition}–${lastPosition})` : "Summe netto";
  drawRuns(page, [[sumLabel, regular]], 128.5, end + 9, { size: 9, color: COLOR.steel700 });
  drawRight(page, [[money(invoice.subtotal), mono]], RIGHT, end + 9, { size: 9 });
  taxLines.forEach(([rate, amount], index) => {
    const base = end + 14.5 + index * 5.5;
    drawRuns(page, [[`Umsatzsteuer ${formatPercent(rate, Number.isInteger(rate) ? 0 : 2)}`, regular]], 128.5, base, { size: 9, color: COLOR.steel700 });
    drawRight(page, [[money(amount), mono]], RIGHT, base, { size: 9 });
  });
  rect(page, 125, end + 18.5 + shift, 65, 10, COLOR.navy);
  rect(page, 125, end + 18.5 + shift, 0.8, 10, COLOR.lime);
  drawRuns(page, [["Gesamtbetrag", semibold]], 128.5, end + 24.9 + shift, { size: 10, color: COLOR.white });
  drawRight(page, [[money(invoice.total), mono]], 187, end + 24.9 + shift, { size: 11, color: COLOR.white });

  const due = formatCalendarDate(invoice.payment_due_date);
  rect(page, LEFT, end + 4, 90, 24.5 + shift, COLOR.warmWhite, COLOR.steel200);
  rect(page, LEFT, end + 4, 0.53, 24.5 + shift, COLOR.navy);
  draw(page, "ZAHLUNG", mono, x(29), end + 8.5, { size: 7, color: COLOR.steel700, spacing: 0.06 * 7 });
  const payment: Run[][] = [
    [["Bitte überweisen Sie den Gesamtbetrag bis zum", regular]],
    [[due, mono], [" ohne Abzug unter Angabe der", regular]],
    [["Rechnungsnummer ", regular], [number, mono], [".", regular]],
  ];
  payment.forEach((runs, index) => drawRuns(page, runs, 29, end + 13.5 + index * 4.2, { size: 9 }));

  // ---- Footer on every page: bank and company lines, demo marking, page number
  const [iban, ibanMark] = splitDemo(text(seller.iban));
  const [vatId, vatMark] = splitDemo(text(seller.vat_id));
  const bankLine: Run[] = [
    ...(text(seller.bank) ? [[`Bank: ${text(seller.bank)}`, regular]] as Run[] : []),
    ...(iban ? [[`${text(seller.bank) ? " · " : ""}IBAN: `, regular], [iban, mono], [ibanMark, regular]] as Run[] : []),
    ...(vatId ? [[" · USt-IdNr.: ", regular], [vatId, mono], [vatMark, regular]] as Run[] : []),
  ];
  const companyLine = [sellerName, sellerStreet, sellerCity, text(seller.managing_director) && `Geschäftsführung: ${text(seller.managing_director)}`].filter(Boolean).join(" · ");
  const legalLine = text(seller.legal_note);
  pages.forEach((target, index) => {
    hairline(target, 264);
    [bankLine, [[companyLine, regular]] as Run[], legalLine ? [[legalLine, regular]] as Run[] : []]
      .filter((runs) => runs.length > 0)
      .forEach((runs, lineIndex) => drawRuns(target, runs, LEFT, 268.5 + lineIndex * 4, { size: 7.5, color: COLOR.steel700 }));
    rule(target, 281);
    drawRuns(target, [[`${DEMO_MARK} – keine echte Rechnung · `, semibold], [number, mono]], LEFT, 286, { size: 7.5 });
    drawRight(target, [[`Seite ${index + 1} von ${pages.length}`, semibold]], RIGHT, 286, { size: 7.5 });
  });

  return pdf.save({ useObjectStreams: false });
}

export function invoicePdfFileName(invoiceNumber: string) {
  return `Musterrechnung-${invoiceNumber.replace(/[^A-Za-z0-9-]/g, "_")}.pdf`;
}
