-- task-5-1: dispatcher work queues as a view.
-- security_invoker = true: the view runs with the caller's rights, so RLS on requests, messages,
-- request_events and visits applies unchanged (a dispatcher sees only currently assigned requests).
--
-- Queues (at most one per request):
--   reply_received     needs review/analysis and a customer reply arrived after the last switch to awaiting_customer
--   review             intake_status = needs_review (otherwise)
--   awaiting_customer  intake_status = awaiting_customer
--   planning           intake processed, request open and no reserving visit: work_status not_planned,
--                      or waiting_parts (follow-up visit). Automatically processed requests stay here until planned.
-- Sort keys: priority_rank (priority; before it is set, the customer's urgency), due_at (response deadline
-- while unanswered, service deadline for planning), waiting_since (oldest first).

create view public.dispatcher_queue
with (security_invoker = true) as
with base as (
  select
    r.*,
    (select max(e.occurred_at) from public.request_events e
      where e.request_id = r.id and e.event_type = 'intake_status_changed' and e.to_value = 'awaiting_customer') as awaiting_since,
    (select max(e.occurred_at) from public.request_events e
      where e.request_id = r.id and e.event_type = 'intake_status_changed' and e.to_value = r.intake_status::text) as status_since,
    (select max(e.occurred_at) from public.request_events e
      where e.request_id = r.id and e.event_type = 'work_status_changed' and e.to_value = r.work_status::text) as work_status_since,
    (select max(m.received_at) from public.messages m
      where m.request_id = r.id and m.direction = 'incoming' and m.status = 'received') as last_reply_at,
    exists (select 1 from public.visits v
      where v.request_id = r.id and v.status in ('scheduled', 'in_progress')) as has_reserving_visit
  from public.requests r
),
classified as (
  select
    b.*,
    case
      when b.intake_status in ('rejected', 'cancelled') or b.work_status in ('completed', 'cancelled') then null
      when b.intake_status in ('needs_review', 'analyzing') and b.last_reply_at is not null
        and b.awaiting_since is not null and b.last_reply_at > b.awaiting_since then 'reply_received'
      when b.intake_status = 'needs_review' then 'review'
      when b.intake_status = 'awaiting_customer' then 'awaiting_customer'
      when b.intake_status = 'processed' and not b.has_reserving_visit
        and b.work_status in ('not_planned', 'waiting_parts') then 'planning'
    end as queue
  from base b
)
select
  c.id,
  c.request_number,
  c.company_name,
  c.city,
  c.service_kind,
  c.equipment_kind,
  c.intake_status,
  c.work_status,
  c.intake_mode,
  c.priority,
  c.customer_urgency,
  c.safety_risk,
  c.human_review_required,
  c.dispatcher_id,
  c.technician_id,
  c.is_demo,
  c.created_at,
  c.version,
  c.queue,
  case coalesce(c.priority::text, c.customer_urgency::text)
    when 'critical' then 1 when 'production_stop' then 1
    when 'high' then 2 when 'erheblich' then 2
    when 'normal' then 3 when 'zeitnah' then 3
    else 4
  end as priority_rank,
  case
    when c.queue in ('review', 'reply_received', 'awaiting_customer') and c.first_substantive_response_at is null then c.response_due_at
    when c.queue = 'planning' then c.service_due_at
  end as due_at,
  case c.queue
    when 'reply_received' then c.last_reply_at
    when 'planning' then greatest(c.intake_completed_at, c.work_status_since)
    else coalesce(c.status_since, c.created_at)
  end as waiting_since,
  -- Automatically processed request with a safety risk: a human action is required before planning (schedule_visit)
  (c.intake_mode = 'automatic' and c.safety_risk <> 'none_known') as safety_check_required
from classified c;

comment on view public.dispatcher_queue is
  'Arbeitswarteschlangen der Erstbearbeitung und Planung (task-5-1); security_invoker, es gilt RLS der Basistabellen.';

revoke all on public.dispatcher_queue from public, anon, authenticated;
grant select on public.dispatcher_queue to authenticated;
