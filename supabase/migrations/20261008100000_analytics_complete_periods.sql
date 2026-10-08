-- task-7-2: complete periods compare with the complete previous period.
-- Incomplete periods keep the comparison over the same elapsed time (task-7-1), e.g. 1–8 October with
-- 1–8 September; a finished September (30 days) now compares with all 31 days of August instead of 1–30 August.
create or replace function public.analytics_window(kind text default 'month', anchor date default null, as_of timestamptz default now())
returns table (
  period_kind text,
  current_start timestamptz,
  current_end timestamptz,
  period_end timestamptz,
  previous_start timestamptz,
  previous_end timestamptz,
  is_complete boolean,
  time_zone text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  tz text := coalesce((select s.timezone from public.settings s where s.id = 1), 'Europe/Berlin');
  step interval;
  local_now timestamp;
  start_local timestamp;
  end_local timestamp;
  current_local timestamp;
  prev_start_local timestamp;
begin
  step := case analytics_window.kind
    when 'week' then interval '1 week'
    when 'month' then interval '1 month'
    when 'quarter' then interval '3 months'
    when 'year' then interval '1 year'
  end;
  if step is null then
    raise exception 'Unbekannter Zeitraum %', analytics_window.kind using errcode = 'RW422';
  end if;
  local_now := analytics_window.as_of at time zone tz;
  start_local := date_trunc(analytics_window.kind, coalesce(analytics_window.anchor, local_now::date)::timestamp);
  end_local := start_local + step;
  current_local := least(greatest(local_now, start_local), end_local);
  prev_start_local := start_local - step;

  period_kind := analytics_window.kind;
  current_start := start_local at time zone tz;
  current_end := current_local at time zone tz;
  period_end := end_local at time zone tz;
  previous_start := prev_start_local at time zone tz;
  -- A complete period compares with the complete previous period (September with all of August)
  previous_end := case when local_now >= end_local then start_local
    else least(prev_start_local + (current_local - start_local), start_local) end at time zone tz;
  is_complete := local_now >= end_local;
  time_zone := tz;
  return next;
end;
$$;
