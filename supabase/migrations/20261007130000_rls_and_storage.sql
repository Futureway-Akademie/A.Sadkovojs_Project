-- Row Level Security, access helpers and private storage (spec section 3, 5.8).
--
-- Model:
-- * RLS grants read access only. Writes by ordinary users go through controlled operations
--   (security definer functions, phase 2); table write privileges are revoked from client roles.
-- * Every helper requires an active profile; deactivated employees see nothing.
-- * Visibility levels: operational = everyone with request access, dispatch = dispatcher/manager/admin,
--   management = manager/admin.

-- Helpers live in a schema that is not exposed through the Data API.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- Role of the calling user, NULL if not signed in or deactivated
create function private.current_employee_role()
returns public.employee_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = (select auth.uid()) and p.is_active;
$$;

create function private.is_active_employee()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.current_employee_role() is not null;
$$;

create function private.is_manager_or_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(private.current_employee_role() in ('manager', 'admin'), false);
$$;

create function private.visibility_allowed(level public.visibility_level)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case level
    when 'operational' then private.is_active_employee()
    when 'dispatch' then coalesce(private.current_employee_role() in ('dispatcher', 'manager', 'admin'), false)
    when 'management' then private.is_manager_or_admin()
    else false
  end;
$$;

-- Read access to a request:
-- manager/admin: all; dispatcher: currently assigned; technician: currently assigned or own visit (history).
create function private.can_access_request(target_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case private.current_employee_role()
    when 'admin' then true
    when 'manager' then true
    when 'dispatcher' then exists (
      select 1 from public.requests r where r.id = target_request_id and r.dispatcher_id = (select auth.uid())
    )
    when 'technician' then exists (
      select 1 from public.requests r where r.id = target_request_id and r.technician_id = (select auth.uid())
    ) or exists (
      select 1 from public.visits v where v.request_id = target_request_id and v.technician_id = (select auth.uid())
    )
    else false
  end;
$$;

-- Currently assigned technician (operational control, not history)
create function private.is_current_technician(target_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_employee_role() = 'technician' and exists (
    select 1 from public.requests r where r.id = target_request_id and r.technician_id = (select auth.uid())
  );
$$;

-- Messages: dispatcher correspondence, never visible to technicians
create function private.can_read_message(target_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.messages m
    where m.id = target_message_id
      and (
        private.is_manager_or_admin()
        or (
          private.current_employee_role() = 'dispatcher'
          and (
            (m.request_id is not null and private.can_access_request(m.request_id))
            or (m.request_id is null and m.inbox_dispatcher_id = (select auth.uid()))
          )
        )
      )
  );
$$;

-- Attachments: parent access plus visibility; message attachments follow message access
create function private.can_read_attachment(target_attachment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.attachments a
    where a.id = target_attachment_id
      and private.visibility_allowed(a.visibility)
      and (a.message_id is null or private.can_read_message(a.message_id))
      and (a.request_id is null or private.can_access_request(a.request_id))
      and (
        private.current_employee_role() <> 'technician'
        or a.visit_id is null
        or private.is_current_technician(a.request_id)
        or exists (select 1 from public.visits v where v.id = a.visit_id and v.technician_id = (select auth.uid()))
      )
  );
$$;

create function private.can_read_storage_object(object_bucket text, object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.attachments a
    where a.bucket = object_bucket and a.storage_path = object_name and private.can_read_attachment(a.id)
  );
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- Client roles may only read; anon gets nothing
revoke all on
  public.profiles, public.settings, public.service_rates, public.employee_availability,
  public.requests, public.request_events, public.request_number_counters,
  public.messages, public.automation_runs, public.attachments,
  public.visits, public.work_entries, public.invoices, public.invoice_items
from anon, authenticated;

grant select on
  public.profiles, public.settings, public.service_rates, public.employee_availability,
  public.requests, public.request_events,
  public.messages, public.automation_runs, public.attachments,
  public.visits, public.work_entries, public.invoices, public.invoice_items
to authenticated;

-- Role and activity can only change through trusted operations (definer functions, service role)
create function public.guard_profile_privileges()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and current_user in ('authenticated', 'anon') then
    raise exception 'Rolle und Aktivstatus sind nur über Administrationsoperationen änderbar'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_privileges
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- Policies (SELECT only)

-- Minimal employee data for every active employee
create policy profiles_select on public.profiles
  for select to authenticated
  using (private.is_active_employee());

create policy settings_select on public.settings
  for select to authenticated
  using (private.is_active_employee());

create policy service_rates_select on public.service_rates
  for select to authenticated
  using (private.is_active_employee());

-- Own entries; managers/admins all; dispatchers technicians' working hours (absences only as busy intervals)
create policy employee_availability_select on public.employee_availability
  for select to authenticated
  using (
    (employee_id = (select auth.uid()) and private.is_active_employee())
    or private.is_manager_or_admin()
    or (private.current_employee_role() = 'dispatcher' and kind = 'working_hours')
  );

create policy requests_select on public.requests
  for select to authenticated
  using (private.can_access_request(id));

create policy request_events_select on public.request_events
  for select to authenticated
  using (private.can_access_request(request_id) and private.visibility_allowed(visibility));

create policy messages_select on public.messages
  for select to authenticated
  using (private.can_read_message(id));

-- Automation results / AI analysis: not for technicians
create policy automation_runs_select on public.automation_runs
  for select to authenticated
  using (
    private.is_manager_or_admin()
    or (
      private.current_employee_role() = 'dispatcher'
      and (
        (request_id is not null and private.can_access_request(request_id))
        or (request_id is null and message_id is not null and private.can_read_message(message_id))
      )
    )
  );

create policy attachments_select on public.attachments
  for select to authenticated
  using (private.can_read_attachment(id));

-- Technicians: own visits (incl. history) and all visits of their current request
create policy visits_select on public.visits
  for select to authenticated
  using (
    private.can_access_request(request_id)
    and (
      private.current_employee_role() <> 'technician'
      or technician_id = (select auth.uid())
      or private.is_current_technician(request_id)
    )
  );

create policy work_entries_select on public.work_entries
  for select to authenticated
  using (
    private.can_access_request(request_id)
    and (
      private.current_employee_role() <> 'technician'
      or author_id = (select auth.uid())
      or private.is_current_technician(request_id)
      or exists (select 1 from public.visits v where v.id = visit_id and v.technician_id = (select auth.uid()))
    )
  );

create policy invoices_select on public.invoices
  for select to authenticated
  using (private.can_access_request(request_id));

create policy invoice_items_select on public.invoice_items
  for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and private.can_access_request(i.request_id)));

