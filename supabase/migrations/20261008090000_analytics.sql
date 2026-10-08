-- task-7-1: analytics in the database.
-- All functions run with the caller's rights (security invoker), so RLS on requests, request_events,
-- visits, invoices and automation_runs applies unchanged; data functions are reserved for managers and
-- admins (private.analytics_require_access). Periods follow settings.timezone (Europe/Berlin).
--
-- Measures are either events (counted in the period by their own timestamp: created_at,
-- intake_completed_at, completed_at, issued_at, paid_at, started_at) or snapshots (state at the end of
-- the period, reconstructed from request_events).

-- RLS performance for whole-table reads (analytics): managers and admins may read every request, event,
-- visit, invoice and automation run (can_access_request and visibility_allowed are true for them), so a
-- once-per-statement check (initplan) is added in front of the per-row checks. Semantics are unchanged.
alter policy requests_select on public.requests
  using ((select private.is_manager_or_admin()) or private.can_access_request(id));

alter policy request_events_select on public.request_events
  using ((select private.is_manager_or_admin()) or (private.can_access_request(request_id) and private.visibility_allowed(visibility)));

alter policy visits_select on public.visits
  using (
    (select private.is_manager_or_admin())
    or (
      private.can_access_request(request_id)
      and (
        private.current_employee_role() <> 'technician'
        or technician_id = (select auth.uid())
        or private.is_current_technician(request_id)
      )
    )
  );

alter policy invoices_select on public.invoices
  using ((select private.is_manager_or_admin()) or private.can_access_request(request_id));

alter policy automation_runs_select on public.automation_runs
  using (
    (select private.is_manager_or_admin())
    or (
      private.current_employee_role() = 'dispatcher'
      and (
        (request_id is not null and private.can_access_request(request_id))
        or (request_id is null and message_id is not null and private.can_read_message(message_id))
      )
    )
  );

-- Period window with comparison span.
-- Current period: [start, min(period end, as_of)). Previous period: same elapsed time from the start of
-- the preceding period, clamped to that period's end (1–31 March compares with 1–28 February).
create function public.analytics_window(kind text default 'month', anchor date default null, as_of timestamptz default now())
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
  previous_end := least(prev_start_local + (current_local - start_local), start_local) at time zone tz;
  is_complete := local_now >= end_local;
  time_zone := tz;
  return next;
end;
$$;

-- Data functions are reserved for managers and admins
create function private.analytics_require_access()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not private.is_manager_or_admin() then
    raise exception 'Keine Berechtigung für diese Aktion' using errcode = '42501';
  end if;
end;
$$;

-- Status history per request as half-open segments [valid_from, valid_to), reconstructed from
-- intake_status_changed / work_status_changed. Without events the current status applies from creation.
create function private.analytics_status_segments()
returns table (request_id uuid, valid_from timestamptz, valid_to timestamptz, intake_status public.intake_status, work_status public.work_status)
language sql
stable
security invoker
set search_path = ''
as $$
  with changes as (
    select r.id as request_id, r.created_at as at, 0::bigint as seq,
      coalesce((select e.from_value from public.request_events e
                where e.request_id = r.id and e.event_type = 'intake_status_changed' and e.from_value is not null
                order by e.occurred_at, e.seq limit 1), r.intake_status::text) as intake,
      coalesce((select e.from_value from public.request_events e
                where e.request_id = r.id and e.event_type = 'work_status_changed' and e.from_value is not null
                order by e.occurred_at, e.seq limit 1), r.work_status::text) as work
    from public.requests r
    union all
    select e.request_id, e.occurred_at, e.seq,
      case when e.event_type = 'intake_status_changed' then e.to_value end,
      case when e.event_type = 'work_status_changed' then e.to_value end
    from public.request_events e
    where e.event_type in ('intake_status_changed', 'work_status_changed') and e.to_value is not null
  ),
  grouped as (
    select c.*,
      count(c.intake) over (partition by c.request_id order by c.at, c.seq) as intake_group,
      count(c.work) over (partition by c.request_id order by c.at, c.seq) as work_group
    from changes c
  ),
  filled as (
    select g.request_id, g.at, g.seq,
      first_value(g.intake) over (partition by g.request_id, g.intake_group order by g.at, g.seq) as intake,
      first_value(g.work) over (partition by g.request_id, g.work_group order by g.at, g.seq) as work
    from grouped g
  )
  select f.request_id, f.at, lead(f.at) over (partition by f.request_id order by f.at, f.seq),
    f.intake::public.intake_status, f.work::public.work_status
  from filled f;
