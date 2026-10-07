-- task-2-1: controlled operations for initial processing, assignment and deadlines. Run with: supabase test db
begin;
select plan(45);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'm@x.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'd2@x.test'),
  ('00000000-0000-0000-0000-0000000000d9', 'dx@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 't1@x.test');
insert into public.profiles (id, display_name, role, is_active) values
  ('00000000-0000-0000-0000-0000000000a1', 'Managerin', 'manager', true),
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher', true),
  ('00000000-0000-0000-0000-0000000000d2', 'Dispo 2', 'dispatcher', true),
  ('00000000-0000-0000-0000-0000000000d9', 'Dispo alt', 'dispatcher', false),
  ('00000000-0000-0000-0000-0000000000b1', 'Technik 1', 'technician', true);

-- Requests r1..r6, all assigned to d1 and t1
insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id, technician_id)
select ('00000000-0000-0000-0000-00000000000' || n)::uuid, 'r' || n, 'x', 'demo_seed', 'ACME', 'Erika', 'e@acme.test', '1',
  'Str. 1', '40210', 'Düsseldorf', 'pump', 'diagnosis_repair', date '2026-10-20', 'Test', 'planbar', 'none_known', '{}',
  '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1'
from generate_series(1, 6) as n;

-- r4: work already started; r5: scheduled visit; r6: processed automatically with an analysis run
update public.requests set work_status = 'in_progress' where id = '00000000-0000-0000-0000-000000000004';
insert into public.visits (id, request_id, technician_id, scheduled_start, scheduled_end, created_by) values
  ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000b1',
   '2026-10-21 08:00+02', '2026-10-21 10:00+02', '00000000-0000-0000-0000-0000000000d1');
update public.requests set intake_status = 'processed', priority = 'normal', intake_completed_at = now(), intake_mode = 'automatic', manual_minutes_baseline = 5
  where id = '00000000-0000-0000-0000-000000000006';
insert into public.automation_runs (id, request_id, operation_key, step, status, decision, finished_at) values
  ('00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-000000000006', 'intake:r6', 'intake_analysis', 'succeeded', 'ready_for_planning', now());

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.v(n int) returns int language sql as $$
  select version from public.requests where id = ('00000000-0000-0000-0000-00000000000' || n)::uuid;
$$;
create function pg_temp.events(n int, code text) returns int language sql as $$
  select count(*)::int from public.request_events where request_id = ('00000000-0000-0000-0000-00000000000' || n)::uuid and event_type = code;
$$;

-- Permissions
set local role anon;
select throws_ok($$select public.complete_intake('00000000-0000-0000-0000-000000000001', 1, 'high')$$, '42501', null, 'anon cannot call operations');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$select public.complete_intake('00000000-0000-0000-0000-000000000001', 1, 'high')$$, '42501', null, 'technician cannot complete intake');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
set local role authenticated;
select throws_ok($$select public.complete_intake('00000000-0000-0000-0000-000000000001', 1, 'high')$$, '42501', null, 'other dispatcher has no access');
reset role;

-- Dispatcher d1 on r1: review, complete, repeat, reopen, complete again
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select throws_ok($$select public.mark_needs_review('00000000-0000-0000-0000-000000000001', 7)$$, 'RW409', null, 'stale version rejected');
select throws_ok($$select public.complete_intake('00000000-0000-0000-0000-000000000001', 1)$$, 'RW422', null, 'priority required for completion');
select is((public.mark_needs_review('00000000-0000-0000-0000-000000000001', 1, 'Widerspruch')).intake_status, 'needs_review', 'new -> needs_review');
reset role;
select is(pg_temp.v(1), 2, 'version incremented');
select is((select human_review_required from public.requests where id = '00000000-0000-0000-0000-000000000001'), true, 'human review flag set');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select is((public.complete_intake('00000000-0000-0000-0000-000000000001', 2, 'high')).intake_status, 'processed', 'needs_review -> processed');
reset role;
select results_eq(
  $$select intake_mode::text, manual_minutes_baseline, intake_completed_at is not null, priority::text from public.requests where id = '00000000-0000-0000-0000-000000000001'$$,
  $$select 'human_review', manual_intake_minutes, true, 'high' from public.settings$$,
  'first completion snapshot: human_review, baseline from settings'
);
select is(pg_temp.events(1, 'intake_completed'), 1, 'intake_completed event written');
select is((select actor_id from public.request_events where request_id = '00000000-0000-0000-0000-000000000001' and event_type = 'intake_completed'),
  '00000000-0000-0000-0000-0000000000d1'::uuid, 'event actor is the caller');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select is((public.complete_intake('00000000-0000-0000-0000-000000000001', 3)).version, 3, 'repeated completion returns existing outcome');
