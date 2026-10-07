-- Demo seed support (spec section 9).
--
-- * public.demo_seed_apply(payload) replaces all demo data in one transaction (idempotent rerun).
-- * public.demo_seed_purge() removes demo data only.
-- * Both are callable by service_role only (scripts/seed-demo.mjs).
-- * Demo business data is identified by requests.is_demo; setup records (rates, availability, settings,
--   unmatched messages) are registered in private.demo_seed_records.
-- * Append-only events and issued invoices stay protected. The purge sets a transaction-local flag that lets
--   the protection triggers delete rows of demo requests only.

create table private.demo_seed_records (
  table_name text not null check (table_name in ('service_rates', 'employee_availability', 'messages', 'settings')),
  record_id text not null,
  original jsonb,
  created_at timestamptz not null default now(),
  primary key (table_name, record_id)
);

comment on table private.demo_seed_records is 'Seed-Eigentum von Demo-Stammdaten; settings speichert die ursprünglichen Werte zur Wiederherstellung.';

create function private.demo_purge_active()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('rheinwerk.demo_purge', true), '') = 'on';
$$;

-- Append-only, except deletion of demo request events during a demo purge
create or replace function public.prevent_request_event_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and private.demo_purge_active()
     and exists (select 1 from public.requests r where r.id = old.request_id and r.is_demo) then
    return old;
  end if;

  raise exception 'request_events ist append-only: % ist nicht erlaubt', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

-- Items of issued invoices are immutable, except deletion of demo invoices during a demo purge
create or replace function public.guard_invoice_items()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and private.demo_purge_active() and exists (
    select 1 from public.invoices i join public.requests r on r.id = i.request_id
    where i.id = old.invoice_id and r.is_demo
  ) then
    return old;
  end if;

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

-- Counters continue after the highest remaining number, so a rerun reproduces the same demo numbers
create function private.reset_number_counters()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.request_number_counters where true;
  insert into public.request_number_counters (year, last_value)
  select split_part(request_number, '-', 2)::integer, max(split_part(request_number, '-', 3)::integer)
  from public.requests
  where request_number ~ '^RIS-\d{4}-\d{5}$'
  group by 1;

  delete from public.invoice_number_counters where true;
  insert into public.invoice_number_counters (year, last_value)
  select split_part(invoice_number, '-', 2)::integer, max(split_part(invoice_number, '-', 3)::integer)
  from public.invoices
  where invoice_number ~ '^RE-\d{4}-\d{5}$'
  group by 1;
end;
$$;

create function public.demo_seed_purge()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed jsonb := '{}'::jsonb;
  n integer;
  original jsonb;