-- Occupied intervals of active technicians for scheduling.
-- Returns no request, customer or absence details; not available to technicians.
create function public.technician_busy_intervals(range_start timestamptz, range_end timestamptz)
returns table (technician_id uuid, starts_at timestamptz, ends_at timestamptz, busy_kind text)
language sql
stable
security definer
set search_path = ''
as $$
  select v.technician_id, v.scheduled_start, v.scheduled_end, 'visit'
  from public.visits v
  join public.profiles p on p.id = v.technician_id and p.is_active and p.role = 'technician'
  where private.current_employee_role() in ('dispatcher', 'manager', 'admin')
    and v.status in ('scheduled', 'in_progress')
    and v.scheduled_start < range_end and v.scheduled_end > range_start
  union all
  select a.employee_id, a.starts_at, a.ends_at, 'absence'
  from public.employee_availability a
  join public.profiles p on p.id = a.employee_id and p.is_active and p.role = 'technician'
  where private.current_employee_role() in ('dispatcher', 'manager', 'admin')
    and a.kind = 'absence'
    and a.starts_at < range_end and a.ends_at > range_start
  order by 1, 2;
$$;

revoke all on function public.technician_busy_intervals(timestamptz, timestamptz) from public, anon;
grant execute on function public.technician_busy_intervals(timestamptz, timestamptz) to authenticated;

-- Private storage bucket for dashboard files (technician photos, invoice PDFs, linked documents)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dashboard', 'dashboard', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png']);

-- Download only with access to the attachment row; uploads go through trusted server operations
create policy dashboard_objects_select on storage.objects
  for select to authenticated
  using (bucket_id = 'dashboard' and private.can_read_storage_object(bucket_id, name));
