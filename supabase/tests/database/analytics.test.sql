-- task-7-1: analytics functions. Run with: supabase test db
-- Fixtures live in 2031 inside this transaction; measures are compared as differences before/after the
-- fixture, so existing (demo) data does not influence the result.
begin;
select plan(45);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0007-0000000000a1', 'an-manager@x.test'),
  ('00000000-0000-0000-0007-0000000000a9', 'an-inactive@x.test'),
  ('00000000-0000-0000-0007-0000000000d1', 'an-dispo@x.test'),
  ('00000000-0000-0000-0007-0000000000b1', 'an-tech@x.test');
insert into public.profiles (id, display_name, role, is_active) values
  ('00000000-0000-0000-0007-0000000000a1', 'Analytik Managerin', 'manager', true),
  ('00000000-0000-0000-0007-0000000000a9', 'Analytik Ehemalig', 'manager', false),
  ('00000000-0000-0000-0007-0000000000d1', 'Analytik Dispo', 'dispatcher', true),
  ('00000000-0000-0000-0007-0000000000b1', 'Analytik Technik', 'technician', true);

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0007-' || lpad(n::text, 12, '0'))::uuid;
$$;

-- ---- Period windows (pure, Europe/Berlin)
select is(
  (select row(current_start, current_end, previous_start, previous_end, is_complete)::text from public.analytics_window('month', null, '2026-10-08 10:00+02')),
  row(timestamptz '2026-10-01 00:00+02', timestamptz '2026-10-08 10:00+02', timestamptz '2026-09-01 00:00+02', timestamptz '2026-09-08 10:00+02', false)::text,
  'incomplete month: 1–8 Oct 10:00 compares with 1–8 Sep 10:00'
);
select is(
  (select row(current_start, current_end, previous_start, previous_end)::text from public.analytics_window('month', null, '2031-03-30 12:00+02')),
  row(timestamptz '2031-03-01 00:00+01', timestamptz '2031-03-30 12:00+02', timestamptz '2031-02-01 00:00+01', timestamptz '2031-03-01 00:00+01')::text,
  '30 March (after DST change) compares with the whole, shorter February'
);
select is(
  (select row(previous_start, previous_end)::text from public.analytics_window('month', null, '2031-03-10 08:00+01')),
  row(timestamptz '2031-02-01 00:00+01', timestamptz '2031-02-10 08:00+01')::text,
  '1–10 March 08:00 compares with 1–10 February 08:00'
);
select is(
  (select row(current_end, previous_end, is_complete)::text from public.analytics_window('month', '2031-03-15', '2031-04-02 09:00+02')),
  row(timestamptz '2031-04-01 00:00+02', timestamptz '2031-03-01 00:00+01', true)::text,
  'complete March compares with complete February'
);
select is(
  (select row(current_start, previous_start, previous_end)::text from public.analytics_window('week', '2031-03-12', '2031-03-12 12:00+01')),
  row(timestamptz '2031-03-10 00:00+01', timestamptz '2031-03-03 00:00+01', timestamptz '2031-03-05 12:00+01')::text,
  'week starts Monday; previous week over the same elapsed time'
);
select is(
  (select row(current_start, previous_start, previous_end)::text from public.analytics_window('quarter', null, '2031-05-15 00:00+02')),
  row(timestamptz '2031-04-01 00:00+02', timestamptz '2031-01-01 00:00+01', timestamptz '2031-02-14 00:00+01')::text,
  'quarter to date compares with the same 44 days of the previous quarter'
);
select throws_ok($$select * from public.analytics_window('decade')$$, 'RW422', null, 'unknown period kind is rejected');

-- ---- Access: managers/admins only, functions run with the caller's rights
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname like 'analytics\_%' and n.nspname in ('public', 'private') and p.prosecdef),
  0, 'no analytics function is security definer (RLS applies)'
);
select ok(not has_function_privilege('anon', 'public.analytics_kpis(text, date, timestamptz)', 'execute'), 'anon cannot execute analytics_kpis');

-- Baseline before the fixture (as manager)
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0007-0000000000a1');
create temporary table before_march as select * from public.analytics_kpis('month', '2031-03-01', '2031-04-02 09:00+02');
create temporary table before_april as select * from public.analytics_kpis('month', '2031-04-01', '2031-05-02 09:00+02');
create temporary table before_may as select * from public.analytics_kpis('month', '2031-05-01', '2031-06-02 09:00+02');
create temporary table before_series as select * from public.analytics_series('month', '2031-02-01', '2031-04-30');
create temporary table before_queues as select * from public.analytics_queue_history('2031-03-04', '2031-03-14');
reset role;

