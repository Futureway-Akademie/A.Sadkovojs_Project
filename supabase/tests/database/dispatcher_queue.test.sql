-- task-5-1: dispatcher queues (view public.dispatcher_queue). Run with: supabase test db
begin;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005d1', 'q-d1@x.test'),
  ('00000000-0000-0000-0000-0000000005d2', 'q-d2@x.test'),
  ('00000000-0000-0000-0000-0000000005b1', 'q-t1@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000005d1', 'Queue Dispo 1', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000005d2', 'Queue Dispo 2', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000005b1', 'Queue Technik', 'technician');

create function pg_temp.q(n integer) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000000' || lpad(n::text, 3, '0'))::uuid;
$$;

-- q(501..511): see comments; all in 2030 so they never collide with demo data
insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id, created_at,
  intake_status, work_status, priority, intake_mode, intake_completed_at, manual_minutes_baseline, response_due_at, service_due_at)
select pg_temp.q(n), 'queue:' || n, 'x', 'demo_seed', 'Queue GmbH ' || n, 'Erika', 'e@q.test', '1', 'Str. 1', '40210', 'Düsseldorf',
  'pump', 'diagnosis_repair', date '2030-02-01', 'Test', urgency::public.customer_urgency, risk::public.safety_risk,
  '{}', disp, timestamptz '2030-01-01 08:00+01',
  intake::public.intake_status, work::public.work_status, prio::public.request_priority, mode::public.intake_mode,
  case when mode is null then null else timestamptz '2030-01-01 09:00+01' end,
  case when mode is null then null else 15 end,
  response_due::timestamptz, service_due::timestamptz
from (values
  -- n, urgency, risk, intake, work, priority, mode, response_due, service_due, dispatcher
  (501, 'production_stop', 'none_known', 'needs_review', 'not_planned', null, null, '2030-01-01 12:00+01', null, '00000000-0000-0000-0000-0000000005d1'::uuid),
  (502, 'planbar', 'none_known', 'needs_review', 'not_planned', null, null, '2030-01-01 10:00+01', null, '00000000-0000-0000-0000-0000000005d1'::uuid),
  (503, 'production_stop', 'none_known', 'needs_review', 'not_planned', null, null, null, null, '00000000-0000-0000-0000-0000000005d1'::uuid),
  (504, 'zeitnah', 'none_known', 'needs_review', 'not_planned', null, null, null, null, '00000000-0000-0000-0000-0000000005d1'::uuid),
  (505, 'zeitnah', 'none_known', 'awaiting_customer', 'not_planned', null, null, null, null, '00000000-0000-0000-0000-0000000005d1'::uuid),
  (506, 'planbar', 'none_known', 'processed', 'not_planned', 'normal', 'automatic', null, '2030-01-20 18:00+01', '00000000-0000-0000-0000-0000000005d1'::uuid),
  (507, 'planbar', 'none_known', 'processed', 'scheduled', 'normal', 'automatic', null, null, '00000000-0000-0000-0000-0000000005d1'::uuid),
  (508, 'planbar', 'none_known', 'processed', 'waiting_parts', 'high', 'manual', null, null, '00000000-0000-0000-0000-0000000005d1'::uuid),
  (509, 'planbar', 'none_known', 'processed', 'not_planned', 'critical', 'automatic', null, '2030-01-10 18:00+01', '00000000-0000-0000-0000-0000000005d1'::uuid),
  (510, 'planbar', 'known', 'processed', 'not_planned', 'low', 'automatic', null, null, '00000000-0000-0000-0000-0000000005d1'::uuid),
  (511, 'production_stop', 'none_known', 'needs_review', 'not_planned', null, null, null, null, '00000000-0000-0000-0000-0000000005d2'::uuid)
) as f(n, urgency, risk, intake, work, prio, mode, response_due, service_due, disp);

-- 504: customer reply after the last switch to awaiting_customer → reply_received
-- 505: old reply before the current wait → stays awaiting_customer
insert into public.request_events (request_id, actor_type, event_type, from_value, to_value, occurred_at) values
  (pg_temp.q(504), 'system', 'intake_status_changed', 'analyzing', 'awaiting_customer', timestamptz '2030-01-02 08:00+01'),
  (pg_temp.q(504), 'system', 'intake_status_changed', 'analyzing', 'needs_review', timestamptz '2030-01-03 09:02+01'),
  (pg_temp.q(505), 'system', 'intake_status_changed', 'analyzing', 'awaiting_customer', timestamptz '2030-01-04 08:00+01'),
  (pg_temp.q(501), 'system', 'intake_status_changed', 'analyzing', 'needs_review', timestamptz '2030-01-01 08:05+01'),
  (pg_temp.q(503), 'system', 'intake_status_changed', 'analyzing', 'needs_review', timestamptz '2030-01-01 08:10+01');
