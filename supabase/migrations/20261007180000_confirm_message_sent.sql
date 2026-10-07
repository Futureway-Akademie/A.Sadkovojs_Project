-- Integration operation: confirmed delivery of a queued e-mail (spec 5.3, 5.6, 7, 8).
-- Called only by the trusted backend / future n8n workflow with the service role, never by dashboard users.
--
-- * queued -> sent with provider identifiers; a repeated confirmation returns the existing result.
-- * Clarifications and other substantive replies set requests.first_substantive_response_at once;
--   receipt acknowledgments do not.
-- * Invoice e-mails move an issued invoice to sent. A paid invoice stays paid and only receives sent_at.
-- * Demo requests cannot be sent.

create function public.confirm_message_sent(
  message_id uuid,
  sent_at timestamptz default null,
  mailbox_key text default null,
  gmail_message_id text default null,
  gmail_thread_id text default null,
  mime_message_id text default null
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg public.messages;
  req public.requests;
  inv public.invoices;
  result public.messages;
  delivery_time timestamptz := coalesce(confirm_message_sent.sent_at, now());
begin
  select * into msg from public.messages m where m.id = confirm_message_sent.message_id for update;
  if not found or msg.direction <> 'outgoing' then
    raise exception 'Ausgehende Nachricht nicht gefunden' using errcode = 'RW422';
  end if;

  if msg.status = 'sent' then
    return msg;
  end if;
  if msg.status <> 'queued' then
    raise exception 'Nur Nachrichten in der Warteschlange können als versendet bestätigt werden' using errcode = 'RW422';
  end if;

  select * into req from public.requests r where r.id = msg.request_id for update;
  if req.is_demo then
    raise exception 'Demo-Anfragen werden nicht versendet' using errcode = 'RW422';
  end if;

  update public.messages m
  set status = 'sent',
      sent_at = delivery_time,
      mailbox_key = coalesce(confirm_message_sent.mailbox_key, m.mailbox_key),
      gmail_message_id = coalesce(confirm_message_sent.gmail_message_id, m.gmail_message_id),
      gmail_thread_id = coalesce(confirm_message_sent.gmail_thread_id, m.gmail_thread_id),
      mime_message_id = coalesce(confirm_message_sent.mime_message_id, m.mime_message_id),
      error_text = null
  where m.id = msg.id
  returning * into result;

  if msg.kind in ('clarification', 'other') and req.first_substantive_response_at is null then
    update public.requests r set first_substantive_response_at = delivery_time where r.id = req.id;
  else
    update public.requests r set updated_at = now() where r.id = req.id;
  end if;

  insert into public.request_events (request_id, actor_type, event_type, visibility, from_value, to_value, data)
  values (req.id, 'automation', 'message_sent', 'dispatch', 'queued', 'sent',
    jsonb_build_object('message_id', msg.id, 'kind', msg.kind, 'sent_at', delivery_time));

  if msg.kind = 'invoice' and msg.invoice_id is not null then
    select * into inv from public.invoices i where i.id = msg.invoice_id for update;

    if inv.status = 'issued' then
      update public.invoices i set status = 'sent', sent_at = delivery_time where i.id = inv.id;
    elsif inv.status = 'paid' and inv.sent_at is null then
      update public.invoices i set sent_at = delivery_time where i.id = inv.id;
    end if;

    insert into public.request_events (request_id, actor_type, event_type, from_value, to_value, data)
    values (req.id, 'automation', 'invoice_sent', inv.status::text,
      case when inv.status = 'issued' then 'sent' else inv.status::text end,
      jsonb_build_object('invoice_id', inv.id, 'message_id', msg.id, 'sent_at', delivery_time));
  end if;

  return result;
end;
$$;

revoke all on function public.confirm_message_sent(uuid, timestamptz, text, text, text, text) from public, anon, authenticated;
grant execute on function public.confirm_message_sent(uuid, timestamptz, text, text, text, text) to service_role;
