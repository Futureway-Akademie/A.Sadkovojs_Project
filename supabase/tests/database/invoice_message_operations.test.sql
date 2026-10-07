-- task-2-4: invoices, payments, e-mail queue, manual message linking. Run with: supabase test db
begin;
select plan(46);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'm@x.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'd2@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 't1@x.test'),
  ('00000000-0000-0000-0000-0000000000b2', 't2@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Managerin', 'manager'),
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000d2', 'Dispo 2', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000b1', 'Technik 1', 'technician'),
  ('00000000-0000-0000-0000-0000000000b2', 'Technik 2', 'technician');
update public.settings set company_details = '{"company_name": "RheinWerk Industrieservice GmbH (Demo)"}';

-- r1 repair completed, r2 maintenance completed, r3 in progress, r4 completed without billable entries
insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id, technician_id,
  intake_status, priority, intake_completed_at, intake_mode, manual_minutes_baseline, work_status, completed_at, completion_summary)
select ('00000000-0000-0000-0000-00000000000' || n)::uuid, 'r' || n, 'x', 'demo_seed', 'Kunde ' || n || ' GmbH', 'Erika', 'e@kunde.test', '1',
  'Str. 1', '40210', 'Düsseldorf', 'pump',
  (case when n = 2 then 'scheduled_maintenance' else 'diagnosis_repair' end)::public.service_kind,
  date '2026-10-20', 'Test', 'planbar', 'none_known', '{}', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1',
  'processed', 'normal', now(), 'manual', 5,
  (case when n = 3 then 'in_progress' else 'completed' end)::public.work_status,
  case when n <> 3 then now() end, case when n <> 3 then 'Erledigt' end
from generate_series(1, 4) as n;

insert into public.visits (id, request_id, technician_id, status, scheduled_start, scheduled_end, actual_start, actual_end, actual_work_minutes, created_by)
select ('00000000-0000-0000-0000-0000000000c' || n)::uuid, ('00000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-0000000000b1', 'completed',
  ('2026-10-0' || n || ' 08:00+02')::timestamptz, ('2026-10-0' || n || ' 11:00+02')::timestamptz,
  ('2026-10-0' || n || ' 08:00+02')::timestamptz, ('2026-10-0' || n || ' 11:00+02')::timestamptz, 180, '00000000-0000-0000-0000-0000000000d1'
from generate_series(1, 4) as n;

insert into public.work_entries (request_id, visit_id, author_id, kind, item_status, description, quantity, unit, unit_price, tax_rate, billable, ordered_at, performed_at) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'labor', 'performed', 'Reparatur', 1.5, 'hour', 95, 19, true, null, now()),
  ('00000000-0000-0000-0000-000000000001', null, '00000000-0000-0000-0000-0000000000b1', 'labor', 'performed', 'Kulanz', 1, 'hour', 95, 19, false, null, now()),
  ('00000000-0000-0000-0000-000000000001', null, '00000000-0000-0000-0000-0000000000b1', 'part', 'used', 'Lager', 2, 'piece', 40, 19, true, null, now()),
  ('00000000-0000-0000-0000-000000000001', null, '00000000-0000-0000-0000-0000000000b1', 'part', 'ordered', 'Motor bestellt', 1, 'piece', 100, 19, true, now(), null),
  ('00000000-0000-0000-0000-000000000001', null, '00000000-0000-0000-0000-0000000000b1', 'labor', 'planned', 'Nacharbeit geplant', 1, 'hour', 95, 19, true, null, null),
  ('00000000-0000-0000-0000-000000000001', null, '00000000-0000-0000-0000-0000000000b1', 'part', 'cancelled', 'Falsches Teil', 1, 'piece', 30, 19, true, null, null),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1', 'fixed_service', 'performed', 'Wartung pauschal', 1, 'service', 250, 19, true, null, now()),
  ('00000000-0000-0000-0000-000000000004', null, '00000000-0000-0000-0000-0000000000b1', 'labor', 'performed', 'Kulanz', 1, 'hour', 95, 19, false, null, now());

