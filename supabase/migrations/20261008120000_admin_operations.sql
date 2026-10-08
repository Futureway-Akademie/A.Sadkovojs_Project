-- Administration (task-8-1): employees, roles, deactivation with reassignment, service rates, working hours,
-- absences and settings. Only active admins; every write goes through these security definer functions.
--
-- * Employees are never deleted. Deactivation requires that the employee's active assignments (open requests as
--   dispatcher or technician, scheduled visits) are moved to an active replacement of the same role in the same
--   transaction; running visits must be finished first.
-- * Creating a login (auth.users) needs the Auth Admin API and happens in a server action with the secret key;
--   passwords live only in Supabase Auth, never in profiles.
-- * Settings changes only affect later initial processing: requests freeze manual_minutes_baseline when their
--   initial processing is completed (complete_intake, reject_request); issued invoices keep their snapshots.

-- Active assignments of an employee (internal, used for the overview and the deactivation)
create function private.employee_assignments(target_employee_id uuid)
returns table (
  assignment text,
  request_id uuid,
  request_number text,
  company_name text,
  visit_id uuid,
  visit_status public.visit_status,
  scheduled_start timestamptz,
  scheduled_end timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select 'dispatcher', r.id, r.request_number, r.company_name, null::uuid, null::public.visit_status, null::timestamptz, null::timestamptz
  from public.requests r
  where r.dispatcher_id = target_employee_id and not private.is_terminal(r)
  union all
  select 'technician', r.id, r.request_number, r.company_name, null, null, null, null
  from public.requests r
  where r.technician_id = target_employee_id and not private.is_terminal(r)
  union all
  select 'visit', r.id, r.request_number, r.company_name, v.id, v.status, v.scheduled_start, v.scheduled_end
  from public.visits v
  join public.requests r on r.id = v.request_id
  where v.technician_id = target_employee_id and v.status in ('scheduled', 'in_progress')
  order by 1, 3, 7;
$$;

-- Locks and returns the employee's profile
create function private.lock_employee(target_employee_id uuid)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked public.profiles;
begin
  select * into locked from public.profiles p where p.id = target_employee_id for update;
  if not found then
    raise exception 'Mitarbeiter nicht gefunden' using errcode = 'RW404';
  end if;
  return locked;
end;
$$;

create function public.admin_employee_assignments(employee_id uuid)
returns table (
  assignment text,
  request_id uuid,
  request_number text,
  company_name text,
  visit_id uuid,
  visit_status public.visit_status,
  scheduled_start timestamptz,
  scheduled_end timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role('admin');
  return query select * from private.employee_assignments(admin_employee_assignments.employee_id);
end;
$$;

-- Name and role. A role change needs an employee without active assignments; admins cannot change their own role,
-- so at least one active admin always remains.
create function public.admin_update_employee(employee_id uuid, display_name text, role public.employee_role)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid;
  emp public.profiles;
  result public.profiles;
begin
  caller := private.require_role('admin');
  emp := private.lock_employee(admin_update_employee.employee_id);

  if nullif(btrim(admin_update_employee.display_name), '') is null then
    raise exception 'Name ist erforderlich' using errcode = 'RW422';
  end if;

  if admin_update_employee.role is distinct from emp.role then
    if emp.id = caller then
      raise exception 'Die eigene Rolle kann nicht geändert werden' using errcode = 'RW422';
    end if;
    if exists (select 1 from private.employee_assignments(emp.id)) then
      raise exception 'Rolle erst ändern, wenn keine aktiven Zuweisungen mehr bestehen' using errcode = 'RW422';
    end if;
  end if;

  update public.profiles p
  set display_name = btrim(admin_update_employee.display_name), role = admin_update_employee.role
  where p.id = emp.id
  returning * into result;
  return result;
end;
$$;

-- Deactivates an employee. Active assignments are moved to replacement_id (active, same role); scheduled visits
-- must fit the replacement's working hours. Without assignments no replacement is needed.
create function public.admin_deactivate_employee(employee_id uuid, replacement_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid;
  emp public.profiles;
  item record;
  moved_requests integer := 0;
  moved_visits integer := 0;
  note text;
begin
  caller := private.require_role('admin');
  if admin_deactivate_employee.employee_id = caller then
    raise exception 'Das eigene Konto kann nicht deaktiviert werden' using errcode = 'RW422';
  end if;

  emp := private.lock_employee(admin_deactivate_employee.employee_id);
  if not emp.is_active then
    raise exception 'Mitarbeiter ist bereits deaktiviert' using errcode = 'RW422';
  end if;

  if exists (select 1 from private.employee_assignments(emp.id) a where a.visit_status = 'in_progress') then
    raise exception 'Ein laufender Einsatz muss zuerst abgeschlossen werden' using errcode = 'RW422';
  end if;

  if exists (select 1 from private.employee_assignments(emp.id)) then
    if admin_deactivate_employee.replacement_id is null then
      raise exception 'Aktive Zuweisungen vorhanden: bitte eine Vertretung für die Neuzuweisung wählen' using errcode = 'RW422';
    end if;
    if admin_deactivate_employee.replacement_id = emp.id or not exists (
      select 1 from public.profiles p
      where p.id = admin_deactivate_employee.replacement_id and p.is_active and p.role = emp.role
    ) then
      raise exception 'Neuzuweisung nur an aktive Mitarbeitende derselben Rolle' using errcode = 'RW422';
    end if;
  end if;

  note := 'Neuzuweisung wegen Deaktivierung von ' || emp.display_name;

  -- Requests in a fixed order (deadlock-free), each locked before the change
  for item in
    select distinct a.request_id, a.assignment from private.employee_assignments(emp.id) a
    where a.assignment in ('dispatcher', 'technician')
    order by a.request_id, a.assignment
  loop
    perform 1 from public.requests r where r.id = item.request_id for update;
    if item.assignment = 'dispatcher' then
      update public.requests r set dispatcher_id = admin_deactivate_employee.replacement_id where r.id = item.request_id;
      perform private.log_request_event(item.request_id, 'dispatcher_assigned', emp.id::text,
        admin_deactivate_employee.replacement_id::text, note, event_visibility => 'dispatch');
    else
      update public.requests r set technician_id = admin_deactivate_employee.replacement_id where r.id = item.request_id;
      perform private.log_request_event(item.request_id, 'technician_assigned', emp.id::text,
        admin_deactivate_employee.replacement_id::text, note);
    end if;
    moved_requests := moved_requests + 1;
  end loop;

  -- Scheduled visits: same interval, the replacement must be available
  if exists (select 1 from private.employee_assignments(emp.id) a where a.assignment = 'visit') then
    perform private.lock_technician(t)
    from unnest(array[emp.id, admin_deactivate_employee.replacement_id]) as t order by t;

    for item in
      select a.visit_id, a.request_id, a.scheduled_start, a.scheduled_end from private.employee_assignments(emp.id) a
      where a.assignment = 'visit'
      order by a.scheduled_start
    loop
      if private.availability_problem(admin_deactivate_employee.replacement_id, item.scheduled_start, item.scheduled_end) is not null then
        raise exception 'Einsatz am % (%): %', to_char(item.scheduled_start at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI'),
          (select r.request_number from public.requests r where r.id = item.request_id),
          private.availability_problem(admin_deactivate_employee.replacement_id, item.scheduled_start, item.scheduled_end)
          using errcode = 'RW422';
      end if;
      begin
        update public.visits v set technician_id = admin_deactivate_employee.replacement_id where v.id = item.visit_id;
      exception when exclusion_violation then
        raise exception 'Einsatz am % überschneidet sich mit einem Einsatz der Vertretung',
          to_char(item.scheduled_start at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
          using errcode = 'RW410';
      end;
      insert into public.request_events (request_id, visit_id, actor_type, actor_id, event_type, from_value, to_value, note, data)
      values (item.request_id, item.visit_id, 'user', caller, 'visit_reassigned', emp.id::text,
        admin_deactivate_employee.replacement_id::text, note,
        jsonb_build_object('old_technician_id', emp.id, 'new_technician_id', admin_deactivate_employee.replacement_id,
          'scheduled_start', item.scheduled_start, 'scheduled_end', item.scheduled_end));
      moved_visits := moved_visits + 1;
    end loop;
  end if;

  update public.profiles p set is_active = false where p.id = emp.id;
  return jsonb_build_object('reassigned_requests', moved_requests, 'reassigned_visits', moved_visits);
end;
$$;

create function public.admin_reactivate_employee(employee_id uuid)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  emp public.profiles;
  result public.profiles;
begin
  perform private.require_role('admin');
  emp := private.lock_employee(admin_reactivate_employee.employee_id);
  if emp.is_active then
    raise exception 'Mitarbeiter ist bereits aktiv' using errcode = 'RW422';
  end if;
  update public.profiles p set is_active = true where p.id = emp.id returning * into result;
  return result;
end;
$$;

-- Creates (rate_id null) or changes a service rate. Work entries copy price and tax rate, issued invoices keep
-- their items, so changes only affect later entries. Rates are deactivated, not deleted.
create function public.admin_save_service_rate(
  rate_id uuid,
  code text,
  service_kind public.service_kind,
  display_name text,
  billing_model public.billing_model,
  unit_price numeric,
  tax_rate numeric,
  is_active boolean
)
returns public.service_rates
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.service_rates;
begin
  perform private.require_role('admin');
  if nullif(btrim(admin_save_service_rate.code), '') is null or nullif(btrim(admin_save_service_rate.display_name), '') is null then
    raise exception 'Kürzel und Bezeichnung sind erforderlich' using errcode = 'RW422';
  end if;
  if admin_save_service_rate.unit_price is null or admin_save_service_rate.unit_price < 0 then
    raise exception 'Preis darf nicht negativ sein' using errcode = 'RW422';
  end if;
  if admin_save_service_rate.tax_rate is null or admin_save_service_rate.tax_rate not between 0 and 100 then
    raise exception 'Steuersatz muss zwischen 0 und 100 liegen' using errcode = 'RW422';
  end if;

  begin
    if admin_save_service_rate.rate_id is null then
      insert into public.service_rates (code, service_kind, display_name, billing_model, unit_price, tax_rate, is_active)
      values (btrim(admin_save_service_rate.code), admin_save_service_rate.service_kind, btrim(admin_save_service_rate.display_name),
        admin_save_service_rate.billing_model, round(admin_save_service_rate.unit_price, 2), round(admin_save_service_rate.tax_rate, 2),
        coalesce(admin_save_service_rate.is_active, true))
      returning * into result;
    else
      update public.service_rates s
      set code = btrim(admin_save_service_rate.code),
          service_kind = admin_save_service_rate.service_kind,
          display_name = btrim(admin_save_service_rate.display_name),
          billing_model = admin_save_service_rate.billing_model,
          unit_price = round(admin_save_service_rate.unit_price, 2),
          tax_rate = round(admin_save_service_rate.tax_rate, 2),
          is_active = coalesce(admin_save_service_rate.is_active, s.is_active)
      where s.id = admin_save_service_rate.rate_id
      returning * into result;
      if not found then
        raise exception 'Tarif nicht gefunden' using errcode = 'RW404';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'Kürzel % ist bereits vergeben', btrim(admin_save_service_rate.code) using errcode = 'RW422';
  end;
  return result;
end;
$$;

-- Replaces the weekly working hours of an employee: hours = [{weekday, local_start, local_end}], at most one
-- window per weekday. New rows are inserted before the old ones are removed, so the booking check
-- (employee_availability_check_bookings) always sees the final schedule.
create function public.admin_set_working_hours(employee_id uuid, hours jsonb)
returns setof public.employee_availability
language plpgsql
security definer
set search_path = ''
as $$
declare
  emp public.profiles;
  old_ids uuid[];
begin
  perform private.require_role('admin');
  emp := private.lock_employee(admin_set_working_hours.employee_id);
  if jsonb_typeof(admin_set_working_hours.hours) is distinct from 'array' then
    raise exception 'Arbeitszeiten müssen als Liste übergeben werden' using errcode = 'RW422';
  end if;
  if exists (
    select 1 from jsonb_array_elements(admin_set_working_hours.hours) h
    where (h ->> 'weekday') is null or (h ->> 'local_start') is null or (h ->> 'local_end') is null
       or (h ->> 'weekday')::smallint not between 1 and 7
       or (h ->> 'local_end')::time <= (h ->> 'local_start')::time
  ) then
    raise exception 'Jeder Arbeitstag braucht Beginn und ein späteres Ende' using errcode = 'RW422';
  end if;
  if (select count(*) <> count(distinct h ->> 'weekday') from jsonb_array_elements(admin_set_working_hours.hours) h) then
    raise exception 'Je Wochentag ist nur ein Zeitfenster möglich' using errcode = 'RW422';
  end if;

  select coalesce(array_agg(a.id), '{}') into old_ids
  from public.employee_availability a where a.employee_id = emp.id and a.kind = 'working_hours';

  insert into public.employee_availability (employee_id, kind, weekday, local_start, local_end)
  select emp.id, 'working_hours', (h ->> 'weekday')::smallint, (h ->> 'local_start')::time, (h ->> 'local_end')::time
  from jsonb_array_elements(admin_set_working_hours.hours) h
  order by 3;

  delete from public.employee_availability a where a.id = any (old_ids);

  return query
  select * from public.employee_availability a
  where a.employee_id = emp.id and a.kind = 'working_hours'
  order by a.weekday;
end;
$$;

create function public.admin_add_absence(employee_id uuid, starts_at timestamptz, ends_at timestamptz, label text default null)
returns public.employee_availability
language plpgsql
security definer
set search_path = ''
as $$
declare
  emp public.profiles;
  result public.employee_availability;
begin
  perform private.require_role('admin');
  emp := private.lock_employee(admin_add_absence.employee_id);
  if admin_add_absence.starts_at is null or admin_add_absence.ends_at is null or admin_add_absence.ends_at <= admin_add_absence.starts_at then
    raise exception 'Ende muss nach dem Beginn liegen' using errcode = 'RW422';
  end if;
  insert into public.employee_availability (employee_id, kind, starts_at, ends_at, label)
  values (emp.id, 'absence', admin_add_absence.starts_at, admin_add_absence.ends_at, nullif(btrim(admin_add_absence.label), ''))
  returning * into result;
  return result;
end;
$$;

create function public.admin_delete_absence(absence_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_role('admin');
  delete from public.employee_availability a where a.id = admin_delete_absence.absence_id and a.kind = 'absence';
  if not found then
    raise exception 'Abwesenheit nicht gefunden' using errcode = 'RW404';
  end if;
end;
$$;

-- Settings for later operations. Timezone and currency stay fixed (they shape existing data).
-- Once an admin saves the settings they belong to the admin: the demo seed no longer restores or overwrites them.
create function public.admin_update_settings(
  manual_intake_minutes numeric,
  default_tax_rate numeric,
  payment_terms_days integer,
  company_details jsonb
)
returns public.settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid;
  result public.settings;
begin
  caller := private.require_role('admin');
  if admin_update_settings.manual_intake_minutes is null or admin_update_settings.manual_intake_minutes <= 0 then
    raise exception 'Basiswert muss größer als 0 sein' using errcode = 'RW422';
  end if;
  if admin_update_settings.default_tax_rate is null or admin_update_settings.default_tax_rate not between 0 and 100 then
    raise exception 'Steuersatz muss zwischen 0 und 100 liegen' using errcode = 'RW422';
  end if;
  if admin_update_settings.payment_terms_days is null or admin_update_settings.payment_terms_days not between 0 and 365 then
    raise exception 'Zahlungsziel muss zwischen 0 und 365 Tagen liegen' using errcode = 'RW422';
  end if;
  if jsonb_typeof(admin_update_settings.company_details) is distinct from 'object' then
    raise exception 'Firmenangaben fehlen' using errcode = 'RW422';
  end if;

  update public.settings s
  set manual_intake_minutes = round(admin_update_settings.manual_intake_minutes, 2),
      default_tax_rate = round(admin_update_settings.default_tax_rate, 2),
      payment_terms_days = admin_update_settings.payment_terms_days,
      company_details = admin_update_settings.company_details,
      updated_by = caller
  where s.id = 1
  returning * into result;

  delete from private.demo_seed_records d where d.table_name = 'settings';
  return result;
end;
$$;

-- Privileges
revoke all on function
  private.employee_assignments(uuid),
  private.lock_employee(uuid)
from public, anon, authenticated;

revoke all on function
  public.admin_employee_assignments(uuid),
  public.admin_update_employee(uuid, text, public.employee_role),
  public.admin_deactivate_employee(uuid, uuid),
  public.admin_reactivate_employee(uuid),
  public.admin_save_service_rate(uuid, text, public.service_kind, text, public.billing_model, numeric, numeric, boolean),
  public.admin_set_working_hours(uuid, jsonb),
  public.admin_add_absence(uuid, timestamptz, timestamptz, text),
  public.admin_delete_absence(uuid),
  public.admin_update_settings(numeric, numeric, integer, jsonb)
from public, anon;

grant execute on function
  public.admin_employee_assignments(uuid),
  public.admin_update_employee(uuid, text, public.employee_role),
  public.admin_deactivate_employee(uuid, uuid),
  public.admin_reactivate_employee(uuid),
  public.admin_save_service_rate(uuid, text, public.service_kind, text, public.billing_model, numeric, numeric, boolean),
  public.admin_set_working_hours(uuid, jsonb),
  public.admin_add_absence(uuid, timestamptz, timestamptz, text),
  public.admin_delete_absence(uuid),
  public.admin_update_settings(numeric, numeric, integer, jsonb)
to authenticated;
