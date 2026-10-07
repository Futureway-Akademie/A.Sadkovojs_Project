import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DataTable, type Column } from "@/components/dashboard/ui/data-table";
import { CheckboxField, FileField, HiddenField, SaveForm, SelectField, TextAreaField, TextField } from "@/components/dashboard/ui/save-form";
import { EmptyState, PageHeader } from "@/components/dashboard/ui/states";
import { StatusBadge } from "@/components/dashboard/ui/status-badge";
import { requireRole } from "@/lib/auth/session";
import { loadVisitWorkspace, type VisitWorkspace } from "@/lib/dashboard/visit";
import { formatCurrency, formatDateTime, formatMinutes, formatNumber, formatTimeRange } from "@/lib/format";
import { label } from "@/lib/status";
import { addWorkEntry, completeVisit, resumeVisit, setEntryStatus, startVisit, uploadPhoto, waitForParts } from "./actions";

export const metadata: Metadata = { title: "Einsatz" };

type Props = { params: Promise<{ visitId: string }> };

// Visit workspace for the planned technician (managers and admins may act as well)
export default async function VisitPage({ params }: Props) {
  const employee = await requireRole(["technician", "manager", "admin"]);
  const data = await loadVisitWorkspace((await params).visitId, employee);
  if (!data) notFound();
  const { visit, request } = data;
  const requestClosed = ["rejected", "cancelled"].includes(request.intake_status) || ["completed", "cancelled"].includes(request.work_status);
  const active = ["in_progress", "waiting_parts"].includes(visit.status);
  const canRecord = !requestClosed && !data.invoiceIssued && visit.status !== "cancelled" && visit.status !== "scheduled";
  const hourly = data.rates.find((rate) => rate.billing_model === "hourly");
  const fixed = data.rates.find((rate) => rate.billing_model === "fixed");
  const hasFixed = data.entries.some((entry) => entry.kind === "fixed_service" && entry.item_status !== "cancelled");

  return (
    <div className="dash-page visit-page">
      <nav className="breadcrumb-dash" aria-label="Pfad">
        <Link href={employee.role === "technician" ? "/dashboard/heute" : "/dashboard/anfragen"}>{employee.role === "technician" ? "Mein Tag" : "Anfragen"}</Link> <span aria-hidden="true">/</span> Einsatz
      </nav>
      <PageHeader
        title={request.company_name}
        description={<>{formatTimeRange(visit.scheduled_start, visit.scheduled_end)} · <Link href={`/dashboard/anfragen/${request.id}`} className="mono">{request.request_number}</Link> · {label("service_kind", request.service_kind)}</>}
        actions={<StatusBadge kind="visit_status" value={visit.status} />}
      />
      {request.safety_risk !== "none_known" && <p className="request-alert" role="note"><strong>Sicherheitsgefahr: {label("safety_risk", request.safety_risk)}.</strong> Vor Arbeitsbeginn Sicherheitslage klären.</p>}

      <section className="dash-section" aria-labelledby="status-title">
        <h2 id="status-title">Einsatz</h2>
        {visit.status === "scheduled" && (
          <SaveForm action={startVisit} submitLabel="Arbeit starten"><Context data={data} /><p className="section-note">Startet den Einsatz jetzt und setzt die Anfrage auf „In Arbeit“.</p></SaveForm>
        )}
        {visit.status === "in_progress" && (
          <details className="action">
            <summary>Auf Teile warten</summary>
            <p className="section-note">Pausiert den Einsatz. Der Zeitraum wird freigegeben; die Disposition plant nach Lieferung einen Folgeeinsatz oder der Einsatz wird fortgesetzt.</p>
            <SaveForm action={waitForParts} submitLabel="Einsatz pausieren" submitVariant="secondary"><Context data={data} /><TextAreaField name="reason" label="Welche Teile fehlen?" required rows={2} /></SaveForm>
          </details>
        )}
        {visit.status === "waiting_parts" && (
          <SaveForm action={resumeVisit} submitLabel="Einsatz fortsetzen" submitVariant="secondary"><Context data={data} /><p className="section-note">Wartet auf Teile: {visit.waiting_reason}. Fortsetzen ist nur im ursprünglichen Zeitraum möglich, wenn dieser noch frei ist.</p></SaveForm>
        )}
        {active && (
          <details className="action" open={visit.status === "in_progress"}>
            <summary>Einsatz beenden</summary>
            <p className="section-note">Beendet nur diesen Einsatz. Die Anfrage bleibt offen, bis sie nach allen Einsätzen abgeschlossen wird.</p>
            <SaveForm action={completeVisit} submitLabel="Einsatz beenden">
              <Context data={data} />
              <div className="form-grid">
                <TextField name="minutes" label="Tatsächliche Arbeitszeit (Minuten)" type="number" inputMode="numeric" required defaultValue={String(data.suggestedMinutes ?? "")} hint={data.elapsedMinutes !== null ? `Seit Start: ${formatMinutes(data.elapsedMinutes)}${data.suggestedMinutes !== data.elapsedMinutes ? " – vorgeschlagen ist die geplante Dauer" : ""}` : undefined} />
              </div>
              <TextAreaField name="summary" label="Bericht" required rows={4} />
              <CheckboxField name="follow_up" label="Folgeeinsatz erforderlich" />
              <TextAreaField name="follow_up_reason" label="Grund für den Folgeeinsatz (nur bei Folgeeinsatz)" rows={2} />
            </SaveForm>
          </details>
        )}
        {visit.status === "completed" && (
          <dl className="facts">
            <div><dt>Tatsächlich</dt><dd>{formatDateTime(visit.actual_start)} – {formatDateTime(visit.actual_end)}</dd></div>
            <div><dt>Arbeitszeit</dt><dd>{visit.actual_work_minutes === null ? "–" : formatMinutes(visit.actual_work_minutes)}</dd></div>
            <div><dt>Bericht</dt><dd>{visit.summary ?? "–"}</dd></div>
            <div><dt>Anfrage</dt><dd>{request.work_status === "completed" ? "Abgeschlossen" : "Noch offen – Abschluss auf der Anfrageseite"}</dd></div>
          </dl>
        )}
        {visit.status === "cancelled" && <EmptyState title="Dieser Einsatz wurde storniert." />}
      </section>

      <section className="dash-section" aria-labelledby="work-title">
        <h2 id="work-title">Arbeit und Teile</h2>
        {data.invoiceIssued && <p className="section-note">Die Rechnung ist ausgestellt; Positionen können nicht mehr geändert werden.</p>}
        {canRecord && (
          <div className="action-list">
            {hourly && (
              <details className="action">
                <summary>Arbeitszeit erfassen</summary>
                <p className="section-note">Abgerechnet nach Tarif „{hourly.display_name}“ ({formatCurrency(hourly.unit_price)} je Stunde).</p>
                <SaveForm action={addWorkEntry} submitLabel="Arbeitszeit speichern" resetOnSuccess>
                  <Context data={data} /><HiddenField name="kind" value="labor" /><HiddenField name="service_rate_id" value={hourly.id} />
                  <div className="form-grid">
                    <TextField name="quantity" label="Stunden" required inputMode="decimal" hint="z. B. 1,5" />
                    <TextField name="description" label="Tätigkeit" required defaultValue="Diagnose und Reparatur vor Ort" />
                  </div>
                </SaveForm>
              </details>
            )}
            {fixed && !hasFixed && (
              <details className="action">
                <summary>Pauschale erfassen</summary>
                <p className="section-note">„{fixed.display_name}“ zu {formatCurrency(fixed.unit_price)}. Die Arbeitszeit steht im Einsatzbericht.</p>
                <SaveForm action={addWorkEntry} submitLabel="Pauschale speichern">
                  <Context data={data} /><HiddenField name="kind" value="fixed_service" /><HiddenField name="service_rate_id" value={fixed.id} /><HiddenField name="quantity" value="1" />
                  <TextField name="description" label="Beschreibung" required defaultValue={fixed.display_name} />
                </SaveForm>
              </details>
            )}
            <details className="action">
              <summary>Teil erfassen</summary>
              <SaveForm action={addWorkEntry} submitLabel="Teil speichern" resetOnSuccess>
                <Context data={data} /><HiddenField name="kind" value="part" />
                <div className="form-grid">
                  <TextField name="description" label="Teil" required />
                  <TextField name="quantity" label="Menge (Stück)" required inputMode="decimal" defaultValue="1" />
                  <TextField name="unit_price" label="Preis je Stück netto (€)" required inputMode="decimal" />
                  <SelectField name="item_status" label="Status" required defaultValue="used" options={[{ value: "used", label: "Verbaut" }, { value: "ordered", label: "Bestellt" }]} />
                </div>
              </SaveForm>
            </details>
          </div>
        )}
        <EntryList data={data} canChange={!requestClosed && !data.invoiceIssued} />
      </section>

      <section className="dash-section" aria-labelledby="photos-title">
        <h2 id="photos-title">Fotos ({data.photos.length})</h2>
        {visit.status !== "cancelled" && !requestClosed && (
          <SaveForm action={uploadPhoto} submitLabel="Foto hochladen" resetOnSuccess>
            <Context data={data} />
            <FileField name="photo" label="Foto" accept="image/jpeg,image/png" required hint="JPEG oder PNG, höchstens 10 MB. Gespeichert im privaten Speicher, sichtbar nur für berechtigte Mitarbeitende." />
          </SaveForm>
        )}
        {data.photos.length === 0 ? (
          <EmptyState title="Noch keine Fotos zu diesem Einsatz." />
        ) : (
          <ul className="photo-grid">
            {data.photos.map((photo) => {
              const href = `/dashboard/anfragen/${request.id}/dokumente/${photo.id}`;
              return (
                <li key={photo.id}>
                  <a href={href} target="_blank" rel="noopener">
                    {/* eslint-disable-next-line @next/next/no-img-element -- private file streamed with the user's rights */}
                    <img src={href} alt={photo.file_name} loading="lazy" />
                  </a>
                  <span className="cell-sub">{photo.file_name} · {formatDateTime(photo.created_at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

// Visit, request and the request version the user saw
function Context({ data }: { data: VisitWorkspace }) {
  return (
    <>
      <HiddenField name="visit_id" value={data.visit.id} />
      <HiddenField name="request_id" value={data.request.id} />
      <HiddenField name="version" value={data.request.version} />
    </>
  );
}

function EntryList({ data, canChange }: { data: VisitWorkspace; canChange: boolean }) {
  const columns: Column<VisitWorkspace["entries"][number]>[] = [
    { key: "description", header: "Position", cell: (entry) => <>{entry.description}{entry.visit_id === data.visit.id && <span className="cell-sub">dieser Einsatz</span>}</>, mobile: "title" },
    { key: "kind", header: "Art", cell: (entry) => label("work_entry_kind", entry.kind) },
    { key: "quantity", header: "Menge", cell: (entry) => `${formatNumber(entry.quantity, entry.unit === "hour" ? 2 : 0)} ${label("work_unit", entry.unit)}`, align: "end" },
    { key: "price", header: "Einzelpreis", cell: (entry) => formatCurrency(entry.unit_price), align: "end" },
    { key: "status", header: "Status", cell: (entry) => <StatusBadge kind="work_item_status" value={entry.item_status} /> },
    {
      key: "change",
      header: "Ändern",
      cell: (entry) => {
        if (!canChange || entry.item_status === "cancelled") return <span className="muted">–</span>;
        return (
          <div className="entry-actions">
            {entry.kind === "part" && entry.item_status === "ordered" && (
              <SaveForm action={setEntryStatus} submitLabel="Als verbaut markieren" submitVariant="secondary">
                <Context data={data} /><HiddenField name="entry_id" value={entry.id} /><HiddenField name="new_status" value="used" />
              </SaveForm>
            )}
            <SaveForm action={setEntryStatus} submitLabel="Stornieren" submitVariant="secondary">
              <Context data={data} /><HiddenField name="entry_id" value={entry.id} /><HiddenField name="new_status" value="cancelled" />
            </SaveForm>
          </div>
        );
      },
    },
  ];
  return <DataTable caption="Arbeitspositionen der Anfrage" columns={columns} rows={data.entries} rowKey={(entry) => entry.id} empty={<EmptyState title="Noch keine Arbeitspositionen." />} />;
}