-- Unmatched incoming message with attachment in d1's inbox
insert into public.messages (id, inbox_dispatcher_id, direction, kind, status, from_address, subject, body_text, received_at)
values ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000d1', 'incoming', 'customer_reply', 'received', 'e@kunde.test', 'Fotos', 'Anbei', now());
insert into public.attachments (message_id, bucket, storage_path, file_name, mime_type, size_bytes)
values ('00000000-0000-0000-0000-0000000000e9', 'dashboard', 'inbox/foto.jpg', 'foto.jpg', 'image/jpeg', 10);

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
$$;

-- Permissions and preconditions
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select throws_ok($$select public.create_invoice('00000000-0000-0000-0000-000000000001', 1)$$, '42501', null, 'dispatcher cannot create invoices');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok($$select public.create_invoice('00000000-0000-0000-0000-000000000001', 1)$$, '42501', null, 'other technician cannot create invoices');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$select public.create_invoice('00000000-0000-0000-0000-000000000003', 1)$$, 'RW422', null, 'no invoice before technical completion');

-- Draft: only billable performed labor and used parts
select is((public.create_invoice('00000000-0000-0000-0000-000000000001', 1)).status::text, 'draft', 'draft invoice created');
reset role;
select results_eq(
  $$select string_agg(description, ', ' order by description) from public.invoice_items it join public.invoices i on i.id = it.invoice_id
    where i.request_id = '00000000-0000-0000-0000-000000000001'$$,
  $$values ('Lager, Reparatur')$$,
  'only billable performed labor and used parts'
);
select results_eq(
  $$select subtotal, tax_total, total from public.invoices where request_id = '00000000-0000-0000-0000-000000000001'$$,
  $$values (222.50::numeric, 42.28::numeric, 264.78::numeric)$$,
  'totals: 142.50 + 80.00 net, 27.08 + 15.20 tax'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is(
  (public.create_invoice('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'))).id,
  (select id from public.invoices where request_id = '00000000-0000-0000-0000-000000000001'),
  'repeated creation returns the existing invoice'
);
-- Draft is a preview: entries remain editable
select is(
  (public.add_work_entry('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'),
     'part', 'Schraubensatz', 1, 'used', unit_price => 10)).item_status::text,
  'used', 'entries editable while invoice is a draft'
);

