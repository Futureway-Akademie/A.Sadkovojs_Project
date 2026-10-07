-- task-6-2: follow-up request on visit completion and visit photos. Run with: supabase test db
begin;
select plan(18);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000006d1', 'f-d1@x.test'),
  ('00000000-0000-0000-0000-0000000006b1', 'f-t1@x.test'),
  ('00000000-0000-0000-0000-0000000006b2', 'f-t2@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000006d1', 'Follow Dispo', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000006b1', 'Follow Technik 1', 'technician'),
  ('00000000-0000-0000-0000-0000000006b2', 'Follow Technik 2', 'technician');

create function pg_temp.r(n integer) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000000' || lpad(n::text, 3, '0'))::uuid;
$$;
create function pg_temp.v(n integer) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000006' || lpad(n::text, 3, '0'))::uuid;
$$;

-- r601: in progress, single running visit v601; r602: in progress, running v602 plus scheduled v603;
-- r604: waiting for parts, visit v604 waiting; r605: photo target with running visit v605 (technician 1)
insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id, technician_id,
  intake_status, work_status, priority, intake_mode, intake_completed_at, manual_minutes_baseline)
select pg_temp.r(n), 'follow:' || n, 'x', 'demo_seed', 'Follow GmbH ' || n, 'Erika', 'e@f.test', '1', 'Str. 1', '40210', 'Düsseldorf',
  'pump', 'diagnosis_repair', date '2030-02-01', 'Test', 'planbar', 'none_known', '{}',
  '00000000-0000-0000-0000-0000000006d1', '00000000-0000-0000-0000-0000000006b1',
  'processed', work::public.work_status, 'normal', 'manual', timestamptz '2030-01-01 09:00+01', 15
from (values (601, 'in_progress'), (602, 'in_progress'), (604, 'waiting_parts'), (605, 'in_progress')) as f(n, work);

insert into public.visits (id, request_id, technician_id, status, scheduled_start, scheduled_end, actual_start, waiting_reason, created_by) values
  (pg_temp.v(601), pg_temp.r(601), '00000000-0000-0000-0000-0000000006b1', 'in_progress', '2030-02-04 08:00+01', '2030-02-04 10:00+01', '2030-02-04 08:00+01', null, '00000000-0000-0000-0000-0000000006d1'),
  (pg_temp.v(602), pg_temp.r(602), '00000000-0000-0000-0000-0000000006b1', 'in_progress', '2030-02-05 08:00+01', '2030-02-05 10:00+01', '2030-02-05 08:00+01', null, '00000000-0000-0000-0000-0000000006d1'),
  (pg_temp.v(603), pg_temp.r(602), '00000000-0000-0000-0000-0000000006b1', 'scheduled', '2030-02-12 08:00+01', '2030-02-12 10:00+01', null, null, '00000000-0000-0000-0000-0000000006d1'),
  (pg_temp.v(604), pg_temp.r(604), '00000000-0000-0000-0000-0000000006b1', 'waiting_parts', '2030-02-06 08:00+01', '2030-02-06 10:00+01', '2030-02-06 08:00+01', 'Lager bestellt', '00000000-0000-0000-0000-0000000006d1'),
  (pg_temp.v(605), pg_temp.r(605), '00000000-0000-0000-0000-0000000006b1', 'in_progress', '2030-02-07 08:00+01', '2030-02-07 10:00+01', '2030-02-07 08:00+01', null, '00000000-0000-0000-0000-0000000006d1');

insert into storage.objects (bucket_id, name) values
  ('dashboard', 'visits/' || pg_temp.r(605) || '/' || pg_temp.v(605) || '/foto-1.jpg'),
  ('dashboard', 'visits/' || pg_temp.r(601) || '/' || pg_temp.v(601) || '/fremd.jpg');

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.version_of(n integer) returns integer language sql security definer as $$
  select version from public.requests where id = pg_temp.r(n);
$$;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000006b1');

-- Completion without follow-up never closes the request
select lives_ok(format($$ select public.complete_visit(%L, %s, 90, 'Fertig') $$, pg_temp.v(602), pg_temp.version_of(602)), 'complete without follow-up');
select is((select work_status::text from public.requests where id = pg_temp.r(602)), 'in_progress', 'request stays in progress (not completed)');

