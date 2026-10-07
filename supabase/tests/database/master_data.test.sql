-- task-1-1: enums and master data tables. Run with: supabase test db
begin;
select plan(29);

-- Structure
select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'settings', 'settings exists');
select has_table('public', 'service_rates', 'service_rates exists');
select has_table('public', 'employee_availability', 'employee_availability exists');
select enum_has_labels('public', 'employee_role', array['admin', 'manager', 'dispatcher', 'technician'], 'employee_role labels');
select enum_has_labels('public', 'intake_status',
  array['new', 'analyzing', 'needs_review', 'awaiting_customer', 'processed', 'rejected', 'cancelled'], 'intake_status labels');
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.profiles'::regclass, 'public.settings'::regclass,
                 'public.service_rates'::regclass, 'public.employee_availability'::regclass)),
  'RLS enabled on all master data tables'
);

-- Fixtures
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'tech@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'nobody@example.test');
insert into public.profiles (id, display_name, role)
  values ('00000000-0000-0000-0000-000000000001', 'Test Technik', 'technician');

-- profiles
select is((select is_active from public.profiles where id = '00000000-0000-0000-0000-000000000001'), true, 'is_active defaults to true');
select throws_ok(
  $$insert into public.profiles (id, display_name, role) values ('00000000-0000-0000-0000-000000000099', 'X', 'admin')$$,
  '23503', null, 'profile requires an auth user'
);
select throws_ok(
  $$insert into public.profiles (id, display_name, role) values ('00000000-0000-0000-0000-000000000002', '  ', 'admin')$$,
  '23514', null, 'display_name must not be blank'
);
select throws_ok(
  $$delete from auth.users where id = '00000000-0000-0000-0000-000000000001'$$,
  '23503', null, 'auth user with profile cannot be deleted (restrict)'
);
select lives_ok(
  $$delete from auth.users where id = '00000000-0000-0000-0000-000000000002'$$,
  'auth user without profile can be deleted'
);

-- settings
select is((select count(*)::int from public.settings), 1, 'settings has exactly one row');
select is((select timezone from public.settings), 'Europe/Berlin', 'default timezone');
select throws_ok($$insert into public.settings (id) values (2)$$, '23514', null, 'settings id must be 1');
select throws_ok($$update public.settings set manual_intake_minutes = 0$$, '23514', null, 'manual_intake_minutes > 0');
select throws_ok($$update public.settings set default_tax_rate = 101$$, '23514', null, 'default_tax_rate <= 100');
select throws_ok($$update public.settings set payment_terms_days = -1$$, '23514', null, 'payment_terms_days >= 0');
select throws_ok($$update public.settings set currency = 'eur'$$, '23514', null, 'currency is a 3-letter code');

-- service_rates
insert into public.service_rates (code, service_kind, display_name, billing_model, unit_price, tax_rate)
  values ('REP-H', 'diagnosis_repair', 'Reparatur je Stunde', 'hourly', 95, 19);
select throws_ok(
  $$insert into public.service_rates (code, service_kind, display_name, billing_model, unit_price, tax_rate)
    values ('REP-H', 'diagnosis_repair', 'Duplikat', 'hourly', 95, 19)$$,
  '23505', null, 'service rate code is unique'
);
select throws_ok(
  $$insert into public.service_rates (code, service_kind, display_name, billing_model, unit_price, tax_rate)
    values ('NEG', 'inspection', 'Negativ', 'fixed', -1, 19)$$,
  '23514', null, 'unit_price >= 0'
);

-- employee_availability
select lives_ok(
  $$insert into public.employee_availability (employee_id, kind, weekday, local_start, local_end)
    values ('00000000-0000-0000-0000-000000000001', 'working_hours', 1, '07:00', '16:00')$$,
  'valid working hours accepted'
);
select throws_ok(
  $$insert into public.employee_availability (employee_id, kind, weekday, local_start, local_end)
    values ('00000000-0000-0000-0000-000000000001', 'working_hours', 8, '07:00', '16:00')$$,
  '23514', null, 'weekday between 1 and 7'
);
select throws_ok(
  $$insert into public.employee_availability (employee_id, kind, weekday, local_start, local_end)
    values ('00000000-0000-0000-0000-000000000001', 'working_hours', 1, '16:00', '07:00')$$,
  '23514', null, 'working hours end after start'
);
select throws_ok(
  $$insert into public.employee_availability (employee_id, kind, weekday)
    values ('00000000-0000-0000-0000-000000000001', 'working_hours', 1)$$,
  '23514', null, 'working hours require time window'
);
select throws_ok(
  $$insert into public.employee_availability (employee_id, kind, weekday, local_start, local_end, valid_from, valid_to)
    values ('00000000-0000-0000-0000-000000000001', 'working_hours', 1, '07:00', '16:00', '2026-02-01', '2026-01-01')$$,
  '23514', null, 'valid_to not before valid_from'
);
select lives_ok(
  $$insert into public.employee_availability (employee_id, kind, starts_at, ends_at, label)
    values ('00000000-0000-0000-0000-000000000001', 'absence', '2026-10-12 00:00+02', '2026-10-17 00:00+02', 'Urlaub')$$,
  'valid absence accepted'
);
select throws_ok(
  $$insert into public.employee_availability (employee_id, kind, starts_at, ends_at)
    values ('00000000-0000-0000-0000-000000000001', 'absence', '2026-10-17 00:00+02', '2026-10-12 00:00+02')$$,
  '23514', null, 'absence end after start'
);
select throws_ok(
  $$insert into public.employee_availability (employee_id, kind, starts_at, ends_at, weekday)
    values ('00000000-0000-0000-0000-000000000001', 'absence', '2026-10-12 00:00+02', '2026-10-17 00:00+02', 1)$$,
  '23514', null, 'absence must not carry weekly fields'
);

select * from finish();
rollback;
