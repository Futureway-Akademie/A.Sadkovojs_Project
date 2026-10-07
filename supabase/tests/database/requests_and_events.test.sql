-- task-1-2: requests and request_events. Run with: supabase test db
begin;
select plan(24);

-- Minimal valid request; tests override single columns
create temporary table request_template as
select
  'website_form'::text as source, 'ACME GmbH'::text as company_name, 'Erika Muster'::text as contact_name,
  'erika@acme.test'::text as business_email, '+49 211 000000'::text as phone_number,
  'Werkstr. 1'::text as street_house_number, '40210'::text as postal_code, 'Düsseldorf'::text as city,
  'pump'::public.equipment_kind as equipment_kind, 'diagnosis_repair'::public.service_kind as service_kind,
  date '2026-10-20' as requested_visit_date, 'Pumpe leckt'::text as description,
  'zeitnah'::public.customer_urgency as customer_urgency, 'none_known'::public.safety_risk as safety_risk,
  '{"form": "v1"}'::jsonb as raw_payload;

create function pg_temp.new_request(key text, created timestamptz default now(), number text default null)
returns public.requests language sql as $$
  insert into public.requests (
    source_event_key, request_number, created_at, source, company_name, contact_name, business_email, phone_number,
    street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
    customer_urgency, safety_risk, raw_payload)
  select key, coalesce(number, 'x'), created, source, company_name, contact_name, business_email, phone_number,
    street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
    customer_urgency, safety_risk, raw_payload
  from request_template
  returning *;
$$;

-- Structure
select has_table('public', 'requests', 'requests exists');
select has_table('public', 'request_events', 'request_events exists');
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.requests'::regclass, 'public.request_events'::regclass, 'public.request_number_counters'::regclass)),
  'RLS enabled on requests, request_events and counters'
);
select has_index('public', 'requests', 'requests_dispatcher_idx', 'index on dispatcher_id');
select has_index('public', 'request_events', 'request_events_request_time_idx', 'index on request events (request, time)');

-- Numbering
select is((pg_temp.new_request('k1', '2026-03-01 10:00+01')).request_number, 'RIS-2026-00001', 'first number of 2026');
select is((pg_temp.new_request('k2', '2026-03-02 10:00+01')).request_number, 'RIS-2026-00002', 'numbers increase per year');
select is((pg_temp.new_request('k3', '2025-06-01 10:00+02')).request_number, 'RIS-2025-00001', 'separate counter per year');
select is((pg_temp.new_request('k4', '2025-12-31 23:30+00')).request_number, 'RIS-2026-00003', 'year follows Europe/Berlin');
select is((pg_temp.new_request('k5', now(), 'RIS-1999-99999')).request_number ~ '^RIS-\d{4}-\d{5}$', true, 'client-supplied number is replaced');

-- Idempotency
select throws_ok($$select pg_temp.new_request('k1')$$, '23505', null, 'source_event_key is unique');

-- Defaults
select results_eq(
  $$select intake_status::text, work_status::text, version, sla_verified, is_demo from public.requests where source_event_key = 'k1'$$,
  $$values ('new', 'not_planned', 1, false, false)$$,
  'status, version and flag defaults'
);

-- Immutability and version
select throws_ok($$update public.requests set raw_payload = '{}' where source_event_key = 'k1'$$, '23514', null, 'raw_payload immutable');
select throws_ok($$update public.requests set request_number = 'RIS-2026-09999' where source_event_key = 'k1'$$, '23514', null, 'request_number immutable');
update public.requests set priority = 'high' where source_event_key = 'k1';
select is((select version from public.requests where source_event_key = 'k1'), 2, 'version increments on update');

-- Status constraints
select throws_ok($$update public.requests set intake_status = 'rejected' where source_event_key = 'k1'$$, '23514', null, 'rejection requires reason');
select throws_ok($$update public.requests set intake_status = 'cancelled', cancellation_reason = 'x' where source_event_key = 'k1'$$, '23514', null, 'cancellation requires cancelled_at');
select throws_ok($$update public.requests set work_status = 'completed', completed_at = now() where source_event_key = 'k1'$$, '23514', null, 'completion requires summary');
select throws_ok($$update public.requests set intake_completed_at = now() where source_event_key = 'k1'$$, '23514', null, 'intake completion snapshot is complete');
select throws_ok(
  $$update public.requests set intake_status = 'rejected', rejection_reason = 'x', intake_completed_at = now(), intake_mode = 'automatic', manual_minutes_baseline = 5 where source_event_key = 'k1'$$,
  '23514', null, 'automatic mode cannot reject'
);

-- Audit events
insert into public.request_events (request_id, actor_type, event_type)
  select id, 'system', 'submission_received' from public.requests where source_event_key = 'k1';
select throws_ok($$update public.request_events set note = 'x'$$, '42501', null, 'events cannot be updated');
select throws_ok($$delete from public.request_events$$, '42501', null, 'events cannot be deleted');
select throws_ok(
  $$insert into public.request_events (request_id, actor_type, event_type) select id, 'user', 'note_added' from public.requests where source_event_key = 'k1'$$,
  '23514', null, 'user events require actor_id'
);
select throws_ok(
  $$insert into public.request_events (request_id, actor_type, event_type) select id, 'system', 'Bad Code' from public.requests where source_event_key = 'k1'$$,
  '23514', null, 'event_type is a snake_case code'
);

select * from finish();
rollback;