-- Follow-up needs a reason
select throws_ok(format($$ select public.complete_visit(%L, %s, 60, null, '  ') $$, pg_temp.v(601), pg_temp.version_of(601)), 'RW422', null, 'follow-up without reason rejected');

-- Follow-up returns the request to planning
select lives_ok(format($$ select public.complete_visit(%L, %s, 60, 'Dichtung getauscht', 'Zweite Pumpe prüfen') $$, pg_temp.v(601), pg_temp.version_of(601)), 'complete with follow-up');
select is((select status::text from public.visits where id = pg_temp.v(601)), 'completed', 'visit completed');
select is((select work_status::text from public.requests where id = pg_temp.r(601)), 'not_planned', 'request back to not planned');
select is((select work_status::text from public.requests where id = pg_temp.r(601)) <> 'completed', true, 'completing a visit does not close the request');
select is((select count(*)::int from public.request_events where request_id = pg_temp.r(601) and event_type = 'follow_up_requested' and note = 'Zweite Pumpe prüfen'), 1, 'follow-up event with reason');
reset role;
select is((select queue from public.dispatcher_queue where id = pg_temp.r(601)), 'planning', 'request appears in the planning queue');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000006b1');

-- Waiting for parts stays waiting_parts
select lives_ok(format($$ select public.complete_visit(%L, %s, 30, null, 'Nach Teilelieferung') $$, pg_temp.v(604), pg_temp.version_of(604)), 'complete waiting visit with follow-up');
select is((select work_status::text from public.requests where id = pg_temp.r(604)), 'waiting_parts', 'parts request stays waiting for parts');

-- Photos
select pg_temp.act_as('00000000-0000-0000-0000-0000000006b2');
select throws_ok(format($$ select public.add_visit_photo(%L, %s, %L, 'foto-1.jpg', 'image/jpeg', 1000) $$,
  pg_temp.v(605), pg_temp.version_of(605), 'visits/' || pg_temp.r(605) || '/' || pg_temp.v(605) || '/foto-1.jpg'), '42501', null, 'foreign technician cannot add photos');
select pg_temp.act_as('00000000-0000-0000-0000-0000000006b1');
select throws_ok(format($$ select public.add_visit_photo(%L, %s, %L, 'fehlt.jpg', 'image/jpeg', 1000) $$,
  pg_temp.v(605), pg_temp.version_of(605), 'visits/' || pg_temp.r(605) || '/' || pg_temp.v(605) || '/fehlt.jpg'), 'RW422', 'Datei wurde nicht hochgeladen', 'storage object must exist');
select throws_ok(format($$ select public.add_visit_photo(%L, %s, %L, 'fremd.jpg', 'image/jpeg', 1000) $$,
  pg_temp.v(605), pg_temp.version_of(605), 'visits/' || pg_temp.r(601) || '/' || pg_temp.v(601) || '/fremd.jpg'), 'RW422', 'Ungültiger Speicherpfad', 'path must belong to the visit');
select throws_ok(format($$ select public.add_visit_photo(%L, %s, %L, 'foto-1.pdf', 'application/pdf', 1000) $$,
  pg_temp.v(605), pg_temp.version_of(605), 'visits/' || pg_temp.r(605) || '/' || pg_temp.v(605) || '/foto-1.jpg'), 'RW422', 'Nur JPEG- oder PNG-Fotos', 'only images');
select lives_ok(format($$ select public.add_visit_photo(%L, %s, %L, 'Typenschild.jpg', 'image/jpeg', 1000) $$,
  pg_temp.v(605), pg_temp.version_of(605), 'visits/' || pg_temp.r(605) || '/' || pg_temp.v(605) || '/foto-1.jpg'), 'own technician adds photo');
select is((select visibility::text || '|' || (uploaded_by = '00000000-0000-0000-0000-0000000006b1')::text from public.attachments where visit_id = pg_temp.v(605)), 'operational|true', 'photo is operational and attributed');
reset role;
select is((select count(*)::int from public.request_events where request_id = pg_temp.r(605) and event_type = 'photo_added'), 1, 'photo event written');

select * from finish();
rollback;