begin
  perform set_config('rheinwerk.demo_purge', 'on', true);

  delete from public.attachments a
  where a.request_id in (select id from public.requests where is_demo)
     or a.message_id in (select record_id::uuid from private.demo_seed_records where table_name = 'messages');
  get diagnostics n = row_count; removed := removed || jsonb_build_object('attachments', n);

  delete from public.automation_runs a
  where a.request_id in (select id from public.requests where is_demo)
     or a.message_id in (select record_id::uuid from private.demo_seed_records where table_name = 'messages');
  get diagnostics n = row_count; removed := removed || jsonb_build_object('automation_runs', n);

  delete from public.messages m
  where m.request_id in (select id from public.requests where is_demo)
     or m.id in (select record_id::uuid from private.demo_seed_records where table_name = 'messages');
  get diagnostics n = row_count; removed := removed || jsonb_build_object('messages', n);

  delete from public.invoice_items it
  where it.invoice_id in (select i.id from public.invoices i join public.requests r on r.id = i.request_id where r.is_demo);
  get diagnostics n = row_count; removed := removed || jsonb_build_object('invoice_items', n);

  delete from public.invoices i where i.request_id in (select id from public.requests where is_demo);
  get diagnostics n = row_count; removed := removed || jsonb_build_object('invoices', n);

  delete from public.work_entries w where w.request_id in (select id from public.requests where is_demo);
  get diagnostics n = row_count; removed := removed || jsonb_build_object('work_entries', n);

  delete from public.request_events e where e.request_id in (select id from public.requests where is_demo);
  get diagnostics n = row_count; removed := removed || jsonb_build_object('request_events', n);

  delete from public.visits v where v.request_id in (select id from public.requests where is_demo);
  get diagnostics n = row_count; removed := removed || jsonb_build_object('visits', n);

  delete from public.requests r where r.is_demo;
  get diagnostics n = row_count; removed := removed || jsonb_build_object('requests', n);

  delete from public.employee_availability a
  where a.id in (select record_id::uuid from private.demo_seed_records where table_name = 'employee_availability');
  get diagnostics n = row_count; removed := removed || jsonb_build_object('employee_availability', n);

  delete from public.service_rates s
  where s.id in (select record_id::uuid from private.demo_seed_records where table_name = 'service_rates');
  get diagnostics n = row_count; removed := removed || jsonb_build_object('service_rates', n);

  select d.original into original from private.demo_seed_records d where d.table_name = 'settings';
  if found then
    update public.settings s
    set timezone = original ->> 'timezone',
        currency = original ->> 'currency',
        manual_intake_minutes = (original ->> 'manual_intake_minutes')::numeric,
        default_tax_rate = (original ->> 'default_tax_rate')::numeric,
        payment_terms_days = (original ->> 'payment_terms_days')::integer,
        company_details = original -> 'company_details',
        updated_by = (original ->> 'updated_by')::uuid
    where s.id = 1;
  end if;

  delete from private.demo_seed_records where true;
  perform private.reset_number_counters();
  perform set_config('rheinwerk.demo_purge', 'off', true);
  return removed;
end;
$$;

