import { recordPayment } from "@/app/(dashboard)/dashboard/anfragen/[id]/actions";
import { HiddenField, SaveForm, TextField } from "@/components/dashboard/ui/save-form";

// "Zahlung erfassen" for issued invoices (task-10-3): on the request page and in the invoice list.
// Uses the request version as expected_version, like every invoice operation.
export function PaymentForm({ requestId, version, invoiceId, today, primary = false }: { requestId: string; version: number; invoiceId: string; today: string; primary?: boolean }) {
  return (
    <SaveForm action={recordPayment} submitLabel="Zahlung erfassen" submitVariant={primary ? "primary" : "secondary"}>
      <HiddenField name="request_id" value={requestId} />
      <HiddenField name="version" value={version} />
      <HiddenField name="invoice_id" value={invoiceId} />
      <TextField name="paid_on" label="Zahlungseingang am" type="date" required defaultValue={today} hint="Zwischen Rechnungsdatum und heute." />
    </SaveForm>
  );
}
