import { completeIntake, correctAnalysis, createDraft, markAwaitingCustomer, queueDraft, rejectRequest, updateDraft } from "@/app/(dashboard)/dashboard/anfragen/[id]/actions";
import { HiddenField, SaveForm, SelectField, TextAreaField, TextField } from "@/components/dashboard/ui/save-form";
import type { Employee } from "@/lib/auth/session";
import type { RequestDetail } from "@/lib/dashboard/requests";
import { LABELS, STATUS, statusInfo } from "@/lib/status";

// Which review actions are possible; the database operations enforce the same rules again.
export function availableActions(detail: RequestDetail, role: Employee["role"]) {
  const r = detail.request;
  const staff = role !== "technician";
  const terminal = ["rejected", "cancelled"].includes(r.intake_status) || ["completed", "cancelled"].includes(r.work_status);
  const openIntake = ["new", "analyzing", "needs_review"].includes(r.intake_status);
  return {
    complete: staff && openIntake,
    correct: staff && !terminal,
    email: staff && !terminal,
    await: staff && openIntake,
    reject: staff && !["rejected", "cancelled"].includes(r.intake_status) && ["not_planned", "scheduled"].includes(r.work_status),
  };
}

const priorityOptions = Object.entries(STATUS.request_priority).map(([value, info]) => ({ value, label: info.label }));
const serviceOptions = Object.entries(LABELS.service_kind).map(([value, text]) => ({ value, label: text }));

function Context({ detail }: { detail: RequestDetail }) {
  return (
    <>
      <HiddenField name="request_id" value={detail.request.id} />
      <HiddenField name="version" value={detail.request.version} />
    </>
  );
}

export function RequestActions({ detail, employee }: { detail: RequestDetail; employee: Employee }) {
  const r = detail.request;
  const can = availableActions(detail, employee.role);
  const lastRun = [...(detail.automationRuns ?? [])].reverse().find((run) => run.status === "succeeded" && !run.corrected_at && ["intake_analysis", "reply_analysis"].includes(run.step));
  const subject = `Rückfrage zu Ihrer Serviceanfrage ${r.request_number}`;
  const body = `Guten Tag ${r.contact_name},\n\nvielen Dank für Ihre Anfrage ${r.request_number}. Für die Planung des Einsatzes benötigen wir noch folgende Angaben:\n\n- \n\nMit freundlichen Grüßen\n${employee.displayName}\nRheinWerk Industrieservice`;

  return (
    <div className="action-list">
      {can.complete && (
        <details className="action" open={r.intake_status === "needs_review"}>
          <summary>Prüfen und freigeben</summary>
          <p className="section-note">Schließt die Erstbearbeitung ab. Die Anfrage erscheint danach unter „Einsatzplanung erforderlich“.</p>
          <SaveForm action={completeIntake} submitLabel="Erstbearbeitung abschließen">
            <Context detail={detail} />
            <div className="form-grid">
              <SelectField name="priority" label="Priorität" required defaultValue={r.priority ?? ""} options={priorityOptions} />
            </div>
            <TextAreaField name="note" label="Notiz für den Verlauf" rows={2} />
          </SaveForm>
        </details>
      )}
      {can.correct && (
        <details className="action">
          <summary>Analyse korrigieren</summary>
          <p className="section-note">
            Für falsche automatische oder frühere Einstufungen. Die Korrektur wird im Verlauf festgehalten
            {lastRun ? " und der letzte Automatisierungslauf als korrigiert markiert (zählt nicht als Zeitersparnis)" : ""}.
          </p>
          <SaveForm action={correctAnalysis} submitLabel="Korrektur speichern">
            <Context detail={detail} />
            <HiddenField name="current_priority" value={r.priority ?? ""} />
            <HiddenField name="current_service_kind" value={r.service_kind} />
            {lastRun && <HiddenField name="automation_run_id" value={lastRun.id} />}
            <div className="form-grid">
              <SelectField name="priority" label={`Priorität (aktuell: ${r.priority ? statusInfo("request_priority", r.priority).label : "offen"})`} defaultValue={r.priority ?? ""} options={priorityOptions} />
              <SelectField name="service_kind" label="Leistungsart" required defaultValue={r.service_kind} options={serviceOptions} />
            </div>
            <TextAreaField name="reason" label="Grund der Korrektur" required rows={2} />
          </SaveForm>
        </details>
      )}
      {can.email && (
        <details className="action">
          <summary>E-Mail an Kunden vorbereiten</summary>
          <p className="section-note">Erstellt einen Entwurf. Versendet wird nichts: Erst nach „In Warteschlange stellen“ unter Korrespondenz übernimmt die spätere Integration den Versand.</p>
          <SaveForm action={createDraft} submitLabel="Als Entwurf speichern">
            <Context detail={detail} />
            <div className="form-grid">
              <SelectField name="kind" label="Art" required defaultValue="clarification" options={[{ value: "clarification", label: "Rückfrage" }, { value: "other", label: "Sonstige Nachricht" }]} />
              <TextField name="to_address" label="Empfänger" type="email" required defaultValue={r.business_email} />
            </div>
            <TextField name="subject" label="Betreff" required defaultValue={subject} />
            <TextAreaField name="body_text" label="Text" required rows={8} defaultValue={body} />
          </SaveForm>
        </details>
      )}
      {can.await && (
        <details className="action">
          <summary>Auf Kundenantwort warten</summary>
          <p className="section-note">Setzt die Erstbearbeitung auf „Wartet auf Kunde“, z. B. nachdem eine Rückfrage in die Warteschlange gestellt wurde.</p>
          <SaveForm action={markAwaitingCustomer} submitLabel="Status setzen" submitVariant="secondary">
            <Context detail={detail} />
            <TextAreaField name="note" label="Notiz für den Verlauf" rows={2} />
          </SaveForm>
        </details>
      )}
      {can.reject && (
        <details className="action action--danger">
          <summary>Anfrage ablehnen</summary>
          <p className="section-note">Nur vor Arbeitsbeginn möglich. Geplante Einsätze werden storniert. Der Kunde wird nicht automatisch benachrichtigt.</p>
          <SaveForm action={rejectRequest} submitLabel="Anfrage ablehnen" submitVariant="danger">
            <Context detail={detail} />
            <TextAreaField name="reason" label="Ablehnungsgrund" required rows={3} />
          </SaveForm>
        </details>
      )}
    </div>
  );
}

// Editing and queueing of a draft in the correspondence section
export function DraftActions({ detail, message }: { detail: RequestDetail; message: NonNullable<RequestDetail["messages"]>[number] }) {
  return (
    <div className="draft-actions">
      <SaveForm action={updateDraft} submitLabel="Entwurf speichern" submitVariant="secondary">
        <Context detail={detail} />
        <HiddenField name="message_id" value={message.id} />
        <TextField name="to_address" label="Empfänger" type="email" required defaultValue={message.to_address ?? ""} />
        <TextField name="subject" label="Betreff" required defaultValue={message.subject} />
        <TextAreaField name="body_text" label="Text" required rows={8} defaultValue={message.body_text} />
      </SaveForm>
      <SaveForm action={queueDraft} submitLabel="In Warteschlange stellen">
        <Context detail={detail} />
        <HiddenField name="message_id" value={message.id} />
        <p className="section-note">Gibt den Entwurf für den Versand frei. Die Nachricht gilt erst als versendet, wenn die Integration den Versand bestätigt.</p>
      </SaveForm>
    </div>
  );
}