select throws_ok($$select public.reopen_intake('00000000-0000-0000-0000-000000000001', 3, 'needs_review', ' ')$$, 'RW422', null, 'reopening requires reason');
select throws_ok($$select public.reopen_intake('00000000-0000-0000-0000-000000000001', 3, 'new', 'x')$$, 'RW422', null, 'cannot reopen to new');
select is((public.reopen_intake('00000000-0000-0000-0000-000000000001', 3, 'awaiting_customer', 'Angaben fehlen')).intake_status, 'awaiting_customer', 'processed -> awaiting_customer (reopen)');
select is((public.resume_analysis('00000000-0000-0000-0000-000000000001', 4, 'Antwort da')).intake_status, 'analyzing', 'awaiting_customer -> analyzing');
select is((public.complete_intake('00000000-0000-0000-0000-000000000001', 5)).intake_status, 'processed', 'processed again after reopening');
reset role;
select is(pg_temp.events(1, 'intake_completed'), 1, 'no second intake_completed event');
select is((select intake_mode::text from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'human_review', 'first completion mode preserved');
select is(pg_temp.events(1, 'intake_status_changed'), 5, 'every status change audited');
select throws_ok($$update public.requests set intake_mode = 'automatic' where id = '00000000-0000-0000-0000-000000000001'$$, '23514', null, 'snapshot is write-once even for trusted roles');

-- Manual completion from new; rejection; cancellation
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select is((public.complete_intake('00000000-0000-0000-0000-000000000002', 1, 'normal')).intake_mode::text, 'manual', 'completion from new is manual');
select throws_ok($$select public.reject_request('00000000-0000-0000-0000-000000000003', 1, '')$$, 'RW422', null, 'rejection requires reason');
select is((public.reject_request('00000000-0000-0000-0000-000000000003', 1, 'Kein Industriekunde')).intake_status, 'rejected', 'new -> rejected');
select throws_ok($$select public.reject_request('00000000-0000-0000-0000-000000000004', 2, 'zu spät')$$, 'RW422', null, 'no rejection after work started');
select throws_ok($$select public.cancel_request('00000000-0000-0000-0000-000000000005', 1, null)$$, 'RW422', null, 'cancellation requires reason');
select is((public.cancel_request('00000000-0000-0000-0000-000000000005', 1, 'Kunde hat abgesagt')).intake_status, 'cancelled', 'cancelled with reason');
select throws_ok($$select public.cancel_request('00000000-0000-0000-0000-000000000005', 2, 'nochmal')$$, 'RW422', null, 'cannot cancel twice');
reset role;
select results_eq(
  $$select intake_mode::text, work_status::text, rejection_reason from public.requests where id = '00000000-0000-0000-0000-000000000003'$$,
  $$values ('manual', 'cancelled', 'Kein Industriekunde')$$,
  'rejection records manual first outcome and ends work'
);
select results_eq(
  $$select intake_completed_at is null, cancelled_at is not null, (select status::text from public.visits where id = '00000000-0000-0000-0000-0000000000c5')
    from public.requests where id = '00000000-0000-0000-0000-000000000005'$$,
  $$values (true, true, 'cancelled')$$,
  'cancellation without fictitious completion; open visit cancelled'
);

-- Corrections
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select throws_ok($$select public.correct_analysis('00000000-0000-0000-0000-000000000006', 2, 'nichts')$$, 'RW422', null, 'correction needs a change');
select is((public.correct_analysis('00000000-0000-0000-0000-000000000006', 2, 'Leck ist kritisch', priority => 'critical', automation_run_id => '00000000-0000-0000-0000-0000000000f6')).priority::text,
  'critical', 'priority corrected');
reset role;
select is(pg_temp.events(6, 'automatic_result_corrected'), 1, 'automatic correction audited');
select is((select corrected_by from public.automation_runs where id = '00000000-0000-0000-0000-0000000000f6'), '00000000-0000-0000-0000-0000000000d1'::uuid, 'run marked as corrected');

-- Deadlines
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select throws_ok($$select public.change_deadline('00000000-0000-0000-0000-000000000002', 2, 'payment', now(), 'x')$$, 'RW422', null, 'unknown deadline kind rejected');
select is((public.change_deadline('00000000-0000-0000-0000-000000000002', 2, 'response', now() - interval '1 day', 'Zusage am Telefon')).version, 3, 'deadline set');
select is((public.change_deadline('00000000-0000-0000-0000-000000000002', 3, 'response', now() + interval '2 days', 'Kunde im Urlaub')).version, 4, 'deadline moved');
reset role;
select is(
  (select (data ->> 'breach_recorded')::boolean from public.request_events
   where request_id = '00000000-0000-0000-0000-000000000002' and event_type = 'deadline_changed' and data ->> 'old_due_at' is not null),
  true, 'moving an elapsed deadline records the breach'
);

-- Dispatcher reassignment
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select throws_ok($$select public.assign_dispatcher('00000000-0000-0000-0000-000000000002', 4, '00000000-0000-0000-0000-0000000000d2')$$, '42501', null, 'dispatcher cannot reassign');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_ok($$select public.assign_dispatcher('00000000-0000-0000-0000-000000000002', 4, '00000000-0000-0000-0000-0000000000d9')$$, 'RW422', null, 'inactive dispatcher rejected');
select throws_ok($$select public.assign_dispatcher('00000000-0000-0000-0000-000000000002', 4, '00000000-0000-0000-0000-0000000000b1')$$, 'RW422', null, 'technician cannot be dispatcher');
select is((public.assign_dispatcher('00000000-0000-0000-0000-000000000002', 4, '00000000-0000-0000-0000-0000000000d2')).dispatcher_id,
  '00000000-0000-0000-0000-0000000000d2'::uuid, 'manager reassigns dispatcher');
reset role;
select is(pg_temp.events(2, 'dispatcher_assigned'), 1, 'reassignment audited');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select throws_ok($$select public.mark_awaiting_customer('00000000-0000-0000-0000-000000000002', 5)$$, '42501', null, 'previous dispatcher loses access immediately');
reset role;

select * from finish();
rollback;
