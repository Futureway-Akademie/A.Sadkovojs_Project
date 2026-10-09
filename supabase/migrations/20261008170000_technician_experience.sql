-- Planning suggestions (task-10-3): experience of each active technician for one request, as counts of
-- completed visits only (no customer, request or visit details). Used to rank suggested time slots:
-- same customer (customer number, otherwise company name) first; for new customers the same
-- manufacturer with the same equipment type, then the same equipment type.
-- Callable by planners (dispatcher, manager, admin) who may read the request.
create function public.technician_experience(request_id uuid)
returns table (technician_id uuid, customer_visits integer, manufacturer_visits integer, equipment_visits integer)
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select r.id, nullif(btrim(r.customer_number), '') as customer_number, lower(btrim(r.company_name)) as company,
      nullif(lower(btrim(r.manufacturer)), '') as manufacturer, r.equipment_kind
    from public.requests r
    where r.id = technician_experience.request_id
      and private.current_employee_role() in ('dispatcher', 'manager', 'admin')
      and private.can_access_request(r.id)
  ),
  done as (
    select v.technician_id, r.customer_number, lower(btrim(r.company_name)) as company,
      nullif(lower(btrim(r.manufacturer)), '') as manufacturer, r.equipment_kind
    from public.visits v
    join public.requests r on r.id = v.request_id
    cross join target t
    where v.status = 'completed' and r.id <> t.id
  )
  select p.id,
    count(d.technician_id) filter (where (t.customer_number is not null and d.customer_number = t.customer_number)
      or (t.customer_number is null and d.company = t.company))::int,
    count(d.technician_id) filter (where t.manufacturer is not null and d.manufacturer = t.manufacturer and d.equipment_kind = t.equipment_kind)::int,
    count(d.technician_id) filter (where d.equipment_kind = t.equipment_kind)::int
  from target t
  cross join public.profiles p
  left join done d on d.technician_id = p.id
  where p.role = 'technician' and p.is_active
  group by p.id
  order by p.id;
$$;

revoke all on function public.technician_experience(uuid) from public, anon;
grant execute on function public.technician_experience(uuid) to authenticated;
