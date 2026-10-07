-- Controlled operations for invoices, payments, the outgoing e-mail queue and manual message linking
-- (spec 5.3, 5.6, 5.7, 6, 8).
--
-- * expected_version refers to requests.version; every change increments it.
-- * A draft invoice is a preview. Issuing rebuilds its items from the eligible work entries and freezes it.
-- * Issued invoices are immutable (trigger, applies to every role); only status, sent_at and paid_at move on.
-- * Queueing an e-mail never sets sent, paid or first_substantive_response_at. Confirmed delivery is a later
--   integration step (n8n/Gmail, not part of this stage).

-- Invoice numbers RE-YYYY-NNNNN, counter per calendar year (Europe/Berlin)
create table public.invoice_number_counters (
  year integer primary key check (year between 2000 and 9999),
  last_value integer not null check (last_value > 0)
);

alter table public.invoice_number_counters enable row level security;
revoke all on public.invoice_number_counters from anon, authenticated;

comment on table public.invoice_number_counters is 'Zähler je Kalenderjahr für RE-JJJJ-NNNNN; nur über private.next_invoice_number().';

create function private.next_invoice_number(issue_year integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_value integer;
begin
  insert into public.invoice_number_counters as c (year, last_value)
  values (issue_year, 1)
  on conflict (year) do update set last_value = c.last_value + 1
  returning c.last_value into next_value;

  if next_value > 99999 then
    raise exception 'Rechnungsnummern für % erschöpft', issue_year;
  end if;
  return format('RE-%s-%s', issue_year, lpad(next_value::text, 5, '0'));
end;
$$;

-- Issued invoices: contents frozen, status only moves forward
create function public.guard_invoice_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' then
    if (new.request_id, new.invoice_number, new.created_by, new.issued_by, new.issue_date, new.payment_due_date,
        new.issued_at, new.subtotal, new.tax_total, new.total, new.currency, new.seller_snapshot,
        new.customer_snapshot, new.notes, new.created_at)
       is distinct from
       (old.request_id, old.invoice_number, old.created_by, old.issued_by, old.issue_date, old.payment_due_date,
        old.issued_at, old.subtotal, old.tax_total, old.total, old.currency, old.seller_snapshot,
        old.customer_snapshot, old.notes, old.created_at) then
      raise exception 'Ausgestellte Rechnungen sind unveränderlich' using errcode = 'check_violation';
    end if;

    if new.status <> old.status and (old.status, new.status) not in (('issued', 'sent'), ('issued', 'paid'), ('sent', 'paid')) then
      raise exception 'Rechnungsstatus % → % ist nicht erlaubt', old.status, new.status using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger invoices_guard_update
  before update on public.invoices
  for each row execute function public.guard_invoice_update();

create function public.guard_invoice_items()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.invoices i
    where i.id = case when tg_op = 'INSERT' then new.invoice_id else old.invoice_id end
      and i.status <> 'draft'
  ) then
    raise exception 'Positionen ausgestellter Rechnungen sind unveränderlich' using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger invoice_items_guard
  before insert or update or delete on public.invoice_items
  for each row execute function public.guard_invoice_items();

-- Work entries are locked once their invoice is issued (drafts are previews)
create or replace function private.lock_work_entry(target_entry_id uuid, expected_version integer, out req public.requests, out entry public.work_entries)
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry_request_id uuid;
begin
  select w.request_id into entry_request_id from public.work_entries w where w.id = target_entry_id;
  if entry_request_id is null then
    raise exception 'Arbeitsposition nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;

  req := private.lock_request(entry_request_id, expected_version);
  select * into entry from public.work_entries w where w.id = target_entry_id for update;

  perform private.require_work_entry_actor(req, entry.visit_id);
  perform private.require_request_open_for_work(req);

  if exists (
    select 1 from public.invoices i
    where i.request_id = entry_request_id and i.status <> 'draft'
  ) then
    raise exception 'Die Anfrage ist abgerechnet; Arbeitspositionen sind gesperrt' using errcode = 'RW422';
  end if;
