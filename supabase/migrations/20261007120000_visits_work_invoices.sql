-- Visits, work entries, invoices and invoice items (spec 5.4-5.7).
-- RLS is enabled without policies (deny by default); policies follow in task-1-5.
-- Child rows reference (id, request_id) pairs so the database guarantees they belong to the same request.

create extension if not exists btree_gist with schema extensions;

-- visits
-- Reserving statuses: scheduled and in_progress block the technician's interval.
-- waiting_parts, completed and cancelled do not reserve (no indefinite calendar blocks).
create table public.visits (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete restrict,
  technician_id uuid not null references public.profiles (id) on delete restrict,
  status public.visit_status not null default 'scheduled',
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  actual_start timestamptz,
  actual_end timestamptz,
  actual_work_minutes integer check (actual_work_minutes >= 0),
  summary text,
  waiting_reason text,
  cancellation_reason text,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint visits_id_request_unique unique (id, request_id),
  constraint visits_scheduled_order check (scheduled_end > scheduled_start),
  constraint visits_actual_order check (actual_end is null or (actual_start is not null and actual_end >= actual_start)),
  constraint visits_started_has_actual_start check (status not in ('in_progress', 'waiting_parts', 'completed') or actual_start is not null),
  constraint visits_completed_has_actual_end check (status <> 'completed' or actual_end is not null),
  constraint visits_waiting_has_reason check (status <> 'waiting_parts' or nullif(btrim(waiting_reason), '') is not null),
  constraint visits_cancelled_has_reason check (status <> 'cancelled' or nullif(btrim(cancellation_reason), '') is not null),

  -- Database guarantee against overlapping active bookings, also under concurrency
  constraint visits_no_overlap exclude using gist (
    technician_id with =,
    tstzrange(scheduled_start, scheduled_end, '[)') with &&
  ) where (status in ('scheduled', 'in_progress'))
);

create index visits_technician_start_idx on public.visits (technician_id, scheduled_start);
create index visits_request_idx on public.visits (request_id);

create trigger visits_set_updated_at
  before update on public.visits
  for each row execute function public.set_updated_at();

alter table public.visits enable row level security;

comment on table public.visits is 'Einsätze. Reservierend sind nur scheduled und in_progress; Überschneidungen pro Techniker verhindert visits_no_overlap.';

-- work_entries
create table public.work_entries (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete restrict,
  visit_id uuid,
  author_id uuid not null references public.profiles (id) on delete restrict,
  kind public.work_entry_kind not null,
  item_status public.work_item_status not null default 'planned',
  service_rate_id uuid references public.service_rates (id) on delete restrict,
  description text not null check (btrim(description) <> ''),
  quantity numeric(12,3) not null check (quantity > 0),
  unit public.work_unit not null,
  unit_price numeric(12,2) not null check (unit_price >= 0),
  tax_rate numeric(5,2) not null check (tax_rate between 0 and 100),
  billable boolean not null default true,
  ordered_at timestamptz,
  performed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint work_entries_id_request_unique unique (id, request_id),
  constraint work_entries_visit_same_request foreign key (visit_id, request_id)
    references public.visits (id, request_id) on delete restrict,
  constraint work_entries_kind_unit check (
    (kind = 'labor' and unit = 'hour')
    or (kind = 'part' and unit = 'piece')
    or (kind = 'fixed_service' and unit = 'service')
  ),
  -- Parts are ordered and used; labor and fixed services are performed
  constraint work_entries_kind_status check (
    (kind = 'part' and item_status in ('planned', 'ordered', 'used', 'cancelled'))
    or (kind in ('labor', 'fixed_service') and item_status in ('planned', 'performed', 'cancelled'))
  ),
  constraint work_entries_ordered_has_timestamp check (item_status <> 'ordered' or ordered_at is not null),
  constraint work_entries_done_has_timestamp check (item_status not in ('performed', 'used') or performed_at is not null)
);

create index work_entries_request_idx on public.work_entries (request_id);
create index work_entries_visit_idx on public.work_entries (visit_id);

create trigger work_entries_set_updated_at
  before update on public.work_entries
  for each row execute function public.set_updated_at();

alter table public.work_entries enable row level security;

comment on table public.work_entries is 'Arbeitszeit, Teile und Pauschalen. Abrechenbar sind nur billable performed-Leistungen und used-Teile.';

