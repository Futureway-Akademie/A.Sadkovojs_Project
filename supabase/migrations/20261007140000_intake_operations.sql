-- Controlled operations for initial processing, dispatcher assignment and deadlines (spec sections 6-8).
--
-- Every operation:
-- * runs as security definer and rechecks active profile, role and request access,
-- * locks the request row and compares the expected version (optimistic concurrency),
-- * validates the state transition,
-- * writes the change and its audit event in the same transaction.
--
-- Error codes (SQLSTATE):
--   42501  no permission or request not accessible
--   RW409  version conflict: request changed in the meantime, reload and retry
--   RW422  operation not allowed in the current state or invalid input

-- Completion snapshot of the first processing outcome is write-once
create or replace function public.guard_request_update()
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

  if old.intake_completed_at is not null and (
       new.intake_completed_at is distinct from old.intake_completed_at
       or new.intake_mode is distinct from old.intake_mode
       or new.manual_minutes_baseline is distinct from old.manual_minutes_baseline) then
    raise exception 'Abschluss der Erstbearbeitung (intake_completed_at, intake_mode, manual_minutes_baseline) ist bereits festgeschrieben'
      using errcode = 'check_violation';
  end if;

  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

-- Caller must be an active employee with one of the given roles; returns the caller's id
create function private.require_role(variadic allowed public.employee_role[])
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  if private.current_employee_role() is null or not (private.current_employee_role() = any (allowed)) then
    raise exception 'Keine Berechtigung für diese Aktion' using errcode = '42501';
  end if;
  return (select auth.uid());
end;
$$;

-- Locks the request for a change after access and version checks
create function private.lock_request(target_request_id uuid, expected_version integer)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked public.requests;
begin
  select * into locked from public.requests r where r.id = target_request_id for update;

  if not found or not private.can_access_request(target_request_id) then
    raise exception 'Anfrage nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;

  if expected_version is null or locked.version <> expected_version then
    raise exception 'Die Anfrage wurde zwischenzeitlich geändert (Version % statt %). Bitte neu laden.',
      locked.version, expected_version
      using errcode = 'RW409';
  end if;

  return locked;
end;
$$;

