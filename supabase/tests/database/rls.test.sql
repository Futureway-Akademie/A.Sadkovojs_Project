-- task-1-5: row level security and private storage. Run with: supabase test db
begin;
select plan(42);

-- Fixtures (as postgres)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@x.test'),
  ('00000000-0000-0000-0000-0000000000a1', 'manager@x.test'),
  ('00000000-0000-0000-0000-0000000000a9', 'inactive@x.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'd2@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 't1@x.test'),
  ('00000000-0000-0000-0000-0000000000b2', 't2@x.test');
insert into public.profiles (id, display_name, role, is_active) values
  ('00000000-0000-0000-0000-00000000000a', 'Admin', 'admin', true),
  ('00000000-0000-0000-0000-0000000000a1', 'Managerin', 'manager', true),
  ('00000000-0000-0000-0000-0000000000a9', 'Ehemalig', 'manager', false),
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher', true),
  ('00000000-0000-0000-0000-0000000000d2', 'Dispo 2', 'dispatcher', true),
  ('00000000-0000-0000-0000-0000000000b1', 'Technik 1', 'technician', true),
  ('00000000-0000-0000-0000-0000000000b2', 'Technik 2', 'technician', true);

-- R1: dispatcher d1, now technician t2 (t1 worked there before); R2: dispatcher d2, technician t2
insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id, technician_id)
select r.id, r.key, 'x', 'demo_seed', 'ACME', 'Erika', 'e@acme.test', '1', 'Str. 1', '40210', 'Düsseldorf',
  'pump', 'diagnosis_repair', date '2026-10-20', 'Test', 'planbar', 'none_known', '{}', r.disp, r.tech
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid, 'r1', '00000000-0000-0000-0000-0000000000d1'::uuid, '00000000-0000-0000-0000-0000000000b2'::uuid),
  ('00000000-0000-0000-0000-000000000002'::uuid, 'r2', '00000000-0000-0000-0000-0000000000d2'::uuid, '00000000-0000-0000-0000-0000000000b2'::uuid)
) as r(id, key, disp, tech);

insert into public.visits (id, request_id, technician_id, status, scheduled_start, scheduled_end, actual_start, actual_end, created_by) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'completed',
   '2026-10-10 08:00+02', '2026-10-10 10:00+02', '2026-10-10 08:00+02', '2026-10-10 10:00+02', '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b2', 'scheduled',
   '2026-10-20 08:00+02', '2026-10-20 10:00+02', null, null, '00000000-0000-0000-0000-0000000000d2'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'scheduled',
   '2026-10-21 08:00+02', '2026-10-21 10:00+02', null, null, '00000000-0000-0000-0000-0000000000d1');

insert into public.employee_availability (employee_id, kind, weekday, local_start, local_end, starts_at, ends_at, label) values
  ('00000000-0000-0000-0000-0000000000b1', 'working_hours', 1, '07:00', '16:00', null, null, null),
  ('00000000-0000-0000-0000-0000000000b1', 'absence', null, null, null, '2026-10-22 00:00+02', '2026-10-23 00:00+02', 'Arzttermin');

insert into public.request_events (request_id, actor_type, event_type, visibility) values
  ('00000000-0000-0000-0000-000000000001', 'system', 'note_added', 'operational'),
  ('00000000-0000-0000-0000-000000000001', 'system', 'intake_status_changed', 'dispatch'),
  ('00000000-0000-0000-0000-000000000001', 'system', 'deadline_changed', 'management');

insert into public.messages (id, request_id, inbox_dispatcher_id, direction, kind, status, from_address, to_address, subject, body_text, received_at) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', null, 'outgoing', 'clarification', 'draft', null, 'e@acme.test', 'Rückfrage', 'Text', null),
  ('00000000-0000-0000-0000-0000000000e2', null, '00000000-0000-0000-0000-0000000000d1', 'incoming', 'other', 'received', 'x@y.test', null, 'Frage', 'Text', now());

insert into public.automation_runs (request_id, operation_key, step) values ('00000000-0000-0000-0000-000000000001', 'intake:r1', 'intake_analysis');

insert into public.work_entries (request_id, visit_id, author_id, kind, description, quantity, unit, unit_price, tax_rate) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'labor', 'Alt', 1, 'hour', 95, 19),
  ('00000000-0000-0000-0000-000000000001', null, '00000000-0000-0000-0000-0000000000b2', 'labor', 'Neu', 1, 'hour', 95, 19);

insert into public.invoices (request_id, created_by) values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2');

insert into public.attachments (request_id, visit_id, message_id, bucket, storage_path, file_name, mime_type, size_bytes, visibility) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', null, 'dashboard', 'r1/foto.jpg', 'foto.jpg', 'image/jpeg', 10, 'operational'),
  ('00000000-0000-0000-0000-000000000001', null, '00000000-0000-0000-0000-0000000000e1', 'dashboard', 'r1/brief.pdf', 'brief.pdf', 'application/pdf', 10, 'dispatch'),
  ('00000000-0000-0000-0000-000000000002', null, null, 'dashboard', 'r2/plan.pdf', 'plan.pdf', 'application/pdf', 10, 'operational');