-- ---- Fixture (as postgres)
-- A: created Feb, automatic intake in March (eligible), scheduled 10 Mar, completed 10 Apr, invoiced 11 Apr, paid 10 May
-- B: automatic, corrected result (event)  C: human review  D: automatic, corrected automation run
-- E: needs review 12–13 Mar, processed 14 Mar, not planned
insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id, created_at)
select pg_temp.id(n), 'analytics:' || n, 'x', 'demo_seed', 'Analytik ' || n, 'Erika', 'a@x.test', '1', 'Str. 1', '40210', 'Düsseldorf',
  'pump', 'inspection', date '2031-06-01', 'Test', 'planbar', 'none_known', '{}', '00000000-0000-0000-0007-0000000000d1', created
from (values
  (1, timestamptz '2031-02-20 09:00+01'),
  (2, timestamptz '2031-03-03 09:00+01'),
  (3, timestamptz '2031-03-06 09:00+01'),
  (4, timestamptz '2031-03-07 09:00+01'),
  (5, timestamptz '2031-03-11 09:00+01')
) as f(n, created);

update public.requests r
set intake_status = 'processed', priority = 'normal', intake_completed_at = f.done, intake_mode = f.mode::public.intake_mode,
    manual_minutes_baseline = 15, technician_id = case when f.n = 1 then '00000000-0000-0000-0007-0000000000b1'::uuid end,
    response_due_at = f.due
from (values
  (1, timestamptz '2031-03-05 10:00+01', 'automatic', timestamptz '2031-03-05 12:00+01'),
  (2, timestamptz '2031-03-04 10:00+01', 'automatic', timestamptz '2031-03-04 09:00+01'),
  (3, timestamptz '2031-03-06 10:00+01', 'human_review', timestamptz '2031-03-06 12:00+01'),
  (4, timestamptz '2031-03-07 10:00+01', 'automatic', timestamptz '2031-03-07 12:00+01'),
  (5, timestamptz '2031-03-14 10:00+01', 'human_review', timestamptz '2031-03-14 12:00+01')
) as f(n, done, mode, due)
where r.id = pg_temp.id(f.n);

insert into public.request_events (request_id, actor_type, event_type, from_value, to_value, visibility, occurred_at) values
  (pg_temp.id(1), 'automation', 'intake_status_changed', 'new', 'analyzing', 'dispatch', '2031-02-20 09:05+01'),
  (pg_temp.id(1), 'automation', 'intake_status_changed', 'analyzing', 'processed', 'dispatch', '2031-03-05 10:00+01'),
  (pg_temp.id(1), 'system', 'work_status_changed', 'not_planned', 'scheduled', 'operational', '2031-03-10 08:00+01'),
  (pg_temp.id(1), 'system', 'work_status_changed', 'scheduled', 'in_progress', 'operational', '2031-04-10 08:00+02'),
  (pg_temp.id(1), 'system', 'work_status_changed', 'in_progress', 'completed', 'operational', '2031-04-10 12:00+02'),
  (pg_temp.id(2), 'system', 'automatic_result_corrected', null, null, 'dispatch', '2031-03-04 11:00+01'),
  (pg_temp.id(5), 'automation', 'intake_status_changed', 'new', 'needs_review', 'dispatch', '2031-03-12 09:00+01'),
  (pg_temp.id(5), 'system', 'intake_status_changed', 'needs_review', 'processed', 'dispatch', '2031-03-14 10:00+01');

insert into public.visits (request_id, technician_id, status, scheduled_start, scheduled_end, actual_start, actual_end, actual_work_minutes, summary, created_by)
values (pg_temp.id(1), '00000000-0000-0000-0007-0000000000b1', 'completed', '2031-04-10 08:00+02', '2031-04-10 10:00+02',
  '2031-04-10 08:00+02', '2031-04-10 09:30+02', 90, 'Inspektion', '00000000-0000-0000-0007-0000000000d1');
update public.requests set work_status = 'completed', completed_at = '2031-04-10 12:00+02', completion_summary = 'Fertig' where id = pg_temp.id(1);

