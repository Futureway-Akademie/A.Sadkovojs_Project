-- task-1-4: visits, work_entries, invoices, invoice_items. Run with: supabase test db
begin;
select plan(32);

-- Fixtures: two technicians, a dispatcher, two requests
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 't1@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 't2@example.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'd1@example.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000b1', 'Technik 1', 'technician'),
  ('00000000-0000-0000-0000-0000000000b2', 'Technik 2', 'technician'),
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo', 'dispatcher');

insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload)
select r.id, r.key, 'x', 'demo_seed', 'ACME', 'Erika', 'e@acme.test', '1', 'Str. 1', '40210', 'Düsseldorf',
  'pump', 'diagnosis_repair', date '2026-10-20', 'Test', 'planbar', 'none_known', '{}'
from (values ('00000000-0000-0000-0000-0000000000a1'::uuid, 'r1'), ('00000000-0000-0000-0000-0000000000a2'::uuid, 'r2')) as r(id, key);

create function pg_temp.book(id uuid, req uuid, tech uuid, s timestamptz, e timestamptz, st public.visit_status default 'scheduled')
returns void language sql as $$
  insert into public.visits (id, request_id, technician_id, status, scheduled_start, scheduled_end, actual_start, actual_end, waiting_reason, cancellation_reason, created_by)
  values (id, req, tech, st, s, e,
    case when st in ('in_progress', 'waiting_parts', 'completed') then s end,
    case when st = 'completed' then e end,
    case when st = 'waiting_parts' then 'Teil bestellt' end,
    case when st = 'cancelled' then 'Kunde abgesagt' end,
    '00000000-0000-0000-0000-0000000000d1');
$$;

-- Structure
select has_table('public', 'visits', 'visits exists');
select has_table('public', 'work_entries', 'work_entries exists');
select has_table('public', 'invoices', 'invoices exists');
select has_table('public', 'invoice_items', 'invoice_items exists');
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.visits'::regclass, 'public.work_entries'::regclass, 'public.invoices'::regclass, 'public.invoice_items'::regclass)),
  'RLS enabled'
);

-- visits: order and overlap
select lives_ok(
  $$select pg_temp.book('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '2026-10-20 08:00+02', '2026-10-20 10:00+02')$$,
  'first booking accepted'
);
select throws_ok(
  $$select pg_temp.book(gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '2026-10-20 10:00+02', '2026-10-20 08:00+02')$$,
  '23514', null, 'scheduled_end must be after scheduled_start'
);
select throws_ok(
  $$select pg_temp.book(gen_random_uuid(), '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1', '2026-10-20 09:00+02', '2026-10-20 11:00+02')$$,
  '23P01', null, 'overlapping active booking of same technician rejected'
);
select throws_ok(
  $$select pg_temp.book(gen_random_uuid(), '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1', '2026-10-20 09:00+02', '2026-10-20 11:00+02', 'in_progress')$$,
  '23P01', null, 'in_progress also reserves'
);
select lives_ok(
  $$select pg_temp.book(gen_random_uuid(), '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1', '2026-10-20 10:00+02', '2026-10-20 12:00+02')$$,
  'adjacent booking accepted (half-open interval)'
);
select lives_ok(
  $$select pg_temp.book(gen_random_uuid(), '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b2', '2026-10-20 09:00+02', '2026-10-20 11:00+02')$$,
  'same time for another technician accepted'
);
select lives_ok(
  $$select pg_temp.book(gen_random_uuid(), '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1', '2026-10-20 09:00+02', '2026-10-20 11:00+02', 'waiting_parts')$$,
  'waiting_parts does not reserve'
);
select lives_ok(
  $$select pg_temp.book(gen_random_uuid(), '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1', '2026-10-20 09:00+02', '2026-10-20 11:00+02', 'cancelled')$$,
  'cancelled does not reserve'
);
select throws_ok(
  $$insert into public.visits (request_id, technician_id, status, scheduled_start, scheduled_end, created_by)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2', 'waiting_parts', '2026-10-21 08:00+02', '2026-10-21 09:00+02', '00000000-0000-0000-0000-0000000000d1')$$,
  '23514', null, 'waiting_parts needs actual_start and reason'
);

-- Same-request guarantees for children
select throws_ok(
  $$insert into public.request_events (request_id, visit_id, actor_type, event_type)
    values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', 'system', 'visit_scheduled')$$,
  '23503', null, 'event cannot reference a visit of another request'
);
select throws_ok(
  $$insert into public.work_entries (request_id, visit_id, author_id, kind, description, quantity, unit, unit_price, tax_rate)
    values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'labor', 'Arbeit', 1, 'hour', 95, 19)$$,
  '23503', null, 'work entry cannot reference a visit of another request'
);

select throws_ok(
  $$insert into public.attachments (request_id, visit_id, bucket, storage_path, file_name, mime_type, size_bytes)
    values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', 'dashboard', 'x/foto.jpg', 'foto.jpg', 'image/jpeg', 100)$$,
  '23503', null, 'attachment cannot reference a visit of another request'
);
select lives_ok(
  $$insert into public.attachments (request_id, visit_id, bucket, storage_path, file_name, mime_type, size_bytes)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'dashboard', 'r1/foto.jpg', 'foto.jpg', 'image/jpeg', 100)$$,
  'attachment of own visit accepted'
);