insert into storage.objects (bucket_id, name) values ('dashboard', 'r1/foto.jpg'), ('dashboard', 'r1/brief.pdf'), ('dashboard', 'r2/plan.pdf');

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
$$;

-- Structure
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and c.relname in ('profiles', 'requests', 'messages', 'visits', 'work_entries', 'invoices', 'invoice_items',
                       'attachments', 'request_events', 'automation_runs', 'service_rates', 'employee_availability', 'settings')),
  13, 'RLS enabled on all 13 core tables'
);
select is((select public from storage.buckets where id = 'dashboard'), false, 'dashboard bucket is private');

-- Anonymous
set local role anon;
select throws_ok($$select * from public.requests$$, '42501', null, 'anon cannot read requests');
select throws_ok($$select * from public.profiles$$, '42501', null, 'anon cannot read profiles');
select is((select count(*)::int from storage.objects where bucket_id = 'dashboard'), 0, 'anon sees no dashboard files');
reset role;

-- Technician 1: historical participant of R1
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*)::int from public.requests), 1, 't1 sees R1 through own historical visit');
select is((select count(*)::int from public.visits), 1, 't1 sees only own historical visit');
select is((select count(*)::int from public.work_entries), 1, 't1 sees only own work entry');
select is((select count(*)::int from public.messages), 0, 't1 sees no correspondence');
select is((select count(*)::int from public.automation_runs), 0, 't1 sees no automation results');
select is((select count(*)::int from public.request_events), 1, 't1 sees only operational events');
select is((select count(*)::int from public.attachments), 1, 't1 sees only operational attachment of own visit');
select is((select count(*)::int from storage.objects where bucket_id = 'dashboard'), 1, 't1 can download one file');
select is((select count(*)::int from public.invoices), 1, 't1 sees related invoice');
select is((select count(*)::int from public.technician_busy_intervals('2026-10-19', '2026-10-26')), 0, 't1 gets no busy intervals');
select is((select count(*)::int from public.employee_availability), 2, 't1 sees own availability');
select throws_ok($$update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000b1'$$, '42501', null, 't1 cannot change own role');
select throws_ok($$update public.profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000b1'$$, '42501', null, 't1 cannot change own activity');
select throws_ok($$insert into public.request_events (request_id, actor_type, event_type) values ('00000000-0000-0000-0000-000000000001', 'system', 'note_added')$$, '42501', null, 't1 cannot write events directly');
reset role;

-- Trigger guard even if update privilege and an update policy existed
grant update on public.profiles to authenticated;
create policy temp_profiles_update on public.profiles for update to authenticated using (id = (select auth.uid()));
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000b1'$$, '42501', null, 'trigger blocks role change by client role');
reset role;
drop policy temp_profiles_update on public.profiles;
revoke update on public.profiles from authenticated;

-- Technician 2: currently assigned to R1 and R2
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((select count(*)::int from public.requests), 2, 't2 sees both assigned requests');
select is((select count(*)::int from public.visits), 3, 't2 sees all visits of current requests');
select is((select count(*)::int from public.work_entries), 2, 't2 sees all work entries of current request');
select is((select count(*)::int from public.employee_availability), 0, 't2 does not see t1 availability');
reset role;

-- Dispatcher 1: R1 and own inbox
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select is((select count(*)::int from public.requests), 1, 'd1 sees only own request');
select is((select count(*)::int from public.visits), 2, 'd1 sees only visits of own request');
select is((select count(*)::int from public.messages), 2, 'd1 sees request message and own inbox');
select is((select count(*)::int from public.request_events), 2, 'd1 sees operational and dispatch events');
select is((select count(*)::int from public.attachments), 2, 'd1 sees attachments of own request');
select is((select count(*)::int from public.automation_runs), 1, 'd1 sees automation result of own request');
select is((select count(*)::int from public.employee_availability), 1, 'd1 sees working hours, no absence details');
select is((select count(*)::int from public.technician_busy_intervals('2026-10-19', '2026-10-26')), 3, 'd1 gets busy intervals of all technicians');
select is(
  (select count(*)::int from public.technician_busy_intervals('2026-10-19', '2026-10-26') where technician_id = '00000000-0000-0000-0000-0000000000b2' and starts_at = '2026-10-20 08:00+02'),
  1, 'd1 sees interval of other dispatcher''s booking'
);
select is((select count(*)::int from public.profiles), 7, 'd1 sees minimal employee list');
reset role;

-- Dispatcher 2: reassignment-style isolation
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
set local role authenticated;
select is((select count(*)::int from public.requests), 1, 'd2 sees only own request');
select is((select count(*)::int from public.messages), 0, 'd2 sees no messages of d1');
select is((select count(*)::int from storage.objects where bucket_id = 'dashboard'), 1, 'd2 downloads only own request file');
reset role;

-- Manager and admin
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select is((select count(*)::int from public.requests), 2, 'manager sees all requests');
select is((select count(*)::int from public.request_events), 3, 'manager sees all event levels');
select is((select count(*)::int from public.employee_availability), 2, 'manager sees all availability');
reset role;

-- Deactivated manager
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a9');
set local role authenticated;
select is((select count(*)::int from public.requests), 0, 'deactivated employee sees no requests');
select is((select count(*)::int from public.profiles), 0, 'deactivated employee sees no profiles');
reset role;

select * from finish();
rollback;
