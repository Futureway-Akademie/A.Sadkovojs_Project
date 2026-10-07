-- Messages, automation runs and attachments (spec 5.3, 5.8, 5.10).
-- RLS is enabled without policies (deny by default); policies follow in task-1-5.
-- FKs to visits and invoices are added in task-1-4 together with those tables.

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.requests (id) on delete restrict,
  inbox_dispatcher_id uuid references public.profiles (id) on delete restrict,
  invoice_id uuid, -- FK to invoices is added in task-1-4
  direction public.message_direction not null,
  kind public.message_kind not null,
  status public.message_status not null,
  from_address text,
  to_address text,
  subject text not null,
  body_text text not null,
  mailbox_key text,
  gmail_message_id text,
  gmail_thread_id text,
  mime_message_id text,
  in_reply_to text,
  references_header text[],
  author_id uuid references public.profiles (id) on delete restrict,
  approved_by uuid references public.profiles (id) on delete restrict,
  received_at timestamptz,
  sent_at timestamptz,
  approved_at timestamptz,
  handled_at timestamptz,
  error_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Either linked to a request or parked in a dispatcher's inbox; outgoing always needs a request
  constraint messages_has_owner check (request_id is not null or inbox_dispatcher_id is not null),
  constraint messages_outgoing_has_request check (direction <> 'outgoing' or request_id is not null),

  -- Direction, status and timestamps
  constraint messages_incoming_fields check (
    direction <> 'incoming' or (
      status = 'received'
      and received_at is not null
      and nullif(btrim(from_address), '') is not null
      and kind in ('customer_reply', 'other')
    )
  ),
  constraint messages_outgoing_fields check (
    direction <> 'outgoing' or (
      status in ('draft', 'queued', 'sent', 'failed')
      and received_at is null
      and nullif(btrim(to_address), '') is not null
      and kind in ('receipt', 'clarification', 'invoice', 'other')
    )
  ),
  constraint messages_sent_has_timestamp check ((status = 'sent') = (sent_at is not null)),
  constraint messages_failed_has_error check (status <> 'failed' or nullif(btrim(error_text), '') is not null),
  constraint messages_approval_pair check ((approved_by is null) = (approved_at is null)),
  constraint messages_invoice_kind check (kind <> 'invoice' or invoice_id is not null),

  -- Gmail identifiers are only meaningful within a mailbox
  constraint messages_gmail_needs_mailbox check (gmail_message_id is null or mailbox_key is not null),
  constraint messages_mailbox_gmail_unique unique (mailbox_key, gmail_message_id)
);

create index messages_request_idx on public.messages (request_id);
create index messages_inbox_dispatcher_idx on public.messages (inbox_dispatcher_id) where request_id is null;
create index messages_mailbox_thread_idx on public.messages (mailbox_key, gmail_thread_id);
create index messages_mime_message_idx on public.messages (mime_message_id);
create index messages_invoice_idx on public.messages (invoice_id);

create trigger messages_set_updated_at
  before update on public.messages
  for each row execute function public.set_updated_at();

alter table public.messages enable row level security;