$$;

-- Queue of a status pair (matches public.dispatcher_queue without the reply/visit refinements):
-- analysis (new/analyzing), review, awaiting_customer, planning; null for closed requests or planned work.
create function private.analytics_queue(intake public.intake_status, work public.work_status)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when intake in ('rejected', 'cancelled') or work in ('completed', 'cancelled') then null
    when intake in ('new', 'analyzing') then 'analysis'
    when intake = 'needs_review' then 'review'
    when intake = 'awaiting_customer' then 'awaiting_customer'
    when intake = 'processed' and work in ('not_planned', 'waiting_parts') then 'planning'
  end;
$$;

-- Event measures in [from_ts, to_ts)
create function private.analytics_events(from_ts timestamptz, to_ts timestamptz)
returns table (
  received integer,
  intake_completed integer,
  automatic_completed integer,
  completed integer,
  lead_time_days numeric,
  service_due_total integer,
  service_due_met integer,
  response_due_total integer,
  response_due_met integer,
  invoiced_gross numeric,
  revenue_net numeric,
  invoices_issued integer,
  payments_received numeric,
  saved_requests integer,
  saved_minutes numeric,
  baseline_min numeric,
  baseline_max numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (select count(*)::int from public.requests r where r.created_at >= from_ts and r.created_at < to_ts),
    (select count(*)::int from public.requests r where r.intake_completed_at >= from_ts and r.intake_completed_at < to_ts),
    (select count(*)::int from public.requests r
      where r.intake_completed_at >= from_ts and r.intake_completed_at < to_ts and r.intake_mode = 'automatic'),
    (select count(*)::int from public.requests r where r.completed_at >= from_ts and r.completed_at < to_ts),
    (select round(avg(extract(epoch from r.completed_at - r.created_at) / 86400)::numeric, 1)
      from public.requests r where r.completed_at >= from_ts and r.completed_at < to_ts),
    (select count(*)::int from public.requests r
      where r.completed_at >= from_ts and r.completed_at < to_ts and r.service_due_at is not null),
    (select count(*)::int from public.requests r
      where r.completed_at >= from_ts and r.completed_at < to_ts and r.service_due_at is not null and r.completed_at <= r.service_due_at),
    (select count(*)::int from public.requests r where r.response_due_at >= from_ts and r.response_due_at < to_ts),
    (select count(*)::int from public.requests r
      where r.response_due_at >= from_ts and r.response_due_at < to_ts
        and coalesce(r.first_substantive_response_at, r.intake_completed_at) <= r.response_due_at),
    (select coalesce(sum(i.total), 0) from public.invoices i where i.issued_at >= from_ts and i.issued_at < to_ts),
    (select coalesce(sum(i.subtotal), 0) from public.invoices i where i.issued_at >= from_ts and i.issued_at < to_ts),
    (select count(*)::int from public.invoices i where i.issued_at >= from_ts and i.issued_at < to_ts),
    (select coalesce(sum(i.total), 0) from public.invoices i where i.paid_at >= from_ts and i.paid_at < to_ts),
    s.requests, s.minutes, s.baseline_min, s.baseline_max
  from (
    -- Time savings (formula of savings_fixture.test.sql): automatic first completion without recorded correction
    select count(*)::int as requests, coalesce(sum(r.manual_minutes_baseline), 0) as minutes,
      min(r.manual_minutes_baseline) as baseline_min, max(r.manual_minutes_baseline) as baseline_max
    from public.requests r
    where r.intake_completed_at >= from_ts and r.intake_completed_at < to_ts
      and r.intake_mode = 'automatic'
      and not exists (select 1 from public.request_events e where e.request_id = r.id and e.event_type = 'automatic_result_corrected')
      and not exists (select 1 from public.automation_runs a where a.request_id = r.id and a.corrected_at is not null)
  ) s;
$$;

-- Snapshot measures at an instant (state just before at_ts)
create function private.analytics_snapshot(at_ts timestamptz)
returns table (open_requests integer, analysis_queue integer, review_queue integer, awaiting_queue integer, planning_queue integer, open_receivables numeric, overdue_receivables numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  with state as (
    select s.intake_status, s.work_status, private.analytics_queue(s.intake_status, s.work_status) as queue
    from private.analytics_status_segments() s
    where s.valid_from < at_ts and (s.valid_to is null or s.valid_to >= at_ts)
  ),
  local_day as (
    select (at_ts at time zone coalesce((select st.timezone from public.settings st where st.id = 1), 'Europe/Berlin'))::date as today
  )
  select
    (select count(*)::int from state where not (intake_status in ('rejected', 'cancelled') or work_status in ('completed', 'cancelled'))),
    (select count(*)::int from state where queue = 'analysis'),
    (select count(*)::int from state where queue = 'review'),
    (select count(*)::int from state where queue = 'awaiting_customer'),
    (select count(*)::int from state where queue = 'planning'),
    (select coalesce(sum(i.total), 0) from public.invoices i where i.issued_at < at_ts and (i.paid_at is null or i.paid_at >= at_ts)),
    (select coalesce(sum(i.total), 0) from public.invoices i, local_day d
      where i.issued_at < at_ts and (i.paid_at is null or i.paid_at >= at_ts) and i.payment_due_date < d.today);
$$;

-- KPIs of a period with comparison. change_percent is null for percentage values (see difference in
-- points) and when the previous value is null or 0 (no percentage on a zero base).
create function public.analytics_kpis(kind text default 'month', anchor date default null, as_of timestamptz default now())
returns table (
  key text,
  label text,
  measure text,
  unit text,
  current_value numeric,
  previous_value numeric,
  difference numeric,
  change_percent numeric,
  detail jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  w record;
  cur record;
  prev record;
  snap_cur record;
  snap_prev record;
begin
  perform private.analytics_require_access();
  select * into w from public.analytics_window(analytics_kpis.kind, analytics_kpis.anchor, analytics_kpis.as_of);
  select * into cur from private.analytics_events(w.current_start, w.current_end);
  select * into prev from private.analytics_events(w.previous_start, w.previous_end);
  select * into snap_cur from private.analytics_snapshot(w.current_end);
  select * into snap_prev from private.analytics_snapshot(w.previous_end);

  return query
  with rows (sort, key, label, measure, unit, current_value, previous_value, detail) as (
    values
      (1, 'received', 'Eingegangene Anfragen', 'event', 'count', cur.received::numeric, prev.received::numeric, null::jsonb),
      (2, 'intake_completed', 'Erstbearbeitung abgeschlossen', 'event', 'count', cur.intake_completed::numeric, prev.intake_completed::numeric, null),
      (3, 'automatic_share', 'Anteil automatischer Erstbearbeitung', 'event', 'percent',
        round(100.0 * cur.automatic_completed / nullif(cur.intake_completed, 0), 1),
        round(100.0 * prev.automatic_completed / nullif(prev.intake_completed, 0), 1),
        jsonb_build_object('automatic', cur.automatic_completed, 'total', cur.intake_completed)),
      (4, 'completed', 'Abgeschlossene Anfragen', 'event', 'count', cur.completed::numeric, prev.completed::numeric, null),
      (5, 'lead_time_days', 'Durchlaufzeit bis Abschluss (Ø Tage)', 'event', 'days', cur.lead_time_days, prev.lead_time_days,
        jsonb_build_object('requests', cur.completed)),
      (6, 'response_on_time', 'Antwortfrist eingehalten', 'event', 'percent',
        round(100.0 * cur.response_due_met / nullif(cur.response_due_total, 0), 1),
        round(100.0 * prev.response_due_met / nullif(prev.response_due_total, 0), 1),
        jsonb_build_object('met', cur.response_due_met, 'total', cur.response_due_total)),
      (7, 'service_on_time', 'Servicefrist eingehalten', 'event', 'percent',
        round(100.0 * cur.service_due_met / nullif(cur.service_due_total, 0), 1),
        round(100.0 * prev.service_due_met / nullif(prev.service_due_total, 0), 1),
        jsonb_build_object('met', cur.service_due_met, 'total', cur.service_due_total)),
      (8, 'invoiced_gross', 'Ausgestellte Rechnungen (brutto)', 'event', 'eur', cur.invoiced_gross, prev.invoiced_gross,
        jsonb_build_object('invoices', cur.invoices_issued)),
      (9, 'revenue_net', 'Umsatz netto (ausgestellt)', 'event', 'eur', cur.revenue_net, prev.revenue_net,
        jsonb_build_object('invoices', cur.invoices_issued)),
      (10, 'payments_received', 'Zahlungseingang (brutto)', 'event', 'eur', cur.payments_received, prev.payments_received, null),
      (11, 'time_saved_minutes', 'Geschätzte Zeitersparnis', 'event', 'minutes', cur.saved_minutes, prev.saved_minutes,
        jsonb_build_object('requests', cur.saved_requests, 'baseline_min', cur.baseline_min, 'baseline_max', cur.baseline_max)),
      (12, 'open_requests', 'Offene Anfragen', 'snapshot', 'count', snap_cur.open_requests::numeric, snap_prev.open_requests::numeric, null),
      (13, 'review_queue', 'Warteschlange Prüfung', 'snapshot', 'count', snap_cur.review_queue::numeric, snap_prev.review_queue::numeric, null),
      (14, 'planning_queue', 'Warteschlange Einsatzplanung', 'snapshot', 'count', snap_cur.planning_queue::numeric, snap_prev.planning_queue::numeric, null),
      (15, 'open_receivables', 'Offene Forderungen (brutto)', 'snapshot', 'eur', snap_cur.open_receivables, snap_prev.open_receivables, null),
      (16, 'overdue_receivables', 'Überfällige Forderungen (brutto)', 'snapshot', 'eur', snap_cur.overdue_receivables, snap_prev.overdue_receivables, null)
  )
  select r.key, r.label, r.measure, r.unit, r.current_value, r.previous_value,
    r.current_value - r.previous_value,
    case when r.unit = 'percent' or r.previous_value is null or r.previous_value = 0 or r.current_value is null then null
      else round(100.0 * (r.current_value - r.previous_value) / abs(r.previous_value), 1) end,
    r.detail
  from rows r
  order by r.sort;
end;
$$;

-- Time series per bucket (day, week, month) between two local dates; each event counted by its own timestamp
create function public.analytics_series(granularity text, from_date date, to_date date)
returns table (
  bucket_start date,
  received integer,
  intake_completed integer,
  automatic_completed integer,
  completed integer,
  invoiced_gross numeric,
  payments_received numeric
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
  select bk.bucket_start, e.received, e.intake_completed, e.automatic_completed, e.completed, e.invoiced_gross, e.payments_received
  from buckets bk
  cross join lateral private.analytics_events(bk.from_ts, bk.to_ts) e
  order by bk.bucket_start;
end;
$$;

-- Queue sizes at the end of each local day, reconstructed from request_events
create function public.analytics_queue_history(from_date date, to_date date)
returns table (day date, queue text, requests integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  tz text := coalesce((select s.timezone from public.settings s where s.id = 1), 'Europe/Berlin');
begin
  perform private.analytics_require_access();
  if analytics_queue_history.to_date < analytics_queue_history.from_date or analytics_queue_history.to_date - analytics_queue_history.from_date > 1100 then
    raise exception 'Ungültiger Zeitraum' using errcode = 'RW422';
  end if;

  return query
  with days as (
    select d::date as day, (d + interval '1 day') at time zone tz as day_end
    from generate_series(analytics_queue_history.from_date::timestamp, analytics_queue_history.to_date::timestamp, interval '1 day') as d
  ),
  segments as (
    select s.valid_from, s.valid_to, private.analytics_queue(s.intake_status, s.work_status) as queue
    from private.analytics_status_segments() s
  ),
  queues (queue, sort) as (values ('analysis', 1), ('review', 2), ('awaiting_customer', 3), ('planning', 4))
  select d.day, q.queue, count(s.queue)::int
  from days d
  cross join queues q
  left join segments s on s.queue = q.queue and s.valid_from < d.day_end and (s.valid_to is null or s.valid_to >= d.day_end)
  group by d.day, q.queue, q.sort
  order by d.day, q.sort;
end;
$$;

-- Automation runs of the period by step, status and decision
create function public.analytics_automation(kind text default 'month', anchor date default null, as_of timestamptz default now())
returns table (step public.automation_step, status public.automation_status, decision public.automation_decision, runs integer, corrected integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  w record;
begin
  perform private.analytics_require_access();
  select * into w from public.analytics_window(analytics_automation.kind, analytics_automation.anchor, analytics_automation.as_of);
  return query
  select a.step, a.status, a.decision, count(*)::int, count(*) filter (where a.corrected_at is not null)::int
  from public.automation_runs a
  where a.started_at >= w.current_start and a.started_at < w.current_end
  group by a.step, a.status, a.decision
  order by a.step, a.status, a.decision;
end;
$$;

-- Team overview of the period: dispatchers (human intake completions) and technicians (visits, work
-- time, completed requests); open_requests is the snapshot of currently assigned open requests at period end
create function public.analytics_team(kind text default 'month', anchor date default null, as_of timestamptz default now())
returns table (
  employee_id uuid,
  display_name text,
  role public.employee_role,
  is_active boolean,
  intake_completed integer,
  visits_completed integer,
  work_minutes integer,
  requests_completed integer,
  open_requests integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  w record;
begin
  perform private.analytics_require_access();
  select * into w from public.analytics_window(analytics_team.kind, analytics_team.anchor, analytics_team.as_of);
  return query
  with open_at_end as (
    select s.request_id
    from private.analytics_status_segments() s
    where s.valid_from < w.current_end and (s.valid_to is null or s.valid_to >= w.current_end)
      and not (s.intake_status in ('rejected', 'cancelled') or s.work_status in ('completed', 'cancelled'))
  )
  select p.id, p.display_name, p.role, p.is_active,
    (select count(*)::int from public.requests r
      where r.dispatcher_id = p.id and r.intake_completed_at >= w.current_start and r.intake_completed_at < w.current_end
        and r.intake_mode is distinct from 'automatic'),
    (select count(*)::int from public.visits v
      where v.technician_id = p.id and v.status = 'completed' and v.actual_end >= w.current_start and v.actual_end < w.current_end),
    (select coalesce(sum(v.actual_work_minutes), 0)::int from public.visits v
      where v.technician_id = p.id and v.status = 'completed' and v.actual_end >= w.current_start and v.actual_end < w.current_end),
    (select count(*)::int from public.requests r
      where r.technician_id = p.id and r.completed_at >= w.current_start and r.completed_at < w.current_end),
    (select count(*)::int from public.requests r join open_at_end o on o.request_id = r.id
      where (p.role = 'dispatcher' and r.dispatcher_id = p.id) or (p.role = 'technician' and r.technician_id = p.id))
  from public.profiles p
  where p.role in ('dispatcher', 'technician')
  order by p.role, p.display_name;
end;
$$;

comment on function public.analytics_window(text, date, timestamptz) is 'Analytik (task-7-1): Zeitraum mit Vergleichszeitraum gleicher Länge, Europe/Berlin.';
comment on function public.analytics_kpis(text, date, timestamptz) is 'Analytik (task-7-1): KPIs mit Vergleich; Ereignis- und Momentaufnahme-Kennzahlen getrennt (measure).';
comment on function public.analytics_series(text, date, date) is 'Analytik (task-7-1): Zeitreihen, je Ereignis nach eigenem Zeitstempel.';
comment on function public.analytics_queue_history(date, date) is 'Analytik (task-7-1): Warteschlangen am Tagesende, rekonstruiert aus request_events.';
comment on function public.analytics_automation(text, date, timestamptz) is 'Analytik (task-7-1): Automatisierungsläufe je Schritt, Status und Entscheidung.';
comment on function public.analytics_team(text, date, timestamptz) is 'Analytik (task-7-1): Teamübersicht je Dispatcher und Techniker.';

revoke all on function
  public.analytics_window(text, date, timestamptz),
  public.analytics_kpis(text, date, timestamptz),
  public.analytics_series(text, date, date),
  public.analytics_queue_history(date, date),
  public.analytics_automation(text, date, timestamptz),
  public.analytics_team(text, date, timestamptz),
  private.analytics_require_access(),
  private.analytics_status_segments(),
  private.analytics_queue(public.intake_status, public.work_status),
  private.analytics_events(timestamptz, timestamptz),
  private.analytics_snapshot(timestamptz)
from public, anon;

grant execute on function
  public.analytics_window(text, date, timestamptz),
  public.analytics_kpis(text, date, timestamptz),
  public.analytics_series(text, date, date),
  public.analytics_queue_history(date, date),
  public.analytics_automation(text, date, timestamptz),
  public.analytics_team(text, date, timestamptz),
  private.analytics_require_access(),
  private.analytics_status_segments(),
  private.analytics_queue(public.intake_status, public.work_status),
  private.analytics_events(timestamptz, timestamptz),
  private.analytics_snapshot(timestamptz)
to authenticated;