end;
$$;

-- New entries are also blocked once the request is invoiced
create or replace function private.require_request_open_for_work(req public.requests)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if req.intake_status in ('rejected', 'cancelled') or req.work_status = 'cancelled' then
    raise exception 'Für abgelehnte oder stornierte Anfragen werden keine Arbeitspositionen erfasst' using errcode = 'RW422';
  end if;
  if exists (select 1 from public.invoices i where i.request_id = req.id and i.status <> 'draft') then
    raise exception 'Die Anfrage ist abgerechnet; Arbeitspositionen sind gesperrt' using errcode = 'RW422';
  end if;
end;
$$;

-- Only the current technician or managers/admins create and issue invoices
create function private.require_invoice_actor(req public.requests)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.current_employee_role() in ('manager', 'admin') or private.is_current_technician(req.id) then
    return;
  end if;
  raise exception 'Nur der aktuelle Techniker oder Manager/Admin erstellt Rechnungen' using errcode = '42501';
end;
$$;

-- Rebuilds the items of a draft from eligible entries and recalculates totals.
-- Eligible: billable and (performed labor/fixed service or used parts). Nothing is added automatically,
-- in particular no hourly charges on top of a fixed maintenance price.
-- Rounding: net = round(quantity * unit_price, 2), tax = round(net * tax_rate / 100, 2), gross = net + tax.
create function private.rebuild_invoice_items(target_invoice_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices;
  item_count integer;
begin
  select * into inv from public.invoices i where i.id = target_invoice_id;

  delete from public.invoice_items it where it.invoice_id = inv.id;

  insert into public.invoice_items (
    invoice_id, work_entry_id, position, kind, description, unit, quantity, unit_price, tax_rate,
    net_amount, tax_amount, gross_amount)
  select inv.id, w.id, row_number() over (order by w.created_at, w.id), w.kind, w.description, w.unit,
    w.quantity, w.unit_price, w.tax_rate, n.net, round(n.net * w.tax_rate / 100, 2), n.net + round(n.net * w.tax_rate / 100, 2)
  from public.work_entries w
  cross join lateral (select round(w.quantity * w.unit_price, 2) as net) n
  where w.request_id = inv.request_id
    and w.billable
    and ((w.kind in ('labor', 'fixed_service') and w.item_status = 'performed') or (w.kind = 'part' and w.item_status = 'used'));

  get diagnostics item_count = row_count;

  update public.invoices i
  set subtotal = coalesce(t.net, 0), tax_total = coalesce(t.tax, 0), total = coalesce(t.net, 0) + coalesce(t.tax, 0)
  from (select sum(it.net_amount) as net, sum(it.tax_amount) as tax from public.invoice_items it where it.invoice_id = inv.id) t
  where i.id = inv.id;

  return item_count;
end;
$$;

create function private.lock_invoice(target_invoice_id uuid, expected_version integer, out req public.requests, out inv public.invoices)
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice_request_id uuid;
begin
  select i.request_id into invoice_request_id from public.invoices i where i.id = target_invoice_id;
  if invoice_request_id is null then
    raise exception 'Rechnung nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;

  req := private.lock_request(invoice_request_id, expected_version);
  select * into inv from public.invoices i where i.id = target_invoice_id for update;
end;
$$;

-- Create the draft invoice of a completed request; returns the existing invoice if there is one
create function public.create_invoice(request_id uuid, expected_version integer)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  result public.invoices;
  currency_code text;
begin
  perform private.require_role('technician', 'manager', 'admin');
  req := private.lock_request(create_invoice.request_id, create_invoice.expected_version);
  perform private.require_invoice_actor(req);

  select * into result from public.invoices i where i.request_id = req.id;
  if found then
    return result;
  end if;

  if req.work_status <> 'completed' or req.intake_status <> 'processed' then
    raise exception 'Rechnungen nur für technisch abgeschlossene Anfragen' using errcode = 'RW422';
  end if;

  select s.currency into currency_code from public.settings s where s.id = 1;

  insert into public.invoices (request_id, created_by, currency)
  values (req.id, (select auth.uid()), coalesce(currency_code, 'EUR'))
  returning * into result;

  perform private.rebuild_invoice_items(result.id);
  select * into result from public.invoices i where i.id = result.id;

  update public.requests r set updated_at = now() where r.id = req.id;
  perform private.log_request_event(req.id, 'invoice_created', null, 'draft', null,
    jsonb_build_object('invoice_id', result.id, 'total', result.total));
  return result;
end;
$$;

-- Issue the invoice: final items, atomic number, snapshots. Repeating returns the issued invoice.
create function public.issue_invoice(invoice_id uuid, expected_version integer)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked record;
  result public.invoices;
  cfg public.settings;
  local_issue_date date;
  item_count integer;
begin
  perform private.require_role('technician', 'manager', 'admin');
  locked := private.lock_invoice(issue_invoice.invoice_id, issue_invoice.expected_version);
  perform private.require_invoice_actor(locked.req);

  if (locked.inv).status <> 'draft' then
    return locked.inv;
  end if;

  if (locked.req).work_status <> 'completed' or (locked.req).intake_status <> 'processed' then
    raise exception 'Rechnungen nur für technisch abgeschlossene Anfragen' using errcode = 'RW422';
  end if;

  item_count := private.rebuild_invoice_items((locked.inv).id);
  if item_count = 0 then
    raise exception 'Keine abrechenbaren Positionen vorhanden' using errcode = 'RW422';
  end if;

  select * into cfg from public.settings s where s.id = 1;
  local_issue_date := (now() at time zone coalesce(cfg.timezone, 'Europe/Berlin'))::date;

  update public.invoices i
  set status = 'issued',
      invoice_number = private.next_invoice_number(extract(year from local_issue_date)::integer),
      issued_by = (select auth.uid()),
      issued_at = now(),
      issue_date = local_issue_date,
      payment_due_date = local_issue_date + coalesce(cfg.payment_terms_days, 14),
      seller_snapshot = coalesce(cfg.company_details, '{}'::jsonb)
        || jsonb_build_object('currency', coalesce(cfg.currency, 'EUR'), 'payment_terms_days', coalesce(cfg.payment_terms_days, 14)),
      customer_snapshot = jsonb_build_object(
        'company_name', (locked.req).company_name,
        'contact_name', (locked.req).contact_name,
        'business_email', (locked.req).business_email,
        'phone_number', (locked.req).phone_number,
        'customer_number', (locked.req).customer_number,
        'street_house_number', (locked.req).street_house_number,
        'postal_code', (locked.req).postal_code,
        'city', (locked.req).city,
        'site_label', (locked.req).site_label,
        'request_number', (locked.req).request_number)
  where i.id = (locked.inv).id
  returning * into result;

  update public.requests r set updated_at = now() where r.id = (locked.req).id;
  perform private.log_request_event((locked.req).id, 'invoice_issued', 'draft', 'issued', null,
    jsonb_build_object('invoice_id', result.id, 'invoice_number', result.invoice_number, 'total', result.total, 'items', item_count));
  return result;
end;
$$;

-- Record a payment (manager/admin only). Repeating returns the paid invoice.
create function public.record_payment(invoice_id uuid, expected_version integer, paid_at timestamptz default null)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked record;
  result public.invoices;
  payment_time timestamptz := coalesce(record_payment.paid_at, now());
begin
  perform private.require_role('manager', 'admin');
  locked := private.lock_invoice(record_payment.invoice_id, record_payment.expected_version);

  if (locked.inv).status = 'paid' then
    return locked.inv;
  end if;

  if (locked.inv).status not in ('issued', 'sent') then
    raise exception 'Nur ausgestellte Rechnungen können bezahlt werden' using errcode = 'RW422';
  end if;

  if payment_time > now() or payment_time < (locked.inv).issued_at then
    raise exception 'Zahlungsdatum muss zwischen Ausstellung und jetzt liegen' using errcode = 'RW422';
  end if;

  update public.invoices i set status = 'paid', paid_at = payment_time
  where i.id = (locked.inv).id returning * into result;

  update public.requests r set updated_at = now() where r.id = (locked.req).id;
  perform private.log_request_event((locked.req).id, 'invoice_paid', (locked.inv).status::text, 'paid', null,
    jsonb_build_object('invoice_id', result.id, 'invoice_number', result.invoice_number, 'paid_at', result.paid_at, 'total', result.total),
    'management');
  return result;
end;
$$;

-- Outgoing e-mail drafts (dispatcher of the request, manager, admin)
create function public.create_message_draft(
  request_id uuid,
  expected_version integer,
  kind public.message_kind,
  to_address text,
  subject text,
  body_text text,
  invoice_id uuid default null
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  result public.messages;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  req := private.lock_request(create_message_draft.request_id, create_message_draft.expected_version);

  if create_message_draft.kind not in ('receipt', 'clarification', 'invoice', 'other') then
    raise exception 'Art % ist für ausgehende Nachrichten nicht zulässig', create_message_draft.kind using errcode = 'RW422';
  end if;
  if nullif(btrim(create_message_draft.to_address), '') is null
     or nullif(btrim(create_message_draft.subject), '') is null
     or nullif(btrim(create_message_draft.body_text), '') is null then
    raise exception 'Empfänger, Betreff und Text sind erforderlich' using errcode = 'RW422';
  end if;
  if create_message_draft.kind = 'invoice' and not exists (
    select 1 from public.invoices i
    where i.id = create_message_draft.invoice_id and i.request_id = req.id and i.status <> 'draft'
  ) then
    raise exception 'Rechnungsversand nur mit ausgestellter Rechnung dieser Anfrage' using errcode = 'RW422';
  end if;
  if create_message_draft.kind <> 'invoice' and create_message_draft.invoice_id is not null then
    raise exception 'Rechnungsbezug nur bei Art invoice' using errcode = 'RW422';
  end if;

  insert into public.messages (request_id, invoice_id, direction, kind, status, to_address, subject, body_text, author_id)
  values (req.id, create_message_draft.invoice_id, 'outgoing', create_message_draft.kind, 'draft',
    btrim(create_message_draft.to_address), btrim(create_message_draft.subject), create_message_draft.body_text, (select auth.uid()))
  returning * into result;

  update public.requests r set updated_at = now() where r.id = req.id;
  perform private.log_request_event(req.id, 'message_drafted', null, 'draft', null,
    jsonb_build_object('message_id', result.id, 'kind', result.kind), 'dispatch');
  return result;
end;
$$;

create function private.lock_outgoing_message(target_message_id uuid, expected_version integer, out req public.requests, out msg public.messages)
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_request_id uuid;
begin
  select m.request_id into message_request_id from public.messages m where m.id = target_message_id and m.direction = 'outgoing';
  if message_request_id is null then
    raise exception 'Nachricht nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;

  req := private.lock_request(message_request_id, expected_version);
  select * into msg from public.messages m where m.id = target_message_id for update;

  if not private.can_read_message(target_message_id) then
    raise exception 'Nachricht nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;
end;
$$;

create function public.update_message_draft(
  message_id uuid,
  expected_version integer,
  to_address text default null,
  subject text default null,
  body_text text default null
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked record;
  result public.messages;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  locked := private.lock_outgoing_message(update_message_draft.message_id, update_message_draft.expected_version);

  if (locked.msg).status <> 'draft' then
    raise exception 'Nur Entwürfe können bearbeitet werden' using errcode = 'RW422';
  end if;
  if (update_message_draft.to_address is not null and btrim(update_message_draft.to_address) = '')
     or (update_message_draft.subject is not null and btrim(update_message_draft.subject) = '')
     or (update_message_draft.body_text is not null and btrim(update_message_draft.body_text) = '') then
    raise exception 'Empfänger, Betreff und Text dürfen nicht leer sein' using errcode = 'RW422';
  end if;

  update public.messages m
  set to_address = coalesce(btrim(update_message_draft.to_address), m.to_address),
      subject = coalesce(btrim(update_message_draft.subject), m.subject),
      body_text = coalesce(update_message_draft.body_text, m.body_text)
  where m.id = (locked.msg).id
  returning * into result;

  update public.requests r set updated_at = now() where r.id = (locked.req).id;
  return result;
end;
$$;

-- Approve and queue a draft. No delivery, no sent/paid/first-response timestamps.
create function public.queue_message(message_id uuid, expected_version integer)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked record;
  result public.messages;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  locked := private.lock_outgoing_message(queue_message.message_id, queue_message.expected_version);

  if (locked.msg).status = 'queued' then
    return locked.msg;
  end if;
  if (locked.msg).status <> 'draft' then
    raise exception 'Nur Entwürfe können in die Warteschlange gestellt werden' using errcode = 'RW422';
  end if;

  update public.messages m
  set status = 'queued', approved_by = (select auth.uid()), approved_at = now()
  where m.id = (locked.msg).id
  returning * into result;

  update public.requests r set updated_at = now() where r.id = (locked.req).id;
  perform private.log_request_event((locked.req).id, 'message_queued', 'draft', 'queued', null,
    jsonb_build_object('message_id', result.id, 'kind', result.kind, 'invoice_id', result.invoice_id), 'dispatch');
  return result;
end;
$$;

-- Manually link an unmatched incoming message to a request the caller can access
create function public.link_message(message_id uuid, request_id uuid, expected_version integer)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  msg public.messages;
  result public.messages;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');

  select * into msg from public.messages m where m.id = link_message.message_id for update;
  if not found or not private.can_read_message(msg.id) then
    raise exception 'Nachricht nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;
  if msg.request_id is not null or msg.direction <> 'incoming' then
    raise exception 'Nur unzugeordnete eingehende Nachrichten können verknüpft werden' using errcode = 'RW422';
  end if;

  req := private.lock_request(link_message.request_id, link_message.expected_version);

  update public.messages m set request_id = req.id, handled_at = now()
  where m.id = msg.id returning * into result;

  update public.attachments a set request_id = req.id where a.message_id = msg.id;

  update public.requests r set updated_at = now() where r.id = req.id;
  perform private.log_request_event(req.id, 'message_linked', null, msg.id::text, null,
    jsonb_build_object('message_id', msg.id, 'previous_inbox_dispatcher_id', msg.inbox_dispatcher_id, 'subject', msg.subject),
    'dispatch');
  return result;
end;
$$;

-- Privileges
revoke all on function
  private.next_invoice_number(integer),
  private.require_invoice_actor(public.requests),
  private.rebuild_invoice_items(uuid),
  private.lock_invoice(uuid, integer),
  private.lock_outgoing_message(uuid, integer),
  private.lock_work_entry(uuid, integer),
  private.require_request_open_for_work(public.requests)
from public, anon, authenticated;

revoke all on function
  public.create_invoice(uuid, integer),
  public.issue_invoice(uuid, integer),
  public.record_payment(uuid, integer, timestamptz),
  public.create_message_draft(uuid, integer, public.message_kind, text, text, text, uuid),
  public.update_message_draft(uuid, integer, text, text, text),
  public.queue_message(uuid, integer),
  public.link_message(uuid, uuid, integer)
from public, anon;

grant execute on function
  public.create_invoice(uuid, integer),
  public.issue_invoice(uuid, integer),
  public.record_payment(uuid, integer, timestamptz),
  public.create_message_draft(uuid, integer, public.message_kind, text, text, text, uuid),
  public.update_message_draft(uuid, integer, text, text, text),
  public.queue_message(uuid, integer),
  public.link_message(uuid, uuid, integer)
to authenticated;
