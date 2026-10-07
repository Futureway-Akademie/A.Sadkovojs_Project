-- Master data tables: profiles, settings, service_rates, employee_availability (spec 5.1, 5.11-5.13).
-- RLS is enabled without policies (deny by default); policies follow in task-1-5.

-- Shared trigger function for updated_at
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- profiles: one row per employee, created by trusted admin operations
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  display_name text not null check (btrim(display_name) <> ''),
  role public.employee_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_role_active_idx on public.profiles (role, is_active);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

comment on table public.profiles is 'Mitarbeitende; Rolle und Aktivstatus nur über vertrauenswürdige Operationen änderbar. Deaktivieren statt löschen.';

-- settings: singleton row with demo configuration
create table public.settings (
  id smallint primary key default 1 check (id = 1),
  timezone text not null default 'Europe/Berlin' check (btrim(timezone) <> ''),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  manual_intake_minutes numeric(8,2) not null default 5 check (manual_intake_minutes > 0),
  default_tax_rate numeric(5,2) not null default 19 check (default_tax_rate between 0 and 100),
  payment_terms_days integer not null default 14 check (payment_terms_days >= 0),
  company_details jsonb not null default '{}'::jsonb check (jsonb_typeof(company_details) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete restrict
);

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

alter table public.settings enable row level security;

comment on table public.settings is 'Einzeilige Demo-Konfiguration (id = 1). Keine Gmail-/n8n-Geheimnisse speichern.';

insert into public.settings (id) values (1);

-- service_rates: price templates for work entries
create table public.service_rates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (btrim(code) <> ''),
  service_kind public.service_kind not null,
  display_name text not null check (btrim(display_name) <> ''),
  billing_model public.billing_model not null,
  unit_price numeric(12,2) not null check (unit_price >= 0),
  tax_rate numeric(5,2) not null check (tax_rate between 0 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index service_rates_kind_active_idx on public.service_rates (service_kind, is_active);

create trigger service_rates_set_updated_at
  before update on public.service_rates
  for each row execute function public.set_updated_at();

alter table public.service_rates enable row level security;

comment on table public.service_rates is 'Demo-Tarife: Wartung pauschal, Reparatur nach Stunden. Preise und Steuersätze sind Annahmen.';

-- employee_availability: weekly working hours and absences
create table public.employee_availability (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete restrict,
  kind public.availability_kind not null,
  weekday smallint check (weekday between 1 and 7),
  local_start time,
  local_end time,
  valid_from date,
  valid_to date,
  starts_at timestamptz,
  ends_at timestamptz,
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Working hours: weekday and local time window required, no absence interval
  constraint employee_availability_working_hours_fields check (
    kind <> 'working_hours' or (
      weekday is not null
      and local_start is not null
      and local_end is not null
      and local_end > local_start
      and starts_at is null
      and ends_at is null
    )
  ),
  -- Absence: timestamp interval required, no weekly schedule fields
  constraint employee_availability_absence_fields check (
    kind <> 'absence' or (
      starts_at is not null
      and ends_at is not null
      and ends_at > starts_at
      and weekday is null
      and local_start is null
      and local_end is null
      and valid_from is null
      and valid_to is null
    )
  ),
  constraint employee_availability_valid_range check (
    valid_from is null or valid_to is null or valid_to >= valid_from
  )
);

create index employee_availability_employee_kind_idx on public.employee_availability (employee_id, kind);
create index employee_availability_absence_interval_idx on public.employee_availability (employee_id, starts_at, ends_at)
  where kind = 'absence';

create trigger employee_availability_set_updated_at
  before update on public.employee_availability
  for each row execute function public.set_updated_at();

alter table public.employee_availability enable row level security;

comment on table public.employee_availability is 'Arbeitszeiten (ISO-Wochentag 1 = Montag, Ortszeit gemäß settings.timezone) und Abwesenheiten.';
comment on column public.employee_availability.label is 'Abwesenheitsgrund oder Bezeichnung; für Dispatcher anderer Mitarbeitender nicht sichtbar.';