create function private.log_request_event(
  target_request_id uuid,
  event_code text,
  old_value text default null,
  new_value text default null,
  event_note text default null,
  event_data jsonb default '{}'::jsonb,
  event_visibility public.visibility_level default 'operational'
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.request_events (request_id, actor_type, actor_id, event_type, visibility, from_value, to_value, note, data)
  values (target_request_id, 'user', (select auth.uid()), event_code, event_visibility, old_value, new_value, event_note, event_data);
$$;

create function private.require_reason(reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if nullif(btrim(reason), '') is null then
    raise exception 'Ein Grund ist erforderlich' using errcode = 'RW422';
  end if;
  return btrim(reason);
end;
$$;

create function private.is_terminal(req public.requests)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select req.intake_status in ('rejected', 'cancelled') or req.work_status in ('completed', 'cancelled');
$$;

-- Ends outstanding visits of a request that is rejected or cancelled; history stays preserved
create function private.cancel_open_visits(target_request_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  open_visit record;
begin
  for open_visit in
    select v.id, v.status from public.visits v
    where v.request_id = target_request_id and v.status in ('scheduled', 'in_progress', 'waiting_parts')
    for update
  loop
    update public.visits set status = 'cancelled', cancellation_reason = reason where id = open_visit.id;

    insert into public.request_events (request_id, visit_id, actor_type, actor_id, event_type, from_value, to_value, note)
    values (target_request_id, open_visit.id, 'user', (select auth.uid()), 'visit_status_changed', open_visit.status::text, 'cancelled', reason);
  end loop;
end;
$$;

-- Assign or reassign the responsible dispatcher (manager/admin)
create function public.assign_dispatcher(request_id uuid, expected_version integer, dispatcher_id uuid)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  result public.requests;
begin
  perform private.require_role('manager', 'admin');
  req := private.lock_request(assign_dispatcher.request_id, assign_dispatcher.expected_version);

  if private.is_terminal(req) then
    raise exception 'Abgeschlossene, abgelehnte oder stornierte Anfragen werden nicht neu zugewiesen' using errcode = 'RW422';
  end if;

  if not exists (
    select 1 from public.profiles p where p.id = assign_dispatcher.dispatcher_id and p.role = 'dispatcher' and p.is_active
  ) then
    raise exception 'Zuweisung nur an aktive Dispatcher' using errcode = 'RW422';
  end if;

  if req.dispatcher_id is not distinct from assign_dispatcher.dispatcher_id then
    raise exception 'Dispatcher ist bereits zugewiesen' using errcode = 'RW422';
  end if;

  update public.requests r set dispatcher_id = assign_dispatcher.dispatcher_id
  where r.id = req.id returning * into result;

  perform private.log_request_event(req.id, 'dispatcher_assigned', req.dispatcher_id::text, assign_dispatcher.dispatcher_id::text,
    event_visibility => 'dispatch');
  return result;
end;
$$;

-- Escalate to human review (from new or analyzing)
create function public.mark_needs_review(request_id uuid, expected_version integer, note text default null)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  result public.requests;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  req := private.lock_request(mark_needs_review.request_id, mark_needs_review.expected_version);

  if req.intake_status not in ('new', 'analyzing') or private.is_terminal(req) then
    raise exception 'Manuelle Prüfung ist aus Status % nicht möglich', req.intake_status using errcode = 'RW422';
  end if;

  update public.requests r set intake_status = 'needs_review', human_review_required = true
  where r.id = req.id returning * into result;

  perform private.log_request_event(req.id, 'intake_status_changed', req.intake_status::text, 'needs_review', mark_needs_review.note);
  return result;
end;
$$;

-- Wait for the customer's answer to a clarification
create function public.mark_awaiting_customer(request_id uuid, expected_version integer, note text default null)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  result public.requests;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  req := private.lock_request(mark_awaiting_customer.request_id, mark_awaiting_customer.expected_version);

  if req.intake_status not in ('new', 'analyzing', 'needs_review') or private.is_terminal(req) then
    raise exception 'Warten auf Kundenantwort ist aus Status % nicht möglich', req.intake_status using errcode = 'RW422';
  end if;

  update public.requests r set intake_status = 'awaiting_customer'
  where r.id = req.id returning * into result;

  perform private.log_request_event(req.id, 'intake_status_changed', req.intake_status::text, 'awaiting_customer', mark_awaiting_customer.note);
  return result;
end;
$$;

-- Customer replied: analyse again
create function public.resume_analysis(request_id uuid, expected_version integer, note text default null)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  result public.requests;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  req := private.lock_request(resume_analysis.request_id, resume_analysis.expected_version);

  if req.intake_status <> 'awaiting_customer' or private.is_terminal(req) then
    raise exception 'Erneute Analyse nur nach Warten auf Kundenantwort' using errcode = 'RW422';
  end if;

  update public.requests r set intake_status = 'analyzing'
  where r.id = req.id returning * into result;

  perform private.log_request_event(req.id, 'intake_status_changed', 'awaiting_customer', 'analyzing', resume_analysis.note);
  return result;
end;
$$;

-- Human correction of the (automatic) analysis
create function public.correct_analysis(
  request_id uuid,
  expected_version integer,
  reason text,
  service_kind public.service_kind default null,
  priority public.request_priority default null,
  automation_run_id uuid default null
)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  result public.requests;
  clean_reason text := private.require_reason(correct_analysis.reason);
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  req := private.lock_request(correct_analysis.request_id, correct_analysis.expected_version);

  if private.is_terminal(req) then
    raise exception 'Abgeschlossene Anfragen werden nicht mehr korrigiert' using errcode = 'RW422';
  end if;

  if correct_analysis.service_kind is null and correct_analysis.priority is null then
    raise exception 'Keine Korrektur angegeben' using errcode = 'RW422';
  end if;

  if correct_analysis.automation_run_id is not null then
    update public.automation_runs a
    set corrected_by = (select auth.uid()), corrected_at = now(), correction_reason = clean_reason
    where a.id = correct_analysis.automation_run_id and a.request_id = req.id and a.status = 'succeeded';
    if not found then
      raise exception 'Automatisierungslauf gehört nicht zu dieser Anfrage oder ist nicht abgeschlossen' using errcode = 'RW422';
    end if;
  end if;

  update public.requests r
  set service_kind = coalesce(correct_analysis.service_kind, r.service_kind),
      priority = coalesce(correct_analysis.priority, r.priority)
  where r.id = req.id returning * into result;

  perform private.log_request_event(
    req.id,
    case when correct_analysis.automation_run_id is not null or req.intake_mode = 'automatic'
      then 'automatic_result_corrected' else 'analysis_corrected' end,
    jsonb_build_object('service_kind', req.service_kind, 'priority', req.priority)::text,
    jsonb_build_object('service_kind', result.service_kind, 'priority', result.priority)::text,
    clean_reason,
    jsonb_build_object('automation_run_id', correct_analysis.automation_run_id),
    'dispatch'
  );
  return result;
end;
$$;

-- Complete initial processing: request is ready for scheduling.
-- Mode of the first outcome: from new = manual, from analyzing/needs_review = human_review.
create function public.complete_intake(
  request_id uuid,
  expected_version integer,
  priority public.request_priority default null,
  note text default null
)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  result public.requests;
  first_completion boolean;
  baseline numeric(8,2);
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  req := private.lock_request(complete_intake.request_id, complete_intake.expected_version);

  -- Repeated completion returns the existing outcome
  if req.intake_status = 'processed' then
    return req;
  end if;

  if req.intake_status not in ('new', 'analyzing', 'needs_review') or private.is_terminal(req) then
    raise exception 'Erstbearbeitung kann aus Status % nicht abgeschlossen werden', req.intake_status using errcode = 'RW422';
  end if;

  if coalesce(complete_intake.priority, req.priority) is null then
    raise exception 'Priorität muss vor Abschluss der Erstbearbeitung festgelegt sein' using errcode = 'RW422';
  end if;

  first_completion := req.intake_completed_at is null;
  select s.manual_intake_minutes into baseline from public.settings s where s.id = 1;

  update public.requests r
  set intake_status = 'processed',
      priority = coalesce(complete_intake.priority, r.priority),
      intake_completed_at = case when first_completion then now() else r.intake_completed_at end,
      intake_mode = case when first_completion
        then (case when req.intake_status = 'new' then 'manual' else 'human_review' end)::public.intake_mode
        else r.intake_mode end,
      manual_minutes_baseline = case when first_completion then baseline else r.manual_minutes_baseline end
  where r.id = req.id returning * into result;

  perform private.log_request_event(req.id, 'intake_status_changed', req.intake_status::text, 'processed', complete_intake.note);
  if first_completion then
    perform private.log_request_event(req.id, 'intake_completed', null, result.intake_mode::text, complete_intake.note,
      jsonb_build_object('manual_minutes_baseline', baseline));
  end if;
  return result;
end;
$$;

-- Reopen a processed request before technical completion; keeps the first completion snapshot and bookings
create function public.reopen_intake(
  request_id uuid,
  expected_version integer,
  target_status public.intake_status,
  reason text
)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  result public.requests;
  clean_reason text := private.require_reason(reopen_intake.reason);
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  req := private.lock_request(reopen_intake.request_id, reopen_intake.expected_version);

  if req.intake_status <> 'processed' or private.is_terminal(req) then
    raise exception 'Nur bearbeitete, nicht abgeschlossene Anfragen können wieder geöffnet werden' using errcode = 'RW422';
  end if;

  if reopen_intake.target_status not in ('analyzing', 'needs_review', 'awaiting_customer') then
    raise exception 'Wiedereröffnung nur nach analyzing, needs_review oder awaiting_customer' using errcode = 'RW422';
  end if;

  update public.requests r
  set intake_status = reopen_intake.target_status,
      human_review_required = r.human_review_required or reopen_intake.target_status = 'needs_review'
  where r.id = req.id returning * into result;

  perform private.log_request_event(req.id, 'intake_status_changed', 'processed', reopen_intake.target_status::text, clean_reason,
    jsonb_build_object('reopened', true));
  return result;
end;
$$;

-- Reject before work starts; a human decision with a reason
create function public.reject_request(request_id uuid, expected_version integer, reason text)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  result public.requests;
  clean_reason text := private.require_reason(reject_request.reason);
  first_completion boolean;
  baseline numeric(8,2);
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  req := private.lock_request(reject_request.request_id, reject_request.expected_version);

  if private.is_terminal(req) or req.work_status not in ('not_planned', 'scheduled') then
    raise exception 'Ablehnung ist nur vor Arbeitsbeginn möglich' using errcode = 'RW422';
  end if;

  first_completion := req.intake_completed_at is null;
  select s.manual_intake_minutes into baseline from public.settings s where s.id = 1;

  perform private.cancel_open_visits(req.id, 'Anfrage abgelehnt: ' || clean_reason);

  update public.requests r
  set intake_status = 'rejected',
      work_status = 'cancelled',
      rejection_reason = clean_reason,
      intake_completed_at = case when first_completion then now() else r.intake_completed_at end,
      intake_mode = case when first_completion
        then (case when req.intake_status = 'new' then 'manual' else 'human_review' end)::public.intake_mode
        else r.intake_mode end,
      manual_minutes_baseline = case when first_completion then baseline else r.manual_minutes_baseline end
  where r.id = req.id returning * into result;

  perform private.log_request_event(req.id, 'intake_status_changed', req.intake_status::text, 'rejected', clean_reason);
  perform private.log_request_event(req.id, 'work_status_changed', req.work_status::text, 'cancelled', clean_reason);
  if first_completion then
    perform private.log_request_event(req.id, 'intake_completed', null, result.intake_mode::text, clean_reason,
      jsonb_build_object('manual_minutes_baseline', baseline, 'outcome', 'rejected'));
  end if;
  return result;
end;
$$;

-- Cancel before work completion; no fictitious intake completion
create function public.cancel_request(request_id uuid, expected_version integer, reason text)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  result public.requests;
  clean_reason text := private.require_reason(cancel_request.reason);
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  req := private.lock_request(cancel_request.request_id, cancel_request.expected_version);

  if private.is_terminal(req) then
    raise exception 'Abgeschlossene, abgelehnte oder stornierte Anfragen können nicht storniert werden' using errcode = 'RW422';
  end if;

  perform private.cancel_open_visits(req.id, 'Anfrage storniert: ' || clean_reason);

  update public.requests r
  set intake_status = 'cancelled',
      work_status = 'cancelled',
      cancellation_reason = clean_reason,
      cancelled_at = now()
  where r.id = req.id returning * into result;

  perform private.log_request_event(req.id, 'intake_status_changed', req.intake_status::text, 'cancelled', clean_reason);
  perform private.log_request_event(req.id, 'work_status_changed', req.work_status::text, 'cancelled', clean_reason);
  return result;
end;
$$;

-- Set or move an agreed deadline. An elapsed, unfulfilled deadline is recorded as breach before it moves.
create function public.change_deadline(
  request_id uuid,
  expected_version integer,
  deadline_kind text,
  new_due_at timestamptz,
  reason text
)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  result public.requests;
  clean_reason text := private.require_reason(change_deadline.reason);
  old_due timestamptz;
  fulfilled_at timestamptz;
  breach boolean;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  req := private.lock_request(change_deadline.request_id, change_deadline.expected_version);

  if private.is_terminal(req) then
    raise exception 'Fristen abgeschlossener Anfragen werden nicht geändert' using errcode = 'RW422';
  end if;

  if change_deadline.deadline_kind = 'response' then
    old_due := req.response_due_at;
    fulfilled_at := req.first_substantive_response_at;
  elsif change_deadline.deadline_kind = 'service' then
    old_due := req.service_due_at;
    fulfilled_at := req.completed_at;
  else
    raise exception 'Fristart muss response oder service sein' using errcode = 'RW422';
  end if;

  if old_due is not distinct from change_deadline.new_due_at then
    raise exception 'Frist ist unverändert' using errcode = 'RW422';
  end if;

  breach := old_due is not null and old_due < now() and (fulfilled_at is null or fulfilled_at > old_due);

  if change_deadline.deadline_kind = 'response' then
    update public.requests r set response_due_at = change_deadline.new_due_at where r.id = req.id returning * into result;
  else
    update public.requests r set service_due_at = change_deadline.new_due_at where r.id = req.id returning * into result;
  end if;

  perform private.log_request_event(req.id, 'deadline_changed', old_due::text, change_deadline.new_due_at::text, clean_reason,
    jsonb_build_object('deadline_kind', change_deadline.deadline_kind, 'old_due_at', old_due,
                       'new_due_at', change_deadline.new_due_at, 'breach_recorded', breach));
  return result;
end;
$$;

-- Only signed-in employees may call operations; checks happen inside
revoke all on function
  private.require_role(public.employee_role[]),
  private.lock_request(uuid, integer),
  private.log_request_event(uuid, text, text, text, text, jsonb, public.visibility_level),
  private.require_reason(text),
  private.is_terminal(public.requests),
  private.cancel_open_visits(uuid, text)
from public, anon, authenticated;

revoke all on function
  public.assign_dispatcher(uuid, integer, uuid),
  public.mark_needs_review(uuid, integer, text),
  public.mark_awaiting_customer(uuid, integer, text),
  public.resume_analysis(uuid, integer, text),
  public.correct_analysis(uuid, integer, text, public.service_kind, public.request_priority, uuid),
  public.complete_intake(uuid, integer, public.request_priority, text),
  public.reopen_intake(uuid, integer, public.intake_status, text),
  public.reject_request(uuid, integer, text),
  public.cancel_request(uuid, integer, text),
  public.change_deadline(uuid, integer, text, timestamptz, text)
from public, anon;

grant execute on function
  public.assign_dispatcher(uuid, integer, uuid),
  public.mark_needs_review(uuid, integer, text),
  public.mark_awaiting_customer(uuid, integer, text),
  public.resume_analysis(uuid, integer, text),
  public.correct_analysis(uuid, integer, text, public.service_kind, public.request_priority, uuid),
  public.complete_intake(uuid, integer, public.request_priority, text),
  public.reopen_intake(uuid, integer, public.intake_status, text),
  public.reject_request(uuid, integer, text),
  public.cancel_request(uuid, integer, text),
  public.change_deadline(uuid, integer, text, timestamptz, text)
to authenticated;
