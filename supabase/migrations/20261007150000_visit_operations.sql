-- Controlled operations for visit planning and visit status (spec 5.4, 5.12, 6, 8).
--
-- * expected_version always refers to requests.version of the visit's request.
-- * Operations on a technician's calendar take a per-technician advisory lock; availability changes take the same
--   lock (trigger below). Overlaps are additionally guaranteed by the exclusion constraint visits_no_overlap.
-- * A visit must lie within one local working day (settings.timezone) inside a working_hours row and must not
--   touch an absence.
--
-- Additional error code:
--   RW410  booking conflict: overlaps another active booking of the technician

create function private.lock_technician(target_technician_id uuid)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('technician:' || target_technician_id::text, 0));
$$;

-- Returns NULL if the interval is available, otherwise a German reason
create function private.availability_problem(target_technician_id uuid, range_start timestamptz, range_end timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tz text;
  visit_local_start timestamp;
  visit_local_end timestamp;
begin
  select coalesce(s.timezone, 'Europe/Berlin') into tz from public.settings s where s.id = 1;
  visit_local_start := range_start at time zone tz;
  visit_local_end := range_end at time zone tz;

  if visit_local_start::date <> visit_local_end::date and visit_local_end <> (visit_local_start::date + 1)::timestamp then
    return 'Einsatz muss innerhalb eines Arbeitstags liegen';
  end if;

  if not exists (
    select 1 from public.employee_availability a
    where a.employee_id = target_technician_id
      and a.kind = 'working_hours'
      and a.weekday = extract(isodow from visit_local_start)::smallint
      and (a.valid_from is null or a.valid_from <= visit_local_start::date)
      and (a.valid_to is null or a.valid_to >= visit_local_start::date)
      and a.local_start <= visit_local_start::time
      and (visit_local_end - visit_local_start::date::timestamp) <= a.local_end::interval
  ) then
    return 'Einsatz liegt außerhalb der Arbeitszeit';
  end if;

  if exists (
    select 1 from public.employee_availability a
    where a.employee_id = target_technician_id
      and a.kind = 'absence'
      and a.starts_at < range_end and a.ends_at > range_start
  ) then
    return 'Techniker ist in diesem Zeitraum abwesend';
  end if;

  return null;
end;
$$;

-- Books or moves a reserving interval; maps constraint violations to operation errors
create function private.require_available(target_technician_id uuid, range_start timestamptz, range_end timestamptz)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  problem text;
begin
  if range_end <= range_start then
    raise exception 'Ende muss nach dem Beginn liegen' using errcode = 'RW422';
  end if;
  problem := private.availability_problem(target_technician_id, range_start, range_end);
  if problem is not null then
    raise exception '%', problem using errcode = 'RW422';
  end if;
end;
$$;

create function private.require_active_technician(target_technician_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p where p.id = target_technician_id and p.role = 'technician' and p.is_active
  ) then
    raise exception 'Einsätze nur für aktive Techniker' using errcode = 'RW422';
  end if;
end;
$$;

-- Loads a visit with its request locked (access and version checked)
create function private.lock_visit(target_visit_id uuid, expected_version integer, out req public.requests, out vis public.visits)
language plpgsql
security definer
set search_path = ''
as $$
declare
  visit_request_id uuid;
begin
  select v.request_id into visit_request_id from public.visits v where v.id = target_visit_id;
  if visit_request_id is null then
    raise exception 'Einsatz nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;

  req := private.lock_request(visit_request_id, expected_version);
  select * into vis from public.visits v where v.id = target_visit_id for update;
end;
$$;

-- Technicians may only act on their own visits; managers/admins on all accessible ones
create function private.require_visit_actor(vis public.visits)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if private.current_employee_role() = 'technician' and vis.technician_id <> (select auth.uid()) then
    raise exception 'Nur der eingeplante Techniker kann diesen Einsatz bearbeiten' using errcode = '42501';
  end if;
end;
$$;

create function private.set_work_status(req public.requests, new_status public.work_status, note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if req.work_status is distinct from new_status then
    update public.requests r set work_status = new_status where r.id = req.id;
    perform private.log_request_event(req.id, 'work_status_changed', req.work_status::text, new_status::text, note);
  end if;
end;
$$;

-- Plan a visit for a processed request and assign the technician
create function public.schedule_visit(
  request_id uuid,
  expected_version integer,
  technician_id uuid,
  scheduled_start timestamptz,
  scheduled_end timestamptz
)
returns public.visits
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  result public.visits;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  req := private.lock_request(schedule_visit.request_id, schedule_visit.expected_version);

  if req.intake_status <> 'processed' or private.is_terminal(req) then
    raise exception 'Einsatzplanung nur für bearbeitete, nicht abgeschlossene Anfragen' using errcode = 'RW422';
  end if;

  if req.safety_risk <> 'none_known' and req.intake_mode = 'automatic' and not exists (
    select 1 from public.request_events e
    where e.request_id = req.id and e.actor_type = 'user' and e.event_type in ('automatic_result_corrected', 'analysis_corrected', 'intake_status_changed')
  ) then
    raise exception 'Gemeldete oder unklare Sicherheitsgefahr erfordert vor der Planung eine menschliche Prüfung' using errcode = 'RW422';
  end if;

  if schedule_visit.scheduled_start < now() then
    raise exception 'Einsätze können nicht in der Vergangenheit geplant werden' using errcode = 'RW422';
  end if;

  perform private.require_active_technician(schedule_visit.technician_id);
  perform private.lock_technician(schedule_visit.technician_id);
  perform private.require_available(schedule_visit.technician_id, schedule_visit.scheduled_start, schedule_visit.scheduled_end);

  begin
    insert into public.visits (request_id, technician_id, status, scheduled_start, scheduled_end, created_by)
    values (req.id, schedule_visit.technician_id, 'scheduled', schedule_visit.scheduled_start, schedule_visit.scheduled_end, (select auth.uid()))
    returning * into result;
  exception when exclusion_violation then
    raise exception 'Der Techniker hat in diesem Zeitraum bereits einen Einsatz' using errcode = 'RW410';
  end;

  if req.technician_id is distinct from schedule_visit.technician_id then
    update public.requests r set technician_id = schedule_visit.technician_id where r.id = req.id;
    perform private.log_request_event(req.id, 'technician_assigned', req.technician_id::text, schedule_visit.technician_id::text);
  end if;

  insert into public.request_events (request_id, visit_id, actor_type, actor_id, event_type, to_value, data)
  values (req.id, result.id, 'user', (select auth.uid()), 'visit_scheduled',
    tstzrange(result.scheduled_start, result.scheduled_end, '[)')::text,
    jsonb_build_object('technician_id', result.technician_id, 'scheduled_start', result.scheduled_start, 'scheduled_end', result.scheduled_end));

  if req.work_status in ('not_planned', 'waiting_parts') then
    perform private.set_work_status(req, 'scheduled');
  end if;

  return result;
end;
$$;

-- Move a scheduled visit (optionally to another technician); old interval stays in the audit trail
create function public.reschedule_visit(
  visit_id uuid,
  expected_version integer,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  reason text,
  technician_id uuid default null
)
returns public.visits
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked record;
  result public.visits;
  clean_reason text := private.require_reason(reschedule_visit.reason);
  target_technician uuid;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  locked := private.lock_visit(reschedule_visit.visit_id, reschedule_visit.expected_version);

  if (locked.vis).status <> 'scheduled' or private.is_terminal(locked.req) then
    raise exception 'Nur geplante Einsätze offener Anfragen können umgeplant werden' using errcode = 'RW422';
  end if;

  if reschedule_visit.scheduled_start < now() then
    raise exception 'Einsätze können nicht in die Vergangenheit verschoben werden' using errcode = 'RW422';
  end if;

  target_technician := coalesce(reschedule_visit.technician_id, (locked.vis).technician_id);
  perform private.require_active_technician(target_technician);

  -- Lock both calendars in a stable order to avoid deadlocks
  perform private.lock_technician(t) from unnest(array[(locked.vis).technician_id, target_technician]) as t group by t order by t;
  perform private.require_available(target_technician, reschedule_visit.scheduled_start, reschedule_visit.scheduled_end);

  begin
    update public.visits v
    set technician_id = target_technician,
        scheduled_start = reschedule_visit.scheduled_start,
        scheduled_end = reschedule_visit.scheduled_end
    where v.id = (locked.vis).id
    returning * into result;
  exception when exclusion_violation then
    raise exception 'Der Techniker hat in diesem Zeitraum bereits einen Einsatz' using errcode = 'RW410';
  end;

  if (locked.req).technician_id is distinct from target_technician then
    update public.requests r set technician_id = target_technician where r.id = (locked.req).id;
    perform private.log_request_event((locked.req).id, 'technician_assigned', (locked.req).technician_id::text, target_technician::text);
  else
    -- Version still changes: the plan of the request changed
    update public.requests r set updated_at = now() where r.id = (locked.req).id;
  end if;

  insert into public.request_events (request_id, visit_id, actor_type, actor_id, event_type, from_value, to_value, note, data)
  values ((locked.req).id, result.id, 'user', (select auth.uid()), 'visit_rescheduled',
    tstzrange((locked.vis).scheduled_start, (locked.vis).scheduled_end, '[)')::text,
    tstzrange(result.scheduled_start, result.scheduled_end, '[)')::text,
    clean_reason,
    jsonb_build_object(
      'old_technician_id', (locked.vis).technician_id, 'new_technician_id', result.technician_id,
      'old_start', (locked.vis).scheduled_start, 'old_end', (locked.vis).scheduled_end,
      'new_start', result.scheduled_start, 'new_end', result.scheduled_end));

  return result;
end;
$$;

-- Technician starts work on site
create function public.start_visit(visit_id uuid, expected_version integer)
returns public.visits
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked record;
  result public.visits;
begin
  perform private.require_role('technician', 'manager', 'admin');
  locked := private.lock_visit(start_visit.visit_id, start_visit.expected_version);
  perform private.require_visit_actor(locked.vis);

  if (locked.vis).status <> 'scheduled' or private.is_terminal(locked.req) then
    raise exception 'Nur geplante Einsätze offener Anfragen können begonnen werden' using errcode = 'RW422';
  end if;

  update public.visits v set status = 'in_progress', actual_start = now()
  where v.id = (locked.vis).id returning * into result;

  insert into public.request_events (request_id, visit_id, actor_type, actor_id, event_type, from_value, to_value)
  values ((locked.req).id, result.id, 'user', (select auth.uid()), 'visit_status_changed', 'scheduled', 'in_progress');

  perform private.set_work_status(locked.req, 'in_progress');
  return result;
end;
$$;

-- Parts missing: the visit stops reserving the calendar
create function public.wait_for_parts(visit_id uuid, expected_version integer, reason text)
returns public.visits
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked record;
  result public.visits;
  clean_reason text := private.require_reason(wait_for_parts.reason);
begin
  perform private.require_role('technician', 'manager', 'admin');
  locked := private.lock_visit(wait_for_parts.visit_id, wait_for_parts.expected_version);
  perform private.require_visit_actor(locked.vis);

  if (locked.vis).status <> 'in_progress' or private.is_terminal(locked.req) then
    raise exception 'Warten auf Teile nur aus laufendem Einsatz' using errcode = 'RW422';
  end if;

  update public.visits v set status = 'waiting_parts', waiting_reason = clean_reason
  where v.id = (locked.vis).id returning * into result;

  insert into public.request_events (request_id, visit_id, actor_type, actor_id, event_type, from_value, to_value, note)
  values ((locked.req).id, result.id, 'user', (select auth.uid()), 'visit_status_changed', 'in_progress', 'waiting_parts', clean_reason);

  perform private.set_work_status(locked.req, 'waiting_parts', clean_reason);
  return result;
end;
$$;

-- Parts arrived and the existing visit continues
create function public.resume_visit(visit_id uuid, expected_version integer)
returns public.visits
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked record;
  result public.visits;
begin
  perform private.require_role('technician', 'manager', 'admin');
  locked := private.lock_visit(resume_visit.visit_id, resume_visit.expected_version);
  perform private.require_visit_actor(locked.vis);

  if (locked.vis).status <> 'waiting_parts' or private.is_terminal(locked.req) then
    raise exception 'Fortsetzen nur aus Warten auf Teile' using errcode = 'RW422';
  end if;

  perform private.lock_technician((locked.vis).technician_id);
  begin
    update public.visits v set status = 'in_progress'
    where v.id = (locked.vis).id returning * into result;
  exception when exclusion_violation then
    raise exception 'Das ursprüngliche Zeitfenster ist inzwischen belegt; bitte einen neuen Einsatz planen' using errcode = 'RW410';
  end;

  insert into public.request_events (request_id, visit_id, actor_type, actor_id, event_type, from_value, to_value)
  values ((locked.req).id, result.id, 'user', (select auth.uid()), 'visit_status_changed', 'waiting_parts', 'in_progress');

  perform private.set_work_status(locked.req, 'in_progress');
  return result;
end;
$$;

-- Finish this visit only; closing the request is a separate operation
create function public.complete_visit(visit_id uuid, expected_version integer, actual_work_minutes integer, summary text default null)
returns public.visits
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked record;
  result public.visits;
begin
  perform private.require_role('technician', 'manager', 'admin');
  locked := private.lock_visit(complete_visit.visit_id, complete_visit.expected_version);
  perform private.require_visit_actor(locked.vis);

  if (locked.vis).status not in ('in_progress', 'waiting_parts') or private.is_terminal(locked.req) then
    raise exception 'Nur laufende oder wartende Einsätze können abgeschlossen werden' using errcode = 'RW422';
  end if;

  if complete_visit.actual_work_minutes is null or complete_visit.actual_work_minutes < 0 then
    raise exception 'Tatsächliche Arbeitszeit in Minuten ist erforderlich' using errcode = 'RW422';
  end if;

  update public.visits v
  set status = 'completed',
      actual_end = greatest(now(), v.actual_start),
      actual_work_minutes = complete_visit.actual_work_minutes,
      summary = nullif(btrim(complete_visit.summary), '')
  where v.id = (locked.vis).id returning * into result;

  insert into public.request_events (request_id, visit_id, actor_type, actor_id, event_type, from_value, to_value, note, data)
  values ((locked.req).id, result.id, 'user', (select auth.uid()), 'visit_status_changed', (locked.vis).status::text, 'completed',
    result.summary, jsonb_build_object('actual_work_minutes', result.actual_work_minutes));

  -- Request version changes so that stale clients notice the new visit state
  update public.requests r set updated_at = now() where r.id = (locked.req).id;
  return result;
end;
$$;

-- Cancel a scheduled or waiting visit (dispatcher/manager/admin)
create function public.cancel_visit(visit_id uuid, expected_version integer, reason text)
returns public.visits
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked record;
  result public.visits;
  clean_reason text := private.require_reason(cancel_visit.reason);
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  locked := private.lock_visit(cancel_visit.visit_id, cancel_visit.expected_version);

  if (locked.vis).status not in ('scheduled', 'waiting_parts') then
    raise exception 'Nur geplante oder wartende Einsätze können storniert werden' using errcode = 'RW422';
  end if;

  update public.visits v set status = 'cancelled', cancellation_reason = clean_reason
  where v.id = (locked.vis).id returning * into result;

  insert into public.request_events (request_id, visit_id, actor_type, actor_id, event_type, from_value, to_value, note, data)
  values ((locked.req).id, result.id, 'user', (select auth.uid()), 'visit_status_changed', (locked.vis).status::text, 'cancelled', clean_reason,
    jsonb_build_object('scheduled_start', result.scheduled_start, 'scheduled_end', result.scheduled_end));

  -- Without remaining active visits a scheduled request is back to planning
  if (locked.req).work_status = 'scheduled' and not exists (
    select 1 from public.visits v where v.request_id = (locked.req).id and v.status in ('scheduled', 'in_progress', 'waiting_parts')
  ) then
    perform private.set_work_status(locked.req, 'not_planned', clean_reason);
  else
    update public.requests r set updated_at = now() where r.id = (locked.req).id;
  end if;

  return result;
end;
$$;

-- Availability changes are serialized with bookings and must not invalidate future active bookings
create function private.check_availability_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected uuid;
  broken record;
begin
  for affected in
    select distinct e from unnest(array[
      case when tg_op in ('INSERT', 'UPDATE') then new.employee_id end,
      case when tg_op in ('UPDATE', 'DELETE') then old.employee_id end
    ]) as e where e is not null order by 1
  loop
    perform private.lock_technician(affected);

    select v.id, v.scheduled_start, private.availability_problem(affected, v.scheduled_start, v.scheduled_end) as problem
    into broken
    from public.visits v
    where v.technician_id = affected
      and v.status in ('scheduled', 'in_progress')
      and v.scheduled_end > now()
      and private.availability_problem(affected, v.scheduled_start, v.scheduled_end) is not null
    order by v.scheduled_start
    limit 1;

    if found then
      raise exception 'Änderung kollidiert mit dem aktiven Einsatz am % (%). Einsatz zuerst umplanen oder stornieren.',
        broken.scheduled_start, broken.problem
        using errcode = 'RW422';
    end if;
  end loop;
  return null;
end;
$$;

create trigger employee_availability_check_bookings
  after insert or update or delete on public.employee_availability
  for each row execute function private.check_availability_change();

-- Privileges
revoke all on function
  private.lock_technician(uuid),
  private.availability_problem(uuid, timestamptz, timestamptz),
  private.require_available(uuid, timestamptz, timestamptz),
  private.require_active_technician(uuid),
  private.lock_visit(uuid, integer),
  private.require_visit_actor(public.visits),
  private.set_work_status(public.requests, public.work_status, text),
  private.check_availability_change()
from public, anon, authenticated;

revoke all on function
  public.schedule_visit(uuid, integer, uuid, timestamptz, timestamptz),
  public.reschedule_visit(uuid, integer, timestamptz, timestamptz, text, uuid),
  public.start_visit(uuid, integer),
  public.wait_for_parts(uuid, integer, text),
  public.resume_visit(uuid, integer),
  public.complete_visit(uuid, integer, integer, text),
  public.cancel_visit(uuid, integer, text)
from public, anon;

grant execute on function
  public.schedule_visit(uuid, integer, uuid, timestamptz, timestamptz),
  public.reschedule_visit(uuid, integer, timestamptz, timestamptz, text, uuid),
  public.start_visit(uuid, integer),
  public.wait_for_parts(uuid, integer, text),
  public.resume_visit(uuid, integer),
  public.complete_visit(uuid, integer, integer, text),
  public.cancel_visit(uuid, integer, text)
to authenticated;