comment on table public.messages is 'E-Mails je Anfrage oder unzugeordnet im Posteingang eines Dispatchers. queued bedeutet keinen bestätigten Versand.';

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.requests (id) on delete restrict,
  message_id uuid references public.messages (id) on delete restrict,
  operation_key text not null unique check (btrim(operation_key) <> ''),
  workflow_execution_id text,
  step public.automation_step not null,
  input_version integer check (input_version >= 1),
  status public.automation_status not null default 'running',
  decision public.automation_decision,
  confidence numeric(5,4) check (confidence between 0 and 1),
  result jsonb check (result is null or jsonb_typeof(result) = 'object'),
  error_code text,
  error_text text,
  corrected_by uuid references public.profiles (id) on delete restrict,
  corrected_at timestamptz,
  correction_reason text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint automation_runs_finished_when_terminal check ((status = 'running') = (finished_at is null)),
  constraint automation_runs_finished_after_start check (finished_at is null or finished_at >= started_at),
  constraint automation_runs_failed_has_error check (status <> 'failed' or nullif(btrim(error_code), '') is not null),
  constraint automation_runs_decision_when_succeeded check (decision is null or status = 'succeeded'),
  constraint automation_runs_decision_matches_step check (
    decision is null
    or (step in ('intake_analysis', 'reply_analysis') and decision in ('ready_for_planning', 'ask_customer', 'human_review'))
    or (step = 'email_matching' and decision in ('matched', 'unmatched'))
    or (step = 'email_send' and decision = 'sent')
  ),
  constraint automation_runs_correction_complete check (
    (corrected_by is null and corrected_at is null and correction_reason is null)
    or (corrected_by is not null and corrected_at is not null and nullif(btrim(correction_reason), '') is not null)
  ),
  -- Only email matching may run without a request
  constraint automation_runs_request_required check (request_id is not null or step = 'email_matching')
);

create index automation_runs_request_idx on public.automation_runs (request_id, started_at);
create index automation_runs_message_idx on public.automation_runs (message_id);
create index automation_runs_step_status_idx on public.automation_runs (step, status);

create trigger automation_runs_set_updated_at
  before update on public.automation_runs
  for each row execute function public.set_updated_at();

alter table public.automation_runs enable row level security;

comment on table public.automation_runs is 'Technische Ergebnisse der Automatisierung (künftig n8n). Gleicher operation_key = dieselbe Operation (Idempotenz).';

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.requests (id) on delete restrict,
  message_id uuid references public.messages (id) on delete restrict,
  visit_id uuid, -- FK to visits is added in task-1-4
  invoice_id uuid, -- FK to invoices is added in task-1-4
  bucket text not null check (btrim(bucket) <> ''),
  storage_path text not null check (btrim(storage_path) <> ''),
  file_name text not null check (btrim(file_name) <> ''),
  mime_type text not null check (btrim(mime_type) <> ''),
  size_bytes bigint not null check (size_bytes > 0),
  uploaded_by uuid references public.profiles (id) on delete restrict,
  visibility public.visibility_level not null default 'operational',
  created_at timestamptz not null default now(),

  constraint attachments_has_parent check (num_nonnulls(request_id, message_id, visit_id, invoice_id) >= 1),
  constraint attachments_storage_unique unique (bucket, storage_path)
);

create index attachments_request_idx on public.attachments (request_id);
create index attachments_message_idx on public.attachments (message_id);
create index attachments_visit_idx on public.attachments (visit_id);
create index attachments_invoice_idx on public.attachments (invoice_id);

alter table public.attachments enable row level security;

comment on table public.attachments is 'Dateimetadaten (privater Storage). Alle Elternreferenzen gehören zur selben Anfrage.';

-- All parents of an attachment must belong to the same request.
-- An attachment of an unmatched incoming message carries only message_id.
-- Extended with visits and invoices in task-1-4.
create function public.check_attachment_parents()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  message_request uuid;
begin
  if new.message_id is not null then
    select m.request_id into message_request from public.messages m where m.id = new.message_id;

    if message_request is null then
      if num_nonnulls(new.request_id, new.visit_id, new.invoice_id) > 0 then
        raise exception 'Anhang einer nicht zugeordneten Nachricht darf nur message_id enthalten'
          using errcode = 'check_violation';
      end if;
    elsif new.request_id is distinct from message_request then
      raise exception 'Anhang und Nachricht gehören nicht zur selben Anfrage'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.request_id is null and new.message_id is null then
    raise exception 'Anhang benötigt request_id (Einsatz und Rechnung allein genügen nicht)'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger attachments_check_parents
  before insert or update on public.attachments
  for each row execute function public.check_attachment_parents();