insert into public.messages (request_id, direction, kind, status, from_address, subject, body_text, received_at) values
  (pg_temp.q(504), 'incoming', 'customer_reply', 'received', 'e@q.test', 'AW', 'Antwort', timestamptz '2030-01-03 09:00+01'),
  (pg_temp.q(505), 'incoming', 'customer_reply', 'received', 'e@q.test', 'AW', 'Alt', timestamptz '2030-01-03 09:00+01');

-- 507 has a reserving visit; 508 only a visit waiting for parts
insert into public.visits (request_id, technician_id, status, scheduled_start, scheduled_end, actual_start, waiting_reason, created_by) values
  (pg_temp.q(507), '00000000-0000-0000-0000-0000000005b1', 'scheduled', '2030-01-15 08:00+01', '2030-01-15 10:00+01', null, null, '00000000-0000-0000-0000-0000000005d1'),
  (pg_temp.q(508), '00000000-0000-0000-0000-0000000005b1', 'waiting_parts', '2030-01-14 08:00+01', '2030-01-14 10:00+01', '2030-01-14 08:00+01', 'Teil bestellt', '00000000-0000-0000-0000-0000000005d1');

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.queue_of(n integer) returns text language sql as $$
  select queue from public.dispatcher_queue where id = pg_temp.q(n);
$$;

select is(pg_temp.queue_of(501), 'review', 'needs_review → Prüfung erforderlich');
select is(pg_temp.queue_of(504), 'reply_received', 'reply after the last wait → Kundenantwort erhalten');
select is(pg_temp.queue_of(505), 'awaiting_customer', 'old reply before the current wait → still waiting for the customer');
select is(pg_temp.queue_of(506), 'planning', 'automatically processed, not planned → Einsatzplanung erforderlich');
select is(pg_temp.queue_of(507), null, 'planned (reserving visit) → no queue');
select is(pg_temp.queue_of(508), 'planning', 'waiting for parts without reserving visit → follow-up planning');
select is((select safety_check_required from public.dispatcher_queue where id = pg_temp.q(510)), true, 'automatic with safety risk → check before planning');
select is((select waiting_since from public.dispatcher_queue where id = pg_temp.q(504)), timestamptz '2030-01-03 09:00+01', 'reply queue waits since the reply');
select is((select priority_rank from public.dispatcher_queue where id = pg_temp.q(501)), 1, 'without priority the customer urgency ranks (production stop = 1)');

-- Sorting: priority rank, deadline (nulls last), waiting time
select results_eq(
  $$ select id from public.dispatcher_queue where queue = 'review' and dispatcher_id = '00000000-0000-0000-0000-0000000005d1'
     order by priority_rank, due_at nulls last, waiting_since $$,
  $$ values (pg_temp.q(501)), (pg_temp.q(503)), (pg_temp.q(502)) $$,
  'review queue: production stop with deadline, production stop without deadline, planbar'
);
select results_eq(
  $$ select id from public.dispatcher_queue where queue = 'planning' and dispatcher_id = '00000000-0000-0000-0000-0000000005d1'
     order by priority_rank, due_at nulls last, waiting_since $$,
  $$ values (pg_temp.q(509)), (pg_temp.q(508)), (pg_temp.q(506)), (pg_temp.q(510)) $$,
  'planning queue: critical, high, normal, low'
);

-- Automatic requests stay until planned: a reserving visit removes 506 from the queue
insert into public.visits (request_id, technician_id, status, scheduled_start, scheduled_end, created_by) values
  (pg_temp.q(506), '00000000-0000-0000-0000-0000000005b1', 'scheduled', '2030-01-16 08:00+01', '2030-01-16 10:00+01', '00000000-0000-0000-0000-0000000005d1');
select is(pg_temp.queue_of(506), null, 'planned automatic request leaves the planning queue');

-- Terminal requests are in no queue
update public.requests set intake_status = 'cancelled', work_status = 'cancelled', cancellation_reason = 'Test', cancelled_at = now()
where id = pg_temp.q(503);
select is(pg_temp.queue_of(503), null, 'cancelled request → no queue');

-- RLS through security_invoker
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000005d1');
select is((select count(*)::int from public.dispatcher_queue where id::text like '00000000-0000-0000-0000-000000000_%' and id between pg_temp.q(501) and pg_temp.q(511)), 10, 'dispatcher 1 sees own 10 requests');
select is((select count(*)::int from public.dispatcher_queue where id = pg_temp.q(511)), 0, 'dispatcher 1 does not see the queue entry of dispatcher 2');
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.dispatcher_queue $$, '42501', null, 'anon has no access');
reset role;

select * from finish();
rollback;