-- work_entries
insert into public.work_entries (id, request_id, visit_id, author_id, kind, item_status, description, quantity, unit, unit_price, tax_rate, performed_at)
values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'labor', 'performed', 'Reparatur', 1.5, 'hour', 95, 19, now()),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a2', null, '00000000-0000-0000-0000-0000000000b1', 'labor', 'performed', 'Reparatur', 1, 'hour', 95, 19, now());
select throws_ok(
  $$insert into public.work_entries (request_id, author_id, kind, description, quantity, unit, unit_price, tax_rate)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'part', 'Dichtung', 1, 'hour', 5, 19)$$,
  '23514', null, 'kind and unit must match'
);
select throws_ok(
  $$insert into public.work_entries (request_id, author_id, kind, item_status, description, quantity, unit, unit_price, tax_rate, performed_at)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'part', 'performed', 'Dichtung', 1, 'piece', 5, 19, now())$$,
  '23514', null, 'parts are used, not performed'
);
select throws_ok(
  $$insert into public.work_entries (request_id, author_id, kind, description, quantity, unit, unit_price, tax_rate)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'labor', 'Arbeit', 0, 'hour', 95, 19)$$,
  '23514', null, 'quantity must be positive'
);

-- invoices
insert into public.invoices (id, request_id, created_by)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1');
select throws_ok(
  $$insert into public.invoices (request_id, created_by) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1')$$,
  '23505', null, 'one invoice per request'
);
select throws_ok(
  $$update public.invoices set status = 'issued' where id = '00000000-0000-0000-0000-0000000000e1'$$,
  '23514', null, 'issued invoice needs number and issue details'
);
select throws_ok(
  $$update public.invoices set total = 10 where id = '00000000-0000-0000-0000-0000000000e1'$$,
  '23514', null, 'total = subtotal + tax_total'
);
-- invoice_items
select lives_ok(
  $$insert into public.invoice_items (invoice_id, work_entry_id, position, kind, description, unit, quantity, unit_price, tax_rate, net_amount, tax_amount, gross_amount)
    values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', 1, 'labor', 'Reparatur', 'hour', 1.5, 95, 19, 142.50, 27.08, 169.58)$$,
  'item with correct rounding accepted'
);
select throws_ok(
  $$insert into public.invoice_items (invoice_id, work_entry_id, position, kind, description, unit, quantity, unit_price, tax_rate, net_amount, tax_amount, gross_amount)
    values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', 2, 'labor', 'Reparatur', 'hour', 1.5, 95, 19, 142.50, 27.08, 169.58)$$,
  '23505', null, 'work entry billed only once'
);
select throws_ok(
  $$insert into public.invoice_items (invoice_id, position, kind, description, unit, quantity, unit_price, tax_rate, net_amount, tax_amount, gross_amount)
    values ('00000000-0000-0000-0000-0000000000e1', 1, 'labor', 'Doppelt', 'hour', 1, 95, 19, 95, 18.05, 113.05)$$,
  '23505', null, 'position unique per invoice'
);
select throws_ok(
  $$insert into public.invoice_items (invoice_id, position, kind, description, unit, quantity, unit_price, tax_rate, net_amount, tax_amount, gross_amount)
    values ('00000000-0000-0000-0000-0000000000e1', 3, 'labor', 'Falsch', 'hour', 1, 95, 19, 95, 18.00, 113.00)$$,
  '23514', null, 'amounts must follow rounding rule'
);
select throws_ok(
  $$insert into public.invoice_items (invoice_id, work_entry_id, position, kind, description, unit, quantity, unit_price, tax_rate, net_amount, tax_amount, gross_amount)
    values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f2', 4, 'labor', 'Fremd', 'hour', 1, 95, 19, 95, 18.05, 113.05)$$,
  '23514', null, 'cannot bill work entry of another request'
);

select lives_ok(
  $$update public.invoices set status = 'issued', invoice_number = 'RE-TEST-00001', issued_by = '00000000-0000-0000-0000-0000000000b1',
      issued_at = now(), issue_date = '2026-10-21', payment_due_date = '2026-11-04'
    where id = '00000000-0000-0000-0000-0000000000e1'$$,
  'issued invoice with full details accepted'
);
select throws_ok(
  $$update public.invoices set status = 'paid' where id = '00000000-0000-0000-0000-0000000000e1'$$,
  '23514', null, 'paid requires paid_at'
);

select throws_ok(
  $$insert into public.invoice_items (invoice_id, position, kind, description, unit, quantity, unit_price, tax_rate, net_amount, tax_amount, gross_amount)
    values ('00000000-0000-0000-0000-0000000000e1', 9, 'labor', 'Nachtrag', 'hour', 1, 95, 19, 95, 18.05, 113.05)$$,
  '23514', null, 'no items can be added to an issued invoice'
);

select * from finish();
rollback;
