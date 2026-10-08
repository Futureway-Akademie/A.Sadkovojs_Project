-- task-7-3: time series additionally return the estimated time savings per bucket (eligible requests,
-- minutes and baseline), so charts can show "N requests × baseline" in the tooltip.
-- The return type changes, therefore drop and recreate.
drop function public.analytics_series(text, date, date);

-- Time series per bucket (day, week, month) between two local dates; each event counted by its own timestamp
create function public.analytics_series(granularity text, from_date date, to_date date)
returns table (
  bucket_start date,
  received integer,
  intake_completed integer,
  automatic_completed integer,
  completed integer,
  invoiced_gross numeric,
  payments_received numeric,
  saved_requests integer,
  saved_minutes numeric,
  baseline_minutes numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  tz text := coalesce((select s.timezone from public.settings s where s.id = 1), 'Europe/Berlin');
  step interval;
begin
  perform private.analytics_require_access();
  step := case analytics_series.granularity when 'day' then interval '1 day' when 'week' then interval '1 week' when 'month' then interval '1 month' end;
  if step is null then
    raise exception 'Unbekannte Granularität %', analytics_series.granularity using errcode = 'RW422';
  end if;
  if analytics_series.to_date < analytics_series.from_date or analytics_series.to_date - analytics_series.from_date > 1100 then
    raise exception 'Ungültiger Zeitraum' using errcode = 'RW422';
  end if;

  return query
  with buckets as (
    select b::date as bucket_start, b at time zone tz as from_ts, (b + step) at time zone tz as to_ts
    from generate_series(date_trunc(analytics_series.granularity, analytics_series.from_date::timestamp), analytics_series.to_date::timestamp, step) as b
  )
  select bk.bucket_start, e.received, e.intake_completed, e.automatic_completed, e.completed, e.invoiced_gross, e.payments_received,
    e.saved_requests, e.saved_minutes, e.baseline_max
  from buckets bk
  cross join lateral private.analytics_events(bk.from_ts, bk.to_ts) e
  order by bk.bucket_start;
end;
$$;

comment on function public.analytics_series(text, date, date) is 'Analytik (task-7-1, 7-3): Zeitreihen, je Ereignis nach eigenem Zeitstempel; inkl. Zeitersparnis je Abschnitt.';
revoke all on function public.analytics_series(text, date, date) from public, anon;
grant execute on function public.analytics_series(text, date, date) to authenticated;