-- invoices
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.requests (id) on delete restrict,
  invoice_number text unique check (invoice_number is null or btrim(invoice_number) <> ''),
  status public.invoice_status not null default 'draft',
  created_by uuid not null references public.profiles (id) on delete restrict,
  issued_by uuid references public.profiles (id) on delete restrict,
  issue_date date,
  payment_due_date date,
  issued_at timestamptz,
  sent_at timestamptz,
  paid_at timestamptz,
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  tax_total numeric(12,2) not null default 0 check (tax_total >= 0),
  total numeric(12,2) not null default 0,
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  seller_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(seller_snapshot) = 'object'),
  customer_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(customer_snapshot) = 'object'),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint invoices_id_request_unique unique (id, request_id),
  constraint invoices_total_sum check (total = subtotal + tax_total),
  -- Issue details exist exactly from issue onwards
  constraint invoices_issue_details check (
    (status = 'draft'
      and invoice_number is null and issued_by is null and issued_at is null
      and issue_date is null and payment_due_date is null and sent_at is null and paid_at is null)
    or (status <> 'draft'
      and invoice_number is not null and issued_by is not null and issued_at is not null
      and issue_date is not null and payment_due_date is not null)
  ),
  constraint invoices_due_after_issue check (payment_due_date is null or payment_due_date >= issue_date),
  constraint invoices_sent_has_timestamp check (status <> 'sent' or sent_at is not null),
  constraint invoices_paid_has_timestamp check ((status = 'paid') = (paid_at is not null))
);

create index invoices_status_idx on public.invoices (status);
create index invoices_issue_date_idx on public.invoices (issue_date);
create index invoices_payment_due_date_idx on public.invoices (payment_due_date);
create index invoices_paid_at_idx on public.invoices (paid_at);

create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

alter table public.invoices enable row level security;

comment on table public.invoices is 'Eine Rechnung je Anfrage. Musterrechnung / Demodaten, nicht rechtlich oder steuerlich verbindlich.';

-- invoice_items
-- Rounding rule: net = round(quantity * unit_price, 2), tax = round(net * tax_rate / 100, 2), gross = net + tax.
create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  work_entry_id uuid unique references public.work_entries (id) on delete restrict,
  position integer not null check (position >= 1),
  kind public.work_entry_kind not null,
  description text not null check (btrim(description) <> ''),
  unit public.work_unit not null,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  tax_rate numeric(5,2) not null check (tax_rate between 0 and 100),
  net_amount numeric(12,2) not null,
  tax_amount numeric(12,2) not null,
  gross_amount numeric(12,2) not null,
  created_at timestamptz not null default now(),

  constraint invoice_items_position_unique unique (invoice_id, position),
  constraint invoice_items_kind_unit check (
    (kind = 'labor' and unit = 'hour')
    or (kind = 'part' and unit = 'piece')
    or (kind = 'fixed_service' and unit = 'service')
  ),
  constraint invoice_items_rounding check (
    net_amount = round(quantity * unit_price, 2)
    and tax_amount = round(net_amount * tax_rate / 100, 2)
    and gross_amount = net_amount + tax_amount
  )
);

create index invoice_items_invoice_idx on public.invoice_items (invoice_id);

alter table public.invoice_items enable row level security;

comment on table public.invoice_items is 'Rechnungspositionen als Snapshot. work_entry_id UNIQUE verhindert Doppelabrechnung.';

-- An invoice item may only bill a work entry of the invoice's own request.
create function public.check_invoice_item_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.work_entry_id is not null and not exists (
    select 1
    from public.invoices i
    join public.work_entries w on w.request_id = i.request_id
    where i.id = new.invoice_id and w.id = new.work_entry_id
  ) then
    raise exception 'Arbeitsposition gehört nicht zur Anfrage der Rechnung'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger invoice_items_check_request
  before insert or update on public.invoice_items
  for each row execute function public.check_invoice_item_request();

-- Deferred foreign keys from task-1-2 and task-1-3, now as same-request pairs
alter table public.request_events
  add constraint request_events_visit_same_request foreign key (visit_id, request_id)
    references public.visits (id, request_id) on delete restrict;

alter table public.messages
  add constraint messages_invoice_needs_request check (invoice_id is null or request_id is not null),
  add constraint messages_invoice_same_request foreign key (invoice_id, request_id)
    references public.invoices (id, request_id) on delete restrict;

alter table public.attachments
  add constraint attachments_child_parent_needs_request check ((visit_id is null and invoice_id is null) or request_id is not null),
  add constraint attachments_visit_same_request foreign key (visit_id, request_id)
    references public.visits (id, request_id) on delete restrict,
  add constraint attachments_invoice_same_request foreign key (invoice_id, request_id)
    references public.invoices (id, request_id) on delete restrict;

create index request_events_visit_idx on public.request_events (visit_id);
