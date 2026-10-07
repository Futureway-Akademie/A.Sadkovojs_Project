-- task-2-3: work entries and request closure. Run with: supabase test db
begin;
select plan(34);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'm@x.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 't1@x.test'),
  ('00000000-0000-0000-0000-0000000000b2', 't2@x.test'),
  ('00000000-0000-0000-0000-0000000000b3', 't3@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Managerin', 'manager'),
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000b1', 'Technik 1', 'technician'),
  ('00000000-0000-0000-0000-0000000000b2', 'Technik 2', 'technician'),
  ('00000000-0000-0000-0000-0000000000b3', 'Technik 3', 'technician');

insert into public.service_rates (id, code, service_kind, display_name, billing_model, unit_price, tax_rate) values
  ('00000000-0000-0000-0000-0000000000e1', 'REP-H', 'diagnosis_repair', 'Reparatur je Stunde', 'hourly', 95, 19),
  ('00000000-0000-0000-0000-0000000000e2', 'WART', 'scheduled_maintenance', 'Wartung pauschal', 'fixed', 250, 19);

-- r1: repair in progress (t1 current, t2 worked before); r2: rejected; r3: scheduled visit only
insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id, technician_id,
  intake_status, priority, intake_completed_at, intake_mode, manual_minutes_baseline, work_status, rejection_reason)
select ('00000000-0000-0000-0000-00000000000' || n)::uuid, 'r' || n, 'x', 'demo_seed', 'ACME', 'Erika', 'e@acme.test', '1',
  'Str. 1', '40210', 'Düsseldorf', 'pump', 'diagnosis_repair', date '2026-10-20', 'Test', 'planbar', 'none_known', '{}',
  '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1',
  (case when n = 2 then 'rejected' else 'processed' end)::public.intake_status, 'normal', now(), 'manual', 5,
  (case n when 1 then 'in_progress' when 2 then 'cancelled' else 'scheduled' end)::public.work_status,
  case when n = 2 then 'Kein Industriekunde' end
from generate_series(1, 3) as n;

insert into public.visits (id, request_id, technician_id, status, scheduled_start, scheduled_end, actual_start, actual_end, created_by) values
  ('00000000-0000-0000-0000-0000000000c0', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'completed',
   '2026-10-01 08:00+02', '2026-10-01 10:00+02', '2026-10-01 08:00+02', '2026-10-01 10:00+02', '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'in_progress',
   '2026-10-05 08:00+02', '2026-10-05 10:00+02', '2026-10-05 08:00+02', null, '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b1', 'scheduled',
   '2027-03-01 08:00+01', '2027-03-01 10:00+01', null, null, '00000000-0000-0000-0000-0000000000d1');

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
$$;

-- Permissions
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select throws_ok($$select public.add_work_entry('00000000-0000-0000-0000-000000000001', 1, 'labor', 'Arbeit', 1)$$, '42501', null, 'dispatcher cannot record work');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b3');
set local role authenticated;
select throws_ok($$select public.add_work_entry('00000000-0000-0000-0000-000000000001', 1, 'labor', 'Arbeit', 1)$$, '42501', null, 'unrelated technician has no access');
reset role;

