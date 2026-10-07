-- task-3-3: verification fixture "100 automatic completions x 15 minutes" (spec section 7, scenario 5).
-- The fixture lives only inside this transaction (ROLLBACK) and is never part of the demo seed totals.
-- Formula: estimated savings = sum(manual_minutes_baseline) / 60 over eligible requests:
--   initial processing completed in the period, intake_mode = automatic, no recorded correction.
-- Run with: supabase test db
begin;
select plan(9);

-- Period of the fixture
create temporary table fixture_period as
select timestamptz '2030-05-01 00:00+02' as period_start, timestamptz '2030-06-01 00:00+02' as period_end;

create function pg_temp.fixture_id(n integer) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid;
$$;

-- Helper to insert a completed request of the fixture
create function pg_temp.fixture_request(n integer, mode public.intake_mode, completed timestamptz) returns void language sql as $$
  insert into public.requests (
    id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
    street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
    customer_urgency, safety_risk, raw_payload, created_at,
    intake_status, priority, intake_completed_at, intake_mode, manual_minutes_baseline)
  select pg_temp.fixture_id(n), 'fixture:savings:' || n, 'x', 'demo_seed', 'Fixture GmbH', 'Max Muster', 'fixture@example.com', '+49 1',
    'Str. 1', '40210', 'Düsseldorf', 'pump', 'inspection', date '2030-05-20', 'Fixture', 'planbar', 'none_known', '{}',
    completed - interval '3 minutes',
    'processed', 'normal', completed, mode, s.manual_intake_minutes
  from public.settings s;
$$;

-- 100 eligible automatic completions in May 2030
select pg_temp.fixture_request(n, 'automatic', timestamptz '2030-05-02 08:00+02' + n * interval '6 hours') from generate_series(1, 100) as n;

-- One of them had several runs and messages but only one completion
insert into public.automation_runs (request_id, operation_key, step, status, decision, started_at, finished_at)
values
  (pg_temp.fixture_id(1), 'fixture:1:intake', 'intake_analysis', 'succeeded', 'ask_customer', timestamptz '2030-05-02 13:50+02', timestamptz '2030-05-02 13:51+02'),
  (pg_temp.fixture_id(1), 'fixture:1:reply-1', 'reply_analysis', 'succeeded', 'ask_customer', timestamptz '2030-05-02 13:55+02', timestamptz '2030-05-02 13:56+02'),
  (pg_temp.fixture_id(1), 'fixture:1:reply-2', 'reply_analysis', 'succeeded', 'ready_for_planning', timestamptz '2030-05-02 13:58+02', timestamptz '2030-05-02 13:59+02');
insert into public.messages (request_id, direction, kind, status, from_address, subject, body_text, received_at)
select pg_temp.fixture_id(1), 'incoming', 'customer_reply', 'received', 'fixture@example.com', 'AW: Rückfrage ' || n, 'Antwort', timestamptz '2030-05-02 13:54+02'
from generate_series(1, 2) as n;
insert into public.request_events (request_id, actor_type, event_type, to_value, occurred_at)
values (pg_temp.fixture_id(1), 'automation', 'intake_completed', 'automatic', timestamptz '2030-05-02 14:00+02');

-- Not eligible: human involvement, manual processing, corrected automatic outcome, outside the period, pending
select pg_temp.fixture_request(200 + n, 'human_review', timestamptz '2030-05-10 10:00+02' + n * interval '1 hour') from generate_series(1, 10) as n;
select pg_temp.fixture_request(300 + n, 'manual', timestamptz '2030-05-11 10:00+02' + n * interval '1 hour') from generate_series(1, 10) as n;
select pg_temp.fixture_request(400 + n, 'automatic', timestamptz '2030-05-12 10:00+02' + n * interval '1 hour') from generate_series(1, 5) as n;
insert into auth.users (id, email) values ('00000000-0000-0000-0001-0000000009d1', 'fixture-dispo@example.com');
insert into public.profiles (id, display_name, role) values ('00000000-0000-0000-0001-0000000009d1', 'Fixture Dispo', 'dispatcher');
insert into public.request_events (request_id, actor_type, actor_id, event_type, visibility, occurred_at)
select pg_temp.fixture_id(400 + n), 'user', '00000000-0000-0000-0001-0000000009d1', 'automatic_result_corrected', 'dispatch', timestamptz '2030-05-13 10:00+02'
from generate_series(1, 5) as n;
select pg_temp.fixture_request(500 + n, 'automatic', timestamptz '2030-06-02 10:00+02') from generate_series(1, 3) as n;
insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, created_at)
values (pg_temp.fixture_id(600), 'fixture:savings:pending', 'x', 'demo_seed', 'Fixture GmbH', 'Max', 'fixture@example.com', '+49 1',
  'Str. 1', '40210', 'Düsseldorf', 'pump', 'inspection', date '2030-05-20', 'Fixture', 'planbar', 'none_known', '{}', timestamptz '2030-05-30 10:00+02');

-- Eligible set according to the documented formula
create temporary view fixture_eligible as
select r.id, r.manual_minutes_baseline
from public.requests r, fixture_period p
where r.id::text like '00000000-0000-0000-0001-%'
  and r.intake_completed_at >= p.period_start and r.intake_completed_at < p.period_end
  and r.intake_mode = 'automatic'
  and not exists (select 1 from public.request_events e where e.request_id = r.id and e.event_type = 'automatic_result_corrected')
  and not exists (select 1 from public.automation_runs a where a.request_id = r.id and a.corrected_at is not null);

select is((select manual_intake_minutes from public.settings), 15.00::numeric, 'demo baseline is 15 minutes');
select is((select count(*)::int from fixture_eligible), 100, '100 eligible automatic completions');
select is((select sum(manual_minutes_baseline) from fixture_eligible), 1500.00::numeric, 'fixture yields 1,500 minutes');
select is((select sum(manual_minutes_baseline) / 60 from fixture_eligible), 25::numeric, 'fixture yields 25 hours');
select is(
  (select format('%s h %s min', floor(sum(manual_minutes_baseline) / 60), (sum(manual_minutes_baseline) % 60)::int) from fixture_eligible),
  '25 h 0 min', 'display value 25 h 0 min'
);
select is(
  (select count(*)::int from public.request_events where request_id = pg_temp.fixture_id(1) and event_type = 'intake_completed'),
  1, 'several runs and messages, one completion'
);
select is(
  (select count(*)::int from public.requests r, fixture_period p
   where r.id::text like '00000000-0000-0000-0001-%' and r.intake_completed_at >= p.period_start and r.intake_completed_at < p.period_end),
  125, 'completions in period: 100 automatic + 10 human review + 10 manual + 5 corrected'
);
select is(
  (select round(100.0 * count(*) filter (where intake_mode = 'automatic') / count(*), 1) from public.requests r, fixture_period p
   where r.id::text like '00000000-0000-0000-0001-%' and r.intake_completed_at >= p.period_start and r.intake_completed_at < p.period_end),
  84.0, 'automatic share counts corrected outcomes as automatic first outcome (105 of 125)'
);
select is(
  (select count(*)::int from public.requests where id = pg_temp.fixture_id(600) and intake_completed_at is null),
  1, 'pending request is neither success nor failure'
);

select * from finish();
rollback;