insert into public.automation_runs (request_id, operation_key, step, status, decision, started_at, finished_at, corrected_at, corrected_by, correction_reason)
values (pg_temp.id(4), 'analytics:4', 'intake_analysis', 'succeeded', 'ready_for_planning', '2031-03-07 09:30+01', '2031-03-07 09:31+01',
  '2031-03-08 10:00+01', '00000000-0000-0000-0007-0000000000d1', 'Falsche Leistungsart');

insert into public.invoices (id, request_id, invoice_number, status, created_by, issued_by, issue_date, payment_due_date, issued_at, paid_at, subtotal, tax_total, total, created_at)
values (pg_temp.id(90), pg_temp.id(1), 'RE-2031-99001', 'paid', '00000000-0000-0000-0007-0000000000b1', '00000000-0000-0000-0007-0000000000b1',
  '2031-04-11', '2031-04-25', '2031-04-11 10:00+02', '2031-05-10 10:00+02', 100.00, 19.00, 119.00, '2031-04-11 09:00+02');

-- ---- Measures after the fixture (as manager)
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0007-0000000000a1');
create temporary table after_march as select * from public.analytics_kpis('month', '2031-03-01', '2031-04-02 09:00+02');
create temporary table after_april as select * from public.analytics_kpis('month', '2031-04-01', '2031-05-02 09:00+02');
create temporary table after_may as select * from public.analytics_kpis('month', '2031-05-01', '2031-06-02 09:00+02');
create temporary table after_series as select * from public.analytics_series('month', '2031-02-01', '2031-04-30');
create temporary table after_queues as select * from public.analytics_queue_history('2031-03-04', '2031-03-14');
create temporary table team as select * from public.analytics_team('month', '2031-04-01', '2031-05-02 09:00+02');
create temporary table team_march as select * from public.analytics_team('month', '2031-03-01', '2031-04-02 09:00+02');
create temporary table runs as select * from public.analytics_automation('month', '2031-03-01', '2031-04-02 09:00+02');
reset role;

create function pg_temp.delta(after_table text, before_table text, kpi text, col text default 'current_value') returns numeric language plpgsql as $$
declare result numeric;
begin
  execute format('select coalesce((select %1$I from %2$I where key = $1), 0) - coalesce((select %1$I from %3$I where key = $1), 0)', col, after_table, before_table)
    into result using kpi;
  return result;
end;
$$;

-- Event measures are counted by their own timestamp
select is(pg_temp.delta('after_march', 'before_march', 'received'), 4::numeric, 'March: 4 requests received (A came in February)');
select is(pg_temp.delta('after_march', 'before_march', 'received', 'previous_value'), 1::numeric, 'February (comparison): 1 request received');
select is(pg_temp.delta('after_march', 'before_march', 'intake_completed'), 5::numeric, 'March: 5 initial processings completed');
select is(pg_temp.delta('after_march', 'before_march', 'completed'), 0::numeric, 'March: no request completed');
select is(pg_temp.delta('after_april', 'before_april', 'completed'), 1::numeric, 'April: request A completed');

select is(
  (select array_agg(row(a.received - b.received, a.intake_completed - b.intake_completed, a.completed - b.completed)::text order by a.bucket_start)
   from after_series a join before_series b using (bucket_start)),
  array[row(1, 0, 0)::text, row(4, 5, 0)::text, row(0, 0, 1)::text],
  'series Feb–Apr: received, intake completed and completed in separate months'
);

-- Time savings only for correct automatic completions
select is(pg_temp.delta('after_march', 'before_march', 'time_saved_minutes'), 15::numeric, 'time saved: only A (15 min); B, D corrected, C/E human');
select is(
  ((select detail ->> 'requests' from after_march where key = 'time_saved_minutes')::int
   - (select detail ->> 'requests' from before_march where key = 'time_saved_minutes')::int),
  1, 'time saved: 1 eligible request in the detail (count for the tooltip)'
);
select is((select detail ->> 'baseline_max' from after_march where key = 'time_saved_minutes')::numeric, 15::numeric, 'time saved: baseline in the detail');
select ok(
  (select (detail ->> 'automatic')::int from after_march where key = 'automatic_share')
  - (select (detail ->> 'automatic')::int from before_march where key = 'automatic_share') = 3,
  'automatic share counts corrected automatic outcomes as automatic (A, B, D)'
);