-- Issue
select is(
  (public.issue_invoice((select id from public.invoices where request_id = '00000000-0000-0000-0000-000000000001'),
     (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'))).status::text,
  'issued', 'invoice issued'
);
reset role;
select results_eq(
  $$select left(invoice_number, 7), payment_due_date - issue_date, total, seller_snapshot ->> 'company_name', customer_snapshot ->> 'company_name', issued_by
    from public.invoices where request_id = '00000000-0000-0000-0000-000000000001'$$,
  $$values ('RE-' || extract(year from now() at time zone 'Europe/Berlin')::int, 14, 276.68::numeric,
            'RheinWerk Industrieservice GmbH (Demo)', 'Kunde 1 GmbH', '00000000-0000-0000-0000-0000000000b1'::uuid)$$,
  'issue rebuilds items, assigns number, due date and snapshots'
);
select is((select count(*)::int from public.invoice_items it join public.invoices i on i.id = it.invoice_id where i.request_id = '00000000-0000-0000-0000-000000000001'),
  3, 'new entry included at issue');
select ok((select invoice_number from public.invoices where request_id = '00000000-0000-0000-0000-000000000001') ~ '^RE-\d{4}-\d{5}$', 'invoice number format RE-YYYY-NNNNN');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is(
  (public.issue_invoice((select id from public.invoices where request_id = '00000000-0000-0000-0000-000000000001'),
     (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'))).invoice_number,
  (select invoice_number from public.invoices where request_id = '00000000-0000-0000-0000-000000000001'),
  'repeated issue returns the same invoice'
);
select throws_ok(
  $$select public.add_work_entry('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'part', 'Nachtrag', 1, 'used', unit_price => 5)$$,
  'RW422', null, 'no new entries after issue'
);
select throws_ok(
  $$select public.update_work_entry((select id from public.work_entries where description = 'Lager'),
      (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), quantity => 3)$$,
  'RW422', null, 'billed entries locked after issue'
);
reset role;
select is((select last_value from public.invoice_number_counters where year = extract(year from now() at time zone 'Europe/Berlin')::int),
  right((select invoice_number from public.invoices where request_id = '00000000-0000-0000-0000-000000000001'), 5)::int, 'no second number consumed');
select is((select count(*)::int from public.invoices where request_id = '00000000-0000-0000-0000-000000000001'), 1, 'no duplicate invoice');

-- Immutability for every role
select throws_ok($$update public.invoices set total = 1, subtotal = 1, tax_total = 0 where request_id = '00000000-0000-0000-0000-000000000001'$$, '23514', null, 'issued amounts immutable');
select throws_ok($$update public.invoices set customer_snapshot = '{}' where request_id = '00000000-0000-0000-0000-000000000001'$$, '23514', null, 'issued snapshot immutable');
select throws_ok($$update public.invoices set status = 'draft' where request_id = '00000000-0000-0000-0000-000000000001'$$, '23514', null, 'no way back to draft');
select throws_ok($$update public.invoice_items set description = 'x' where invoice_id = (select id from public.invoices where request_id = '00000000-0000-0000-0000-000000000001')$$, '23514', null, 'issued items immutable');
select throws_ok($$delete from public.invoice_items where invoice_id = (select id from public.invoices where request_id = '00000000-0000-0000-0000-000000000001')$$, '23514', null, 'issued items cannot be deleted');

-- Maintenance: fixed price only, no hourly surcharge despite 180 working minutes
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select is((public.create_invoice('00000000-0000-0000-0000-000000000002', 1)).total, 297.50::numeric, 'maintenance draft: fixed price only');
select results_eq(
  $$select status::text, total, right(invoice_number, 5)::int from public.issue_invoice(
      (select id from public.invoices where request_id = '00000000-0000-0000-0000-000000000002'),
      (select version from public.requests where id = '00000000-0000-0000-0000-000000000002'))$$,
  $$values ('issued', 297.50::numeric, right((select invoice_number from public.invoices where request_id = '00000000-0000-0000-0000-000000000001'), 5)::int + 1)$$,
  'maintenance invoice: fixed price only, next number'
);
select is((public.create_invoice('00000000-0000-0000-0000-000000000004', 1)).total, 0.00::numeric, 'draft without billable entries');
select throws_ok(
  $$select public.issue_invoice((select id from public.invoices where request_id = '00000000-0000-0000-0000-000000000004'),
      (select version from public.requests where id = '00000000-0000-0000-0000-000000000004'))$$,
  'RW422', null, 'no issue without billable entries'
);
reset role;

-- Payments: manager/admin only
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok(
  $$select public.record_payment((select id from public.invoices where request_id = '00000000-0000-0000-0000-000000000001'),
      (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'))$$,
  '42501', null, 'technician cannot record payment'
);
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select throws_ok(
  $$select public.record_payment((select id from public.invoices where request_id = '00000000-0000-0000-0000-000000000001'),
      (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'))$$,
  '42501', null, 'dispatcher cannot record payment'
);
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_ok(
  $$select public.record_payment((select id from public.invoices where request_id = '00000000-0000-0000-0000-000000000001'),
      (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), now() + interval '1 day')$$,
  'RW422', null, 'payment date cannot be in the future'
);
select is(
  (public.record_payment((select id from public.invoices where request_id = '00000000-0000-0000-0000-000000000001'),
     (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'))).status::text,
  'paid', 'manager records payment'
);
select is(
  (public.record_payment((select id from public.invoices where request_id = '00000000-0000-0000-0000-000000000001'),
     (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'))).status::text,
  'paid', 'repeated payment returns paid invoice'
);
reset role;
select is(
  (select visibility::text from public.request_events where request_id = '00000000-0000-0000-0000-000000000001' and event_type = 'invoice_paid'),
  'management', 'payment event visible to management only'
);

-- E-mail queue
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok(
  $$select public.create_message_draft('00000000-0000-0000-0000-000000000002', (select version from public.requests where id = '00000000-0000-0000-0000-000000000002'),
      'other', 'e@kunde.test', 'S', 'B')$$,
  '42501', null, 'technician cannot write customer e-mails'
);
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select throws_ok(
  $$select public.create_message_draft('00000000-0000-0000-0000-000000000002', (select version from public.requests where id = '00000000-0000-0000-0000-000000000002'),
      'invoice', 'e@kunde.test', 'Rechnung', 'Anbei')$$,
  'RW422', null, 'invoice e-mail requires an issued invoice'
);
select throws_ok(
  $$select public.create_message_draft('00000000-0000-0000-0000-000000000002', (select version from public.requests where id = '00000000-0000-0000-0000-000000000002'),
      'customer_reply', 'e@kunde.test', 'S', 'B')$$,
  'RW422', null, 'customer_reply is not an outgoing kind'
);
select is(
  (public.create_message_draft('00000000-0000-0000-0000-000000000002', (select version from public.requests where id = '00000000-0000-0000-0000-000000000002'),
     'invoice', 'e@kunde.test', 'Ihre Rechnung', 'Sehr geehrte Damen und Herren, …',
     (select id from public.invoices where request_id = '00000000-0000-0000-0000-000000000002'))).status::text,
  'draft', 'invoice e-mail draft created'
);
select is(
  (public.update_message_draft((select id from public.messages where request_id = '00000000-0000-0000-0000-000000000002'),
     (select version from public.requests where id = '00000000-0000-0000-0000-000000000002'), subject => 'Ihre Rechnung (Demo)')).subject,
  'Ihre Rechnung (Demo)', 'draft edited'
);
select is(
  (public.queue_message((select id from public.messages where request_id = '00000000-0000-0000-0000-000000000002'),
     (select version from public.requests where id = '00000000-0000-0000-0000-000000000002'))).status::text,
  'queued', 'draft queued'
);
select throws_ok(
  $$select public.update_message_draft((select id from public.messages where request_id = '00000000-0000-0000-0000-000000000002'),
      (select version from public.requests where id = '00000000-0000-0000-0000-000000000002'), subject => 'x')$$,
  'RW422', null, 'queued message no longer editable'
);
reset role;
select results_eq(
  $$select m.sent_at is null, m.approved_by, i.status::text, i.sent_at is null, r.first_substantive_response_at is null
    from public.messages m join public.invoices i on i.id = m.invoice_id join public.requests r on r.id = m.request_id
    where m.request_id = '00000000-0000-0000-0000-000000000002'$$,
  $$values (true, '00000000-0000-0000-0000-0000000000d1'::uuid, 'issued', true, true)$$,
  'queueing sets neither sent, paid nor first response'
);

-- Manual linking of an unmatched message
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
set local role authenticated;
select throws_ok(
  $$select public.link_message('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-000000000001', 1)$$,
  '42501', null, 'other dispatcher cannot link d1''s inbox message'
);
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select is(
  (public.link_message('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-000000000001',
     (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'))).request_id,
  '00000000-0000-0000-0000-000000000001'::uuid, 'message linked'
);
select throws_ok(
  $$select public.link_message('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-000000000002',
      (select version from public.requests where id = '00000000-0000-0000-0000-000000000002'))$$,
  'RW422', null, 'linked message cannot be linked again'
);
reset role;
select is((select request_id from public.attachments where message_id = '00000000-0000-0000-0000-0000000000e9'),
  '00000000-0000-0000-0000-000000000001'::uuid, 'attachment follows the message');
select is(
  (select (data ->> 'previous_inbox_dispatcher_id')::uuid from public.request_events where event_type = 'message_linked' and request_id::text like '00000000-0000-0000-0000-%'),
  '00000000-0000-0000-0000-0000000000d1'::uuid, 'link event records previous inbox assignment'
);
select is(
  (select count(*)::int from public.request_events where request_id::text like '00000000-0000-0000-0000-%'
     and event_type in ('invoice_created', 'invoice_issued', 'invoice_paid', 'message_drafted', 'message_queued', 'message_linked')),
  9, 'all invoice and message operations audited'
);

select * from finish();
rollback;
