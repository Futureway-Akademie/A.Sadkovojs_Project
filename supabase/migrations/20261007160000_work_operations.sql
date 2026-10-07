-- Controlled operations for work entries and request closure (spec 5.5, 6, 8).
--
-- * expected_version refers to requests.version; every change increments it.
-- * Unit follows from the kind (labor = hour, part = piece, fixed_service = service).
-- * Work entries can be changed by the current technician, the technician of the referenced own visit,
--   or managers/admins; not on rejected/cancelled requests and not once billed (referenced by an invoice item).
-- * Closing a request does not touch invoices or payment.

create function private.unit_for_kind(entry_kind public.work_entry_kind)
returns public.work_unit
language sql
immutable
set search_path = ''
as $$
  select case entry_kind
    when 'labor' then 'hour'
    when 'part' then 'piece'
    when 'fixed_service' then 'service'
  end::public.work_unit;
$$;

-- Allowed status transitions per kind
create function private.work_status_transition_allowed(
  entry_kind public.work_entry_kind,
  from_status public.work_item_status,
  to_status public.work_item_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when entry_kind = 'part' then (from_status, to_status) in (
      ('planned', 'ordered'), ('planned', 'used'), ('ordered', 'used'),
      ('planned', 'cancelled'), ('ordered', 'cancelled'), ('used', 'cancelled'))
    else (from_status, to_status) in (
      ('planned', 'performed'), ('planned', 'cancelled'), ('performed', 'cancelled'))
  end;
$$;

create function private.require_work_entry_actor(req public.requests, target_visit_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.current_employee_role() in ('manager', 'admin') then
    return;
  end if;

  if private.current_employee_role() = 'technician' and (
    private.is_current_technician(req.id)
    or exists (select 1 from public.visits v where v.id = target_visit_id and v.request_id = req.id and v.technician_id = (select auth.uid()))
  ) then
    return;
  end if;

  raise exception 'Nur der aktuelle Techniker, der Techniker des Einsatzes oder Manager/Admin erfassen Arbeitspositionen'
    using errcode = '42501';
end;
$$;

create function private.require_request_open_for_work(req public.requests)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if req.intake_status in ('rejected', 'cancelled') or req.work_status = 'cancelled' then
    raise exception 'Für abgelehnte oder stornierte Anfragen werden keine Arbeitspositionen erfasst' using errcode = 'RW422';
  end if;
end;
$$;

-- Loads an entry with its request locked; rejects billed entries
create function private.lock_work_entry(target_entry_id uuid, expected_version integer, out req public.requests, out entry public.work_entries)
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry_request_id uuid;
begin
  select w.request_id into entry_request_id from public.work_entries w where w.id = target_entry_id;
  if entry_request_id is null then
    raise exception 'Arbeitsposition nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;

  req := private.lock_request(entry_request_id, expected_version);
  select * into entry from public.work_entries w where w.id = target_entry_id for update;

  perform private.require_work_entry_actor(req, entry.visit_id);
  perform private.require_request_open_for_work(req);

  if exists (select 1 from public.invoice_items i where i.work_entry_id = target_entry_id) then
    raise exception 'Abgerechnete Arbeitspositionen sind gesperrt' using errcode = 'RW422';
  end if;
end;
$$;

-- Record time, parts or a fixed service
create function public.add_work_entry(
  request_id uuid,
  expected_version integer,
  kind public.work_entry_kind,
  description text,
  quantity numeric,
  item_status public.work_item_status default 'planned',
  unit_price numeric default null,
  tax_rate numeric default null,
  visit_id uuid default null,
  service_rate_id uuid default null,
  billable boolean default true
)
returns public.work_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  rate public.service_rates;
  result public.work_entries;
  price numeric(12,2);
  tax numeric(5,2);
begin
  perform private.require_role('technician', 'manager', 'admin');
  req := private.lock_request(add_work_entry.request_id, add_work_entry.expected_version);
  perform private.require_work_entry_actor(req, add_work_entry.visit_id);
  perform private.require_request_open_for_work(req);

  if nullif(btrim(add_work_entry.description), '') is null then
    raise exception 'Beschreibung ist erforderlich' using errcode = 'RW422';
  end if;
  if add_work_entry.quantity is null or add_work_entry.quantity <= 0 then
    raise exception 'Menge muss größer als 0 sein' using errcode = 'RW422';
  end if;
  if add_work_entry.item_status not in ('planned', 'ordered', 'performed', 'used')
     or not (add_work_entry.item_status = 'planned'
             or private.work_status_transition_allowed(add_work_entry.kind, 'planned', add_work_entry.item_status)) then
    raise exception 'Status % passt nicht zur Art %', add_work_entry.item_status, add_work_entry.kind using errcode = 'RW422';
  end if;

  if add_work_entry.visit_id is not null and not exists (
    select 1 from public.visits v where v.id = add_work_entry.visit_id and v.request_id = req.id
  ) then
    raise exception 'Einsatz gehört nicht zu dieser Anfrage' using errcode = 'RW422';
  end if;

  if add_work_entry.service_rate_id is not null then
    select * into rate from public.service_rates s where s.id = add_work_entry.service_rate_id and s.is_active;
    if not found then
      raise exception 'Tarif nicht gefunden oder inaktiv' using errcode = 'RW422';
    end if;
    if add_work_entry.kind = 'part'
       or (rate.billing_model = 'hourly' and add_work_entry.kind <> 'labor')
       or (rate.billing_model = 'fixed' and add_work_entry.kind <> 'fixed_service') then
      raise exception 'Tarif % (%) passt nicht zur Art %', rate.code, rate.billing_model, add_work_entry.kind using errcode = 'RW422';
    end if;
    if rate.service_kind <> req.service_kind then
      raise exception 'Tarif % gilt nicht für die Leistungsart der Anfrage', rate.code using errcode = 'RW422';
    end if;
  end if;

  price := coalesce(add_work_entry.unit_price, rate.unit_price);
  tax := coalesce(add_work_entry.tax_rate, rate.tax_rate, (select s.default_tax_rate from public.settings s where s.id = 1));
  if price is null or price < 0 then
    raise exception 'Einzelpreis ist erforderlich und darf nicht negativ sein' using errcode = 'RW422';
  end if;
  if tax < 0 or tax > 100 then
    raise exception 'Steuersatz muss zwischen 0 und 100 liegen' using errcode = 'RW422';
  end if;

  insert into public.work_entries (
    request_id, visit_id, author_id, kind, item_status, service_rate_id, description, quantity, unit,
    unit_price, tax_rate, billable, ordered_at, performed_at)
  values (
    req.id, add_work_entry.visit_id, (select auth.uid()), add_work_entry.kind, add_work_entry.item_status,
    add_work_entry.service_rate_id, btrim(add_work_entry.description), add_work_entry.quantity,
    private.unit_for_kind(add_work_entry.kind), price, tax, add_work_entry.billable,
    case when add_work_entry.item_status = 'ordered' then now() end,
    case when add_work_entry.item_status in ('performed', 'used') then now() end)
  returning * into result;

  update public.requests r set updated_at = now() where r.id = req.id;

  insert into public.request_events (request_id, visit_id, actor_type, actor_id, event_type, to_value, data)
  values (req.id, result.visit_id, 'user', (select auth.uid()), 'work_entry_added', result.item_status::text,
    jsonb_build_object('work_entry_id', result.id, 'kind', result.kind, 'description', result.description,
                       'quantity', result.quantity, 'unit', result.unit, 'unit_price', result.unit_price, 'billable', result.billable));
  return result;
end;
$$;

-- Correct description, quantity, price or billable flag of an unbilled entry
create function public.update_work_entry(
  work_entry_id uuid,
  expected_version integer,
  description text default null,
  quantity numeric default null,
  unit_price numeric default null,
  billable boolean default null
)
returns public.work_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked record;
  result public.work_entries;
begin
  perform private.require_role('technician', 'manager', 'admin');
  locked := private.lock_work_entry(update_work_entry.work_entry_id, update_work_entry.expected_version);

  if (locked.entry).item_status = 'cancelled' then
    raise exception 'Stornierte Positionen werden nicht geändert' using errcode = 'RW422';
  end if;
  if update_work_entry.description is not null and btrim(update_work_entry.description) = '' then
    raise exception 'Beschreibung darf nicht leer sein' using errcode = 'RW422';
  end if;
  if update_work_entry.quantity is not null and update_work_entry.quantity <= 0 then
    raise exception 'Menge muss größer als 0 sein' using errcode = 'RW422';
  end if;
  if update_work_entry.unit_price is not null and update_work_entry.unit_price < 0 then
    raise exception 'Einzelpreis darf nicht negativ sein' using errcode = 'RW422';
  end if;

  update public.work_entries w
  set description = coalesce(btrim(update_work_entry.description), w.description),
      quantity = coalesce(update_work_entry.quantity, w.quantity),
      unit_price = coalesce(update_work_entry.unit_price, w.unit_price),
      billable = coalesce(update_work_entry.billable, w.billable)
  where w.id = (locked.entry).id
  returning * into result;

  update public.requests r set updated_at = now() where r.id = (locked.req).id;

  insert into public.request_events (request_id, visit_id, actor_type, actor_id, event_type, from_value, to_value, data)
  values ((locked.req).id, result.visit_id, 'user', (select auth.uid()), 'work_entry_changed',
    jsonb_build_object('description', (locked.entry).description, 'quantity', (locked.entry).quantity,
                       'unit_price', (locked.entry).unit_price, 'billable', (locked.entry).billable)::text,
    jsonb_build_object('description', result.description, 'quantity', result.quantity,
                       'unit_price', result.unit_price, 'billable', result.billable)::text,
    jsonb_build_object('work_entry_id', result.id));
  return result;
end;
$$;

-- Move an entry through its lifecycle (ordered, used, performed, cancelled)
create function public.set_work_entry_status(work_entry_id uuid, expected_version integer, new_status public.work_item_status)
returns public.work_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked record;
  result public.work_entries;
begin
  perform private.require_role('technician', 'manager', 'admin');
  locked := private.lock_work_entry(set_work_entry_status.work_entry_id, set_work_entry_status.expected_version);

  if not private.work_status_transition_allowed((locked.entry).kind, (locked.entry).item_status, set_work_entry_status.new_status) then
    raise exception 'Übergang % → % ist für % nicht erlaubt',
      (locked.entry).item_status, set_work_entry_status.new_status, (locked.entry).kind
      using errcode = 'RW422';
  end if;

  update public.work_entries w
  set item_status = set_work_entry_status.new_status,
      ordered_at = case when set_work_entry_status.new_status = 'ordered' then now() else w.ordered_at end,
      performed_at = case when set_work_entry_status.new_status in ('performed', 'used') then now() else w.performed_at end
  where w.id = (locked.entry).id
  returning * into result;

  update public.requests r set updated_at = now() where r.id = (locked.req).id;

  insert into public.request_events (request_id, visit_id, actor_type, actor_id, event_type, from_value, to_value, data)
  values ((locked.req).id, result.visit_id, 'user', (select auth.uid()), 'work_entry_changed',
    (locked.entry).item_status::text, result.item_status::text, jsonb_build_object('work_entry_id', result.id));
  return result;
end;
$$;

-- Explicit technical completion of the request. Payment stays separate.
create function public.close_request(request_id uuid, expected_version integer, completion_summary text)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  result public.requests;
begin
  perform private.require_role('technician', 'manager', 'admin');
  req := private.lock_request(close_request.request_id, close_request.expected_version);

  if private.current_employee_role() = 'technician' and not private.is_current_technician(req.id) then
    raise exception 'Nur der aktuell zugewiesene Techniker oder Manager/Admin schließt die Anfrage ab' using errcode = '42501';
  end if;

  -- Repeated closure returns the existing outcome
  if req.work_status = 'completed' then
    return req;
  end if;

  if req.intake_status <> 'processed' or private.is_terminal(req) then
    raise exception 'Nur bearbeitete, offene Anfragen können abgeschlossen werden' using errcode = 'RW422';
  end if;

  if nullif(btrim(close_request.completion_summary), '') is null then
    raise exception 'Ein Abschlussbericht ist erforderlich' using errcode = 'RW422';
  end if;

  if exists (
    select 1 from public.visits v where v.request_id = req.id and v.status in ('scheduled', 'in_progress', 'waiting_parts')
  ) then
    raise exception 'Offene Einsätze müssen zuerst abgeschlossen oder storniert werden' using errcode = 'RW422';
  end if;

  if not exists (select 1 from public.visits v where v.request_id = req.id and v.status = 'completed') then
    raise exception 'Mindestens ein abgeschlossener Einsatz ist erforderlich' using errcode = 'RW422';
  end if;

  update public.requests r
  set work_status = 'completed', completed_at = now(), completion_summary = btrim(close_request.completion_summary)
  where r.id = req.id
  returning * into result;

  perform private.log_request_event(req.id, 'work_status_changed', req.work_status::text, 'completed');
  perform private.log_request_event(req.id, 'work_completed', null, null, result.completion_summary,
    jsonb_build_object('completed_at', result.completed_at));
  return result;
end;
$$;

-- Privileges
revoke all on function
  private.unit_for_kind(public.work_entry_kind),
  private.work_status_transition_allowed(public.work_entry_kind, public.work_item_status, public.work_item_status),
  private.require_work_entry_actor(public.requests, uuid),
  private.require_request_open_for_work(public.requests),
  private.lock_work_entry(uuid, integer)
from public, anon, authenticated;

revoke all on function
  public.add_work_entry(uuid, integer, public.work_entry_kind, text, numeric, public.work_item_status, numeric, numeric, uuid, uuid, boolean),
  public.update_work_entry(uuid, integer, text, numeric, numeric, boolean),
  public.set_work_entry_status(uuid, integer, public.work_item_status),
  public.close_request(uuid, integer, text)
from public, anon;

grant execute on function
  public.add_work_entry(uuid, integer, public.work_entry_kind, text, numeric, public.work_item_status, numeric, numeric, uuid, uuid, boolean),
  public.update_work_entry(uuid, integer, text, numeric, numeric, boolean),
  public.set_work_entry_status(uuid, integer, public.work_item_status),
  public.close_request(uuid, integer, text)
to authenticated;