-- Response deadline: B answered after its deadline, the others on time
select is(
  (select (detail ->> 'total')::int - (select (detail ->> 'total')::int from before_march where key = 'response_on_time') from after_march where key = 'response_on_time'),
  5, 'response deadlines due in March: 5'
);
select is(
  (select (detail ->> 'met')::int - (select (detail ->> 'met')::int from before_march where key = 'response_on_time') from after_march where key = 'response_on_time'),
  4, 'response deadlines met: 4 (B late)'
);

-- Money: issued is not paid
select is(pg_temp.delta('after_april', 'before_april', 'invoiced_gross'), 119.00::numeric, 'April: 119 € issued (gross)');
select is(pg_temp.delta('after_april', 'before_april', 'revenue_net'), 100.00::numeric, 'April: 100 € net revenue');
select is(pg_temp.delta('after_april', 'before_april', 'payments_received'), 0::numeric, 'April: nothing paid yet');
select is(pg_temp.delta('after_may', 'before_may', 'payments_received'), 119.00::numeric, 'May: 119 € received');

-- Snapshots at the end of the period
select is(pg_temp.delta('after_march', 'before_march', 'open_requests'), 5::numeric, 'end of March: 5 open requests');
select is(pg_temp.delta('after_march', 'before_march', 'open_requests', 'previous_value'), 1::numeric, 'end of February: 1 open request');
select is(pg_temp.delta('after_april', 'before_april', 'open_receivables'), 119.00::numeric, 'end of April: 119 € open');
select is(pg_temp.delta('after_april', 'before_april', 'overdue_receivables'), 119.00::numeric, 'end of April: overdue (due 25 April)');
select is(pg_temp.delta('after_may', 'before_may', 'open_receivables'), 0::numeric, 'end of May: paid, nothing open');
select is((select measure from after_april where key = 'open_receivables'), 'snapshot', 'receivables are marked as snapshot');
select is((select measure from after_april where key = 'invoiced_gross'), 'event', 'issued invoices are marked as event');

-- Queue history from request_events (end of each local day)
create temporary table queue_delta as
select a.day, a.queue, a.requests - b.requests as delta
from after_queues a join before_queues b using (day, queue);
select is((select delta from queue_delta where day = '2031-03-12' and queue = 'review'), 1, '12 March: E in review');
select is((select delta from queue_delta where day = '2031-03-13' and queue = 'review'), 1, '13 March: E still in review');
select is((select delta from queue_delta where day = '2031-03-14' and queue = 'review'), 0, '14 March: E processed, no longer in review');
select is((select delta from queue_delta where day = '2031-03-05' and queue = 'planning'), 2, '5 March: A (processed that day) and B (no events) wait for planning');
select is((select delta from queue_delta where day = '2031-03-10' and queue = 'planning'), 3, '10 March: A scheduled; B, C, D (no events) planning');
select is((select delta from queue_delta where day = '2031-03-14' and queue = 'planning'), 4, '14 March: B, C, D and E planning');

-- Team and automation
select is(
  (select row(visits_completed, work_minutes, requests_completed)::text from team where employee_id = '00000000-0000-0000-0007-0000000000b1'),
  row(1, 90, 1)::text, 'technician: 1 visit, 90 min, 1 completed request in April'
);
select is(
  (select intake_completed from team_march where employee_id = '00000000-0000-0000-0007-0000000000d1'),
  2, 'dispatcher: 2 human initial processings in March (C, E)'
);
select is(
  (select sum(corrected)::int from runs where step = 'intake_analysis'),
  1, 'automation: corrected run counted'
);

-- Zero base yields no percentage (completed: March 0 → April 1 for the fixture)
select ok(
  (select previous_value = 0 and current_value >= 1 and change_percent is null and difference = current_value from after_april where key = 'completed'),
  'zero base: no change percentage, difference only'
);

-- Other roles are rejected; an inactive manager too
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0007-0000000000d1');
select throws_ok($$select * from public.analytics_kpis('month', '2031-03-01', '2031-04-02 09:00+02')$$, '42501', null, 'dispatcher: no KPIs');
select pg_temp.act_as('00000000-0000-0000-0007-0000000000b1');
select throws_ok($$select * from public.analytics_series('month', '2031-01-01', '2031-04-30')$$, '42501', null, 'technician: no series');
select pg_temp.act_as('00000000-0000-0000-0007-0000000000a9');
select throws_ok($$select * from public.analytics_team('month')$$, '42501', null, 'inactive manager: no team overview');
reset role;

select * from finish();
rollback;
