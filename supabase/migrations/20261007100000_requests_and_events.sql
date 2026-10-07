-- Requests and append-only audit events (spec 5.2, 5.9).
-- RLS is enabled without policies (deny by default); policies follow in task-1-5.

-- Per-year counter for request numbers. Only reachable through assign_request_number().
create table public.request_number_counters (
  year integer primary key check (year between 2000 and 9999),
  last_value integer not null check (last_value > 0)
);

alter table public.request_number_counters enable row level security;
revoke all on public.request_number_counters from anon, authenticated;

comment on table public.request_number_counters is 'Zähler je Kalenderjahr für RIS-JJJJ-NNNNN; nur über assign_request_number() verwendet.';

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null unique,
  source_event_key text not null unique check (btrim(source_event_key) <> ''),
  source text not null check (source in ('website_form', 'demo_seed')),
  is_demo boolean not null default false,

  -- Contact (original contact person)
  company_name text not null check (btrim(company_name) <> ''),
  contact_name text not null check (btrim(contact_name) <> ''),
  business_email text not null check (btrim(business_email) <> ''),
  phone_number text not null check (btrim(phone_number) <> ''),
  customer_number text,
  site_label text,

  -- Service location
  street_house_number text not null check (btrim(street_house_number) <> ''),
  postal_code text not null check (btrim(postal_code) <> ''),
  city text not null check (btrim(city) <> ''),

  -- Equipment and service
  equipment_kind public.equipment_kind not null,
  manufacturer text,
  model_type text,
  machine_number text,
  service_kind public.service_kind not null,
  requested_visit_date date not null,
  description text not null check (btrim(description) <> ''),
  customer_urgency public.customer_urgency not null,
  priority public.request_priority,
  safety_risk public.safety_risk not null,

  -- SLA (claimed by customer, verified by a person)
  sla_contract_number text,
  emergency_sla_claimed boolean,
  sla_verified boolean not null default false,

  raw_payload jsonb not null check (jsonb_typeof(raw_payload) = 'object'),

  -- Current assignees; role and activity are validated in controlled operations
  dispatcher_id uuid references public.profiles (id) on delete restrict,
  technician_id uuid references public.profiles (id) on delete restrict,

  -- Status model (section 6)
  intake_status public.intake_status not null default 'new',
  work_status public.work_status not null default 'not_planned',
  intake_mode public.intake_mode,
  human_review_required boolean not null default false,

  -- Agreed commitments and milestones
  response_due_at timestamptz,
  service_due_at timestamptz,
  first_substantive_response_at timestamptz,
  intake_completed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,

  rejection_reason text,
  cancellation_reason text,
  completion_summary text,
  manual_minutes_baseline numeric(8,2) check (manual_minutes_baseline >= 0),

  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- First processing outcome is recorded as one snapshot
  constraint requests_intake_completion_snapshot check (
    (intake_completed_at is null and intake_mode is null and manual_minutes_baseline is null)
    or (intake_completed_at is not null and intake_mode is not null and manual_minutes_baseline is not null)
  ),
  constraint requests_rejected_has_reason check (
    intake_status <> 'rejected' or nullif(btrim(rejection_reason), '') is not null
  ),
  constraint requests_cancelled_has_reason check (
    intake_status <> 'cancelled' or (nullif(btrim(cancellation_reason), '') is not null and cancelled_at is not null)
  ),
  constraint requests_completed_has_summary check (
    work_status <> 'completed' or (nullif(btrim(completion_summary), '') is not null and completed_at is not null)
  ),
  -- Automation cannot reject on its own
  constraint requests_rejection_not_automatic check (
    intake_status <> 'rejected' or intake_mode is distinct from 'automatic'
  )
);

create index requests_dispatcher_idx on public.requests (dispatcher_id);
create index requests_technician_idx on public.requests (technician_id);
create index requests_intake_status_idx on public.requests (intake_status);
create index requests_work_status_idx on public.requests (work_status);
create index requests_created_at_idx on public.requests (created_at);
create index requests_intake_completed_at_idx on public.requests (intake_completed_at);
create index requests_completed_at_idx on public.requests (completed_at);

alter table public.requests enable row level security;

comment on table public.requests is 'Serviceanfragen. Kontakt = ursprüngliche Kontaktperson, Adresse = Einsatzort. raw_payload ist die unveränderliche Originaleinreichung.';
comment on column public.requests.emergency_sla_claimed is 'NULL = keine Angabe, ungleich false.';
comment on column public.requests.version is 'Optimistische Nebenläufigkeit; wird bei jeder Änderung erhöht.';

-- Assigns RIS-YYYY-NNNNN atomically; the year follows created_at in settings.timezone.
create function public.assign_request_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tz text;
  number_year integer;
  next_value integer;
begin
  select s.timezone into tz from public.settings s where s.id = 1;
  number_year := extract(year from (new.created_at at time zone coalesce(tz, 'Europe/Berlin')))::integer;

  insert into public.request_number_counters as c (year, last_value)
  values (number_year, 1)
  on conflict (year) do update set last_value = c.last_value + 1
  returning c.last_value into next_value;

  if next_value > 99999 then
    raise exception 'Anfragenummern für % erschöpft', number_year;
  end if;

  new.request_number := format('RIS-%s-%s', number_year, lpad(next_value::text, 5, '0'));
  return new;
end;
$$;

revoke execute on function public.assign_request_number() from public, anon, authenticated;

create trigger requests_assign_number
  before insert on public.requests
  for each row execute function public.assign_request_number();

-- Identity, origin and the original submission never change; version and updated_at are maintained here.
create function public.guard_request_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.request_number is distinct from old.request_number
     or new.source_event_key is distinct from old.source_event_key
     or new.source is distinct from old.source
     or new.is_demo is distinct from old.is_demo
     or new.raw_payload is distinct from old.raw_payload
     or new.created_at is distinct from old.created_at then
    raise exception 'request_number, source_event_key, source, is_demo, raw_payload und created_at sind unveränderlich'
      using errcode = 'check_violation';
  end if;

  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger requests_guard_update
  before update on public.requests
  for each row execute function public.guard_request_update();

-- Append-only audit trail
create table public.request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete restrict,
  visit_id uuid, -- FK to visits is added in task-1-4
  actor_type public.actor_type not null,
  actor_id uuid references public.profiles (id) on delete restrict,
  event_type text not null check (event_type ~ '^[a-z][a-z_]*$'),
  visibility public.visibility_level not null default 'operational',
  from_value text,
  to_value text,
  note text,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint request_events_user_has_actor check (actor_type <> 'user' or actor_id is not null)
);

create index request_events_request_time_idx on public.request_events (request_id, occurred_at);
create index request_events_type_idx on public.request_events (event_type);

alter table public.request_events enable row level security;
revoke update, delete, truncate on public.request_events from anon, authenticated;

comment on table public.request_events is 'Append-only Audit-Ereignisse. Ereigniscodes siehe docs/database.md.';

create function public.prevent_request_event_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'request_events ist append-only: % ist nicht erlaubt', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger request_events_append_only
  before update or delete on public.request_events
  for each row execute function public.prevent_request_event_change();

create trigger request_events_no_truncate
  before truncate on public.request_events
  for each statement execute function public.prevent_request_event_change();
