import "server-only";
import { isoInstant } from "@/lib/dashboard/requests";
import { berlinDayKey } from "@/lib/format";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

// Invoice list for managers and admins (task-7-2), target of the finance KPIs. Reads with the user's
// rights (RLS). Issued is not collected: "offen" are issued invoices without payment, independent of sending.
type Invoice = Database["public"]["Tables"]["invoices"]["Row"];

export const INVOICE_PAGE_SIZE = 25;

export const INVOICE_DATE_FIELDS = {
  ausgestellt: { column: "issued_at", label: "Ausgestellt" },
  bezahlt: { column: "paid_at", label: "Bezahlt" },
} as const;

export const INVOICE_STATES = {
  offen: "Offen (ausgestellt, nicht bezahlt)",
  ueberfaellig: "Überfällig",
  bezahlt: "Bezahlt",
  entwurf: "Entwurf",
} as const;

export type InvoiceFilters = {
  q: string;
  field: keyof typeof INVOICE_DATE_FIELDS | "";
  from: string;
  to: string;
  state: keyof typeof INVOICE_STATES | "";
  page: number;
};

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() ?? "";

export function parseInvoiceFilters(params: Record<string, string | string[] | undefined>): InvoiceFilters {
  const field = single(params.feld);
  const from = isoInstant(single(params.von));
  const to = isoInstant(single(params.bis));
  const state = single(params.status);
  const page = Number.parseInt(single(params.seite), 10);
  const ranged = field in INVOICE_DATE_FIELDS && from && to;
  return {
    q: single(params.suche).slice(0, 60),
    field: ranged ? (field as InvoiceFilters["field"]) : "",
    from: ranged ? from : "",
    to: ranged ? to : "",
    state: state in INVOICE_STATES ? (state as InvoiceFilters["state"]) : "",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export function invoiceQuery(filters: InvoiceFilters, overrides: Partial<InvoiceFilters> = {}): string {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (merged.q) params.set("suche", merged.q);
  if (merged.field) {
    params.set("feld", merged.field);
    params.set("von", merged.from);
    params.set("bis", merged.to);
  }
  if (merged.state) params.set("status", merged.state);
  if (merged.page > 1) params.set("seite", String(merged.page));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export type InvoiceListItem = Pick<Invoice, "id" | "request_id" | "invoice_number" | "status" | "issue_date" | "payment_due_date" | "paid_at" | "subtotal" | "total" | "currency"> & {
  company_name: string;
  request_number: string;
  overdue: boolean;
};

const COLUMNS = "id, request_id, invoice_number, status, issue_date, payment_due_date, paid_at, subtotal, total, currency, requests(request_number, company_name)";

export async function listInvoices(filters: InvoiceFilters): Promise<{ rows: InvoiceListItem[]; total: number; sumGross: number; sumNet: number; error: boolean }> {
  const supabase = await createClient();
  const today = berlinDayKey(new Date());
  // Same filter for the page and for the totals over all matching invoices
  const apply = <Q extends { eq: (c: string, v: string) => Q; in: (c: string, v: string[]) => Q; is: (c: string, v: null) => Q; not: (c: string, o: string, v: null) => Q; lt: (c: string, v: string) => Q; gte: (c: string, v: string) => Q; ilike: (c: string, v: string) => Q }>(query: Q): Q => {
    let result = query;
    if (filters.field) result = result.gte(INVOICE_DATE_FIELDS[filters.field].column, filters.from).lt(INVOICE_DATE_FIELDS[filters.field].column, filters.to);
    if (filters.state === "offen") result = result.in("status", ["issued", "sent"]).is("paid_at", null);
    if (filters.state === "ueberfaellig") result = result.in("status", ["issued", "sent"]).is("paid_at", null).lt("payment_due_date", today);
    if (filters.state === "bezahlt") result = result.eq("status", "paid");
    if (filters.state === "entwurf") result = result.eq("status", "draft");
    if (filters.q) {
      const term = filters.q.replace(/[,()*%_\\:"']/g, " ").replace(/\s+/g, " ").trim();
      if (term) result = result.ilike("invoice_number", `%${term}%`);
    }
    return result;
  };
  const from = (filters.page - 1) * INVOICE_PAGE_SIZE;
  const [page, sums] = await Promise.all([
    apply(supabase.from("invoices").select(COLUMNS, { count: "exact" })).order("issued_at", { ascending: false, nullsFirst: true }).order("id").range(from, from + INVOICE_PAGE_SIZE - 1),
    apply(supabase.from("invoices").select("subtotal, total")).limit(10000),
  ]);
  if ((page.error && page.error.code !== "PGRST103") || sums.error) return { rows: [], total: 0, sumGross: 0, sumNet: 0, error: true };
  const rows = (page.data ?? []).map((row) => {
    const request = Array.isArray(row.requests) ? row.requests[0] : row.requests;
    return {
      ...row,
      company_name: request?.company_name ?? "–",
      request_number: request?.request_number ?? "–",
      overdue: (row.status === "issued" || row.status === "sent") && !row.paid_at && !!row.payment_due_date && row.payment_due_date < today,
    };
  });
  const cents = (values: number[]) => values.reduce((sum, value) => sum + Math.round(Number(value) * 100), 0) / 100;
  return { rows, total: page.count ?? 0, sumGross: cents((sums.data ?? []).map((row) => row.total)), sumNet: cents((sums.data ?? []).map((row) => row.subtotal)), error: false };
}