-- Replaces all demo data with the given payload (arrays of table rows, ids generated by the seed script).
-- Inserts in chronological order so that request and invoice numbers follow time.
create function public.demo_seed_apply(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  purged jsonb;
  inv record;
  cfg public.settings;
begin
  purged := public.demo_seed_purge();

  -- Settings: only fill an untouched configuration, remember the original for the purge
  select * into cfg from public.settings where id = 1;
  if payload ? 'settings' and cfg.updated_by is null and cfg.company_details = '{}'::jsonb then
    insert into private.demo_seed_records (table_name, record_id, original)
    values ('settings', '1', to_jsonb(cfg) - 'id' - 'created_at' - 'updated_at');

    update public.settings s
    set company_details = payload -> 'settings' -> 'company_details',
        manual_intake_minutes = coalesce((payload -> 'settings' ->> 'manual_intake_minutes')::numeric, s.manual_intake_minutes),
        default_tax_rate = coalesce((payload -> 'settings' ->> 'default_tax_rate')::numeric, s.default_tax_rate),
        payment_terms_days = coalesce((payload -> 'settings' ->> 'payment_terms_days')::integer, s.payment_terms_days)
    where s.id = 1;
  end if;

  insert into public.service_rates select * from jsonb_populate_recordset(null::public.service_rates, payload -> 'service_rates');
  insert into private.demo_seed_records (table_name, record_id)
  select 'service_rates', x ->> 'id' from jsonb_array_elements(payload -> 'service_rates') x;

  insert into public.employee_availability
  select * from jsonb_populate_recordset(null::public.employee_availability, payload -> 'employee_availability');
  insert into private.demo_seed_records (table_name, record_id)
  select 'employee_availability', x ->> 'id' from jsonb_array_elements(payload -> 'employee_availability') x;

  insert into public.requests
  select * from jsonb_populate_recordset(null::public.requests, payload -> 'requests') r
  order by r.created_at, r.source_event_key;

  insert into public.visits
  select * from jsonb_populate_recordset(null::public.visits, payload -> 'visits');

  insert into public.work_entries
  select * from jsonb_populate_recordset(null::public.work_entries, payload -> 'work_entries');

  -- Invoices: insert as draft with items, then issue in chronological order (atomic numbers)
  insert into public.invoices (id, request_id, status, created_by, currency, seller_snapshot, customer_snapshot, notes, created_at, updated_at)
  select i.id, i.request_id, 'draft', i.created_by, i.currency, '{}'::jsonb, '{}'::jsonb, i.notes, i.created_at, i.updated_at
  from jsonb_populate_recordset(null::public.invoices, payload -> 'invoices') i;

  insert into public.invoice_items
  select * from jsonb_populate_recordset(null::public.invoice_items, payload -> 'invoice_items');

  for inv in
    select * from jsonb_populate_recordset(null::public.invoices, payload -> 'invoices') i
    where i.status <> 'draft'
    order by i.issued_at, i.id
  loop
    update public.invoices i
    set status = inv.status,
        invoice_number = private.next_invoice_number(extract(year from inv.issue_date)::integer),
        issued_by = inv.issued_by,
        issue_date = inv.issue_date,
        payment_due_date = inv.payment_due_date,
        issued_at = inv.issued_at,
        sent_at = inv.sent_at,
        paid_at = inv.paid_at,
        subtotal = t.net,
        tax_total = t.tax,
        total = t.net + t.tax,
        seller_snapshot = inv.seller_snapshot,
        customer_snapshot = inv.customer_snapshot,
        updated_at = inv.updated_at
    from (select coalesce(sum(net_amount), 0) as net, coalesce(sum(tax_amount), 0) as tax
          from public.invoice_items where invoice_id = inv.id) t
    where i.id = inv.id;
  end loop;

  update public.invoices i
  set subtotal = t.net, tax_total = t.tax, total = t.net + t.tax
  from (select it.invoice_id, sum(it.net_amount) as net, sum(it.tax_amount) as tax from public.invoice_items it group by 1) t
  where i.id = t.invoice_id and i.status = 'draft'
    and i.request_id in (select id from public.requests where is_demo);

  insert into public.messages
  select * from jsonb_populate_recordset(null::public.messages, payload -> 'messages');
  insert into private.demo_seed_records (table_name, record_id)
  select 'messages', x ->> 'id' from jsonb_array_elements(payload -> 'messages') x where x ->> 'request_id' is null;

  insert into public.automation_runs
  select * from jsonb_populate_recordset(null::public.automation_runs, payload -> 'automation_runs');

  insert into public.request_events (id, request_id, visit_id, actor_type, actor_id, event_type, visibility, from_value, to_value, note, data, occurred_at, created_at)
  select e.id, e.request_id, e.visit_id, e.actor_type, e.actor_id, e.event_type, e.visibility, e.from_value, e.to_value, e.note,
         coalesce(e.data, '{}'::jsonb), e.occurred_at, e.occurred_at
  from jsonb_populate_recordset(null::public.request_events, payload -> 'request_events') e
  order by e.occurred_at, e.id;

  return jsonb_build_object(
    'purged', purged,
    'inserted', jsonb_build_object(
      'requests', jsonb_array_length(payload -> 'requests'),
      'visits', jsonb_array_length(payload -> 'visits'),
      'work_entries', jsonb_array_length(payload -> 'work_entries'),
      'invoices', jsonb_array_length(payload -> 'invoices'),
      'messages', jsonb_array_length(payload -> 'messages'),
      'automation_runs', jsonb_array_length(payload -> 'automation_runs'),
      'request_events', jsonb_array_length(payload -> 'request_events')));
end;
$$;

revoke all on function private.demo_purge_active() from public, anon;
grant execute on function private.demo_purge_active() to authenticated;
revoke all on function private.reset_number_counters() from public, anon, authenticated;
revoke all on function public.demo_seed_purge() from public, anon, authenticated;
revoke all on function public.demo_seed_apply(jsonb) from public, anon, authenticated;
grant execute on function public.demo_seed_purge() to service_role;
grant execute on function public.demo_seed_apply(jsonb) to service_role;
