-- Deterministic order of audit events. Events written in one transaction share occurred_at (now()),
-- so history reconstruction and analytics order by (occurred_at, seq).

alter table public.request_events add column seq bigint generated always as identity;

create index request_events_request_order_idx on public.request_events (request_id, occurred_at, seq);

comment on column public.request_events.seq is 'Monoton steigende Reihenfolge; ordnet Ereignisse mit gleichem occurred_at.';