-- Current technician t1
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select results_eq(
  $$select unit::text, unit_price, tax_rate, item_status::text from public.add_work_entry('00000000-0000-0000-0000-000000000001',
      (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'),
      'labor', 'Fehlersuche', 1.5, 'performed', visit_id => '00000000-0000-0000-0000-0000000000c1', service_rate_id => '00000000-0000-0000-0000-0000000000e1')$$,
  $$values ('hour', 95.00::numeric, 19.00::numeric, 'performed')$$,
  'labor from hourly rate: unit hour, price and tax from rate'
);
select throws_ok(
  $$select public.add_work_entry('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'part', 'Dichtung', 1)$$,
  'RW422', null, 'part needs a price'
);
select results_eq(
  $$select unit::text, item_status::text, performed_at is not null, tax_rate from public.add_work_entry('00000000-0000-0000-0000-000000000001',
      (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'),
      'part', 'Gleitringdichtung', 1, 'used', unit_price => 12.50)$$,
  $$values ('piece', 'used', true, 19.00::numeric)$$,
  'used part: unit piece, timestamp, default tax from settings'
);
select throws_ok(
  $$select public.add_work_entry('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'part', 'X', 1, 'performed', unit_price => 1)$$,
  'RW422', null, 'parts are not performed'
);
select throws_ok(
  $$select public.add_work_entry('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'labor', 'X', 1, 'used', unit_price => 1)$$,
  'RW422', null, 'labor is not used'
);
select throws_ok(
  $$select public.add_work_entry('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'labor', 'X', 1, service_rate_id => '00000000-0000-0000-0000-0000000000e2')$$,
  'RW422', null, 'fixed rate does not fit labor'
);
select throws_ok(
  $$select public.add_work_entry('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'fixed_service', 'Wartung', 1, service_rate_id => '00000000-0000-0000-0000-0000000000e2')$$,
  'RW422', null, 'rate must match the service kind of the request'
);
select throws_ok(
  $$select public.add_work_entry('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'labor', 'X', 0, unit_price => 95)$$,
  'RW422', null, 'quantity must be positive'
);
select throws_ok(
  $$select public.add_work_entry('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'labor', 'X', 1, unit_price => 95, visit_id => '00000000-0000-0000-0000-0000000000c3')$$,
  'RW422', null, 'visit must belong to the request'
);
select throws_ok(
  $$select public.add_work_entry('00000000-0000-0000-0000-000000000001', 1, 'labor', 'X', 1, unit_price => 95)$$,
  'RW409', null, 'stale version rejected'
);

-- Lifecycle and corrections
select is(
  (public.set_work_entry_status((select id from public.work_entries where description = 'Gleitringdichtung'),
     (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'cancelled')).item_status::text,
  'cancelled', 'used part can be cancelled before billing'
);
select throws_ok(
  $$select public.set_work_entry_status((select id from public.work_entries where description = 'Gleitringdichtung'),
      (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'used')$$,
  'RW422', null, 'cancelled is final'
);
select is(
  (public.add_work_entry('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'),
     'part', 'Lager', 2, 'ordered', unit_price => 40)).ordered_at is not null,
  true, 'ordered part records ordered_at'
);
select is(
  (public.set_work_entry_status((select id from public.work_entries where description = 'Lager'),
     (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'used')).item_status::text,
  'used', 'ordered -> used'
);
select is(
  (public.update_work_entry((select id from public.work_entries where description = 'Fehlersuche'),
     (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), quantity => 2)).quantity,
  2.000::numeric, 'quantity corrected'
);
reset role;
select is(
  (select count(*)::int from public.request_events where request_id = '00000000-0000-0000-0000-000000000001' and event_type in ('work_entry_added', 'work_entry_changed')),
  6, 'work entry changes audited (3 added, 3 changed)'
);

-- Historical technician t2: only on own visit
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok(
  $$select public.add_work_entry('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'labor', 'Nachtrag', 1, unit_price => 95)$$,
  '42501', null, 'former technician cannot record request-level work'
);
select is(
  (public.add_work_entry('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'),
     'labor', 'Nachtrag eigener Einsatz', 0.5, 'performed', unit_price => 95, visit_id => '00000000-0000-0000-0000-0000000000c0')).author_id,
  '00000000-0000-0000-0000-0000000000b2'::uuid, 'former technician can record work on own visit'
);
reset role;

-- Billing lock: request has an issued invoice
insert into public.invoices (id, request_id, created_by) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1');
insert into public.invoice_items (invoice_id, work_entry_id, position, kind, description, unit, quantity, unit_price, tax_rate, net_amount, tax_amount, gross_amount)
select '00000000-0000-0000-0000-0000000000f1', id, 1, 'part', 'Lager', 'piece', 2, 40, 19, 80.00, 15.20, 95.20 from public.work_entries where description = 'Lager';
update public.invoices set status = 'issued', invoice_number = 'RE-TEST-1', issued_by = '00000000-0000-0000-0000-0000000000b1', issued_at = now(),
  issue_date = current_date, payment_due_date = current_date + 14, subtotal = 80.00, tax_total = 15.20, total = 95.20
  where id = '00000000-0000-0000-0000-0000000000f1';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok(
  $$select public.update_work_entry((select id from public.work_entries where description = 'Lager'),
      (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), quantity => 3)$$,
  'RW422', null, 'entries of an invoiced request are locked'
);
reset role;

-- Rejected request
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_ok(
  $$select public.add_work_entry('00000000-0000-0000-0000-000000000002', (select version from public.requests where id = '00000000-0000-0000-0000-000000000002'), 'labor', 'X', 1, unit_price => 95)$$,
  'RW422', null, 'no work entries for rejected requests'
);
reset role;

-- Closing r1
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok(
  $$select public.close_request('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'Fertig')$$,
  '42501', null, 'former technician cannot close'
);
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok(
  $$select public.close_request('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), '  ')$$,
  'RW422', null, 'closure requires report'
);
select throws_ok(
  $$select public.close_request('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'Pumpe abgedichtet')$$,
  'RW422', null, 'closure blocked by open visit'
);
select is(
  (public.complete_visit('00000000-0000-0000-0000-0000000000c1', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 120, 'Dichtung getauscht')).status::text,
  'completed', 'open visit completed'
);
select is(
  (public.close_request('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'),
     'Pumpe abgedichtet, Probelauf ohne Befund')).work_status::text,
  'completed', 'current technician closes the request'
);
select is(
  (public.close_request('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'nochmal')).completion_summary,
  'Pumpe abgedichtet, Probelauf ohne Befund', 'repeated closure returns existing outcome'
);
reset role;
select results_eq(
  $$select completed_at is not null, intake_status::text from public.requests where id = '00000000-0000-0000-0000-000000000001'$$,
  $$values (true, 'processed')$$,
  'completed_at set'
);
select results_eq(
  $$select status::text, paid_at is null from public.invoices where request_id = '00000000-0000-0000-0000-000000000001'$$,
  $$values ('issued', true)$$,
  'closure does not mark payment'
);
select is(
  (select count(*)::int from public.request_events where request_id = '00000000-0000-0000-0000-000000000001' and event_type = 'work_completed'),
  1, 'closure audited once'
);

-- r3: no completed visit, scheduled visit open
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_ok(
  $$select public.close_request('00000000-0000-0000-0000-000000000003', (select version from public.requests where id = '00000000-0000-0000-0000-000000000003'), 'Fertig')$$,
  'RW422', null, 'manager cannot close with open visit either'
);
select is(
  (public.cancel_visit('00000000-0000-0000-0000-0000000000c3', (select version from public.requests where id = '00000000-0000-0000-0000-000000000003'), 'Doppelt gebucht')).status::text,
  'cancelled', 'open visit cancelled'
);
select throws_ok(
  $$select public.close_request('00000000-0000-0000-0000-000000000003', (select version from public.requests where id = '00000000-0000-0000-0000-000000000003'), 'Fertig')$$,
  'RW422', null, 'closure requires a completed visit'
);
reset role;

select * from finish();
rollback;
