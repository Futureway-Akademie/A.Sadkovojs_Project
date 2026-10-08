import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { invoicePdfFileName, renderInvoicePdf } from "@/lib/invoice-pdf";
import { loadInvoiceFonts } from "@/lib/invoice-pdf-fonts";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate" };

// PDF download of the issued invoice (task-6-3). Reads with the user's rights (RLS), so only people
// who may see the request get the invoice. Drafts have no PDF. The PDF is rendered from the frozen
// invoice (items and snapshots), so later rate or settings changes do not alter it.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (session.status !== "active") return new NextResponse("Nicht angemeldet.", { status: 401, headers: NO_STORE });

  const { id } = await params;
  const notFound = new NextResponse("Keine ausgestellte Rechnung gefunden.", { status: 404, headers: NO_STORE });
  if (!UUID.test(id)) return notFound;

  const supabase = await createClient();
  const [{ data: invoice }, { data: request }] = await Promise.all([
    supabase.from("invoices").select("*").eq("request_id", id).maybeSingle(),
    supabase.from("requests").select("completed_at, request_number").eq("id", id).maybeSingle(),
  ]);
  if (!invoice || !request || invoice.status === "draft" || !invoice.invoice_number) return notFound;

  const { data: items, error } = await supabase.from("invoice_items").select("*").eq("invoice_id", invoice.id).order("position");
  if (error || !items) return new NextResponse("Rechnung konnte nicht geladen werden.", { status: 500, headers: NO_STORE });

  const pdf = await renderInvoicePdf({ invoice, items, serviceDate: request.completed_at, requestNumber: request.request_number, fonts: await loadInvoiceFonts() });
  return new NextResponse(new Blob([pdf as Uint8Array<ArrayBuffer>], { type: "application/pdf" }), {
    headers: {
      ...NO_STORE,
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.byteLength),
      "Content-Disposition": `attachment; filename="${invoicePdfFileName(invoice.invoice_number)}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
