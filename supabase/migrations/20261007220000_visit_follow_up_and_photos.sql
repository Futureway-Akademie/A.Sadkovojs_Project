-- task-6-2: follow-up visit request on completion and registration of visit photos.
--
-- complete_visit gets an optional follow_up_reason. Completing a visit still never closes the request.
-- With a reason, a request that was in progress and has no other open visit returns to work_status
-- not_planned, so it appears again in the dispatcher's planning queue. A request waiting for parts
-- stays waiting_parts (already in the planning queue as follow-up after delivery).
--
-- add_visit_photo registers a photo that the server has uploaded to the private bucket "dashboard"
-- under visits/<request_id>/<visit_id>/. The function checks the actor like all visit operations,
-- requires the storage object to exist and writes attachment and audit event atomically.

drop function public.complete_visit(uuid, integer, integer, text);

create function public.complete_visit(
  visit_id uuid,
  expected_version integer,
  actual_work_minutes integer,
  summary text default null,
  follow_up_reason text default null
)
returns public.visits
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked record;
  result public.visits;
  reason text := nullif(btrim(complete_visit.follow_up_reason), '');
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

  if complete_visit.follow_up_reason is not null and reason is null then
    raise exception 'Für einen Folgeeinsatz ist ein Grund erforderlich' using errcode = 'RW422';
  end if;

  update public.visits v
  set status = 'completed',
      actual_end = greatest(now(), v.actual_start),
      actual_work_minutes = complete_visit.actual_work_minutes,
      summary = nullif(btrim(complete_visit.summary), '')
  where v.id = (locked.vis).id returning * into result;

  insert into public.request_events (request_id, visit_id, actor_type, actor_id, event_type, from_value, to_value, note, data)
  values ((locked.req).id, result.id, 'user', (select auth.uid()), 'visit_status_changed', (locked.vis).status::text, 'completed',
    result.summary, jsonb_build_object('actual_work_minutes', result.actual_work_minutes, 'follow_up_required', reason is not null));

  if reason is not null then
    insert into public.request_events (request_id, visit_id, actor_type, actor_id, event_type, note, data)
    values ((locked.req).id, result.id, 'user', (select auth.uid()), 'follow_up_requested', reason, '{}'::jsonb);

    if (locked.req).work_status = 'in_progress' and not exists (
      select 1 from public.visits v
      where v.request_id = (locked.req).id and v.id <> result.id and v.status in ('scheduled', 'in_progress', 'waiting_parts')
    ) then
      perform private.set_work_status(locked.req, 'not_planned', 'Folgeeinsatz erforderlich: ' || reason);
    end if;
  end if;

  -- Request version changes so that stale clients notice the new visit state
  update public.requests r set updated_at = now() where r.id = (locked.req).id;
  return result;
end;
$$;

create function public.add_visit_photo(
  visit_id uuid,
  expected_version integer,
  storage_path text,
  file_name text,
  mime_type text,
  size_bytes bigint
)
returns public.attachments
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked record;
  result public.attachments;
  clean_name text := nullif(btrim(add_visit_photo.file_name), '');
begin
  perform private.require_role('technician', 'manager', 'admin');
  locked := private.lock_visit(add_visit_photo.visit_id, add_visit_photo.expected_version);
  perform private.require_visit_actor(locked.vis);

  if (locked.vis).status = 'cancelled' or (locked.req).intake_status in ('rejected', 'cancelled') or (locked.req).work_status = 'cancelled' then
    raise exception 'Fotos nur zu nicht stornierten Einsätzen' using errcode = 'RW422';
  end if;
  if add_visit_photo.mime_type not in ('image/jpeg', 'image/png') then
    raise exception 'Nur JPEG- oder PNG-Fotos' using errcode = 'RW422';
  end if;
  if add_visit_photo.size_bytes is null or add_visit_photo.size_bytes <= 0 or add_visit_photo.size_bytes > 10485760 then
    raise exception 'Foto muss zwischen 1 Byte und 10 MB groß sein' using errcode = 'RW422';
  end if;
  if clean_name is null then
    raise exception 'Dateiname ist erforderlich' using errcode = 'RW422';
  end if;
  if add_visit_photo.storage_path not like 'visits/' || (locked.req).id || '/' || (locked.vis).id || '/%'
     or add_visit_photo.storage_path like '%..%' then
    raise exception 'Ungültiger Speicherpfad' using errcode = 'RW422';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'dashboard' and o.name = add_visit_photo.storage_path) then
    raise exception 'Datei wurde nicht hochgeladen' using errcode = 'RW422';
  end if;

  insert into public.attachments (request_id, visit_id, bucket, storage_path, file_name, mime_type, size_bytes, uploaded_by, visibility)
  values ((locked.req).id, (locked.vis).id, 'dashboard', add_visit_photo.storage_path, clean_name, add_visit_photo.mime_type,
    add_visit_photo.size_bytes, (select auth.uid()), 'operational')
  returning * into result;

  insert into public.request_events (request_id, visit_id, actor_type, actor_id, event_type, to_value, data)
  values ((locked.req).id, (locked.vis).id, 'user', (select auth.uid()), 'photo_added', clean_name,
    jsonb_build_object('attachment_id', result.id));

  update public.requests r set updated_at = now() where r.id = (locked.req).id;
  return result;
end;
$$;

revoke all on function
  public.complete_visit(uuid, integer, integer, text, text),
  public.add_visit_photo(uuid, integer, text, text, text, bigint)
from public, anon;

grant execute on function
  public.complete_visit(uuid, integer, integer, text, text),
  public.add_visit_photo(uuid, integer, text, text, text, bigint)
to authenticated;
