-- task-1-3: messages, automation_runs, attachments. Run with: supabase test db
begin;
select plan(30);

-- Fixtures: one dispatcher, two requests
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'disp@example.test');
insert into public.profiles (id, display_name, role) values ('00000000-0000-0000-0000-0000000000d1', 'Test Dispo', 'dispatcher');

insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload)
select r.id, r.key, 'x', 'demo_seed', 'ACME', 'Erika', 'e@acme.test', '1', 'Str. 1', '40210', 'Düsseldorf',
  'pump', 'inspection', date '2026-10-20', 'Test', 'planbar', 'none_known', '{}'
from (values ('00000000-0000-0000-0000-0000000000a1'::uuid, 'r1'), ('00000000-0000-0000-0000-0000000000a2'::uuid, 'r2')) as r(id, key);

-- Structure
select has_table('public', 'messages', 'messages exists');
select has_table('public', 'automation_runs', 'automation_runs exists');
select has_table('public', 'attachments', 'attachments exists');
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.messages'::regclass, 'public.automation_runs'::regclass, 'public.attachments'::regclass)),
  'RLS enabled'
);

-- messages: valid rows
select lives_ok(
  $$insert into public.messages (id, request_id, direction, kind, status, from_address, subject, body_text, received_at, mailbox_key, gmail_message_id)
    values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'incoming', 'customer_reply', 'received', 'e@acme.test', 'Re', 'Text', now(), 'service', 'g1')$$,
  'incoming linked message accepted'
);
select lives_ok(
  $$insert into public.messages (id, inbox_dispatcher_id, direction, kind, status, from_address, subject, body_text, received_at)
    values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', 'incoming', 'other', 'received', 'x@y.test', 'Frage', 'Text', now())$$,
  'unmatched incoming message in dispatcher inbox accepted'
);
select lives_ok(
  $$insert into public.messages (request_id, direction, kind, status, to_address, subject, body_text)
    values ('00000000-0000-0000-0000-0000000000a1', 'outgoing', 'clarification', 'draft', 'e@acme.test', 'Rückfrage', 'Text')$$,
  'outgoing draft accepted'
);

-- messages: constraints
select throws_ok(
  $$insert into public.messages (direction, kind, status, from_address, subject, body_text, received_at)
    values ('incoming', 'other', 'received', 'x@y.test', 'S', 'B', now())$$,
  '23514', null, 'message needs request or inbox dispatcher'
);
select throws_ok(
  $$insert into public.messages (inbox_dispatcher_id, direction, kind, status, to_address, subject, body_text)
    values ('00000000-0000-0000-0000-0000000000d1', 'outgoing', 'other', 'draft', 'x@y.test', 'S', 'B')$$,
  '23514', null, 'outgoing message needs request'
);
select throws_ok(
  $$insert into public.messages (request_id, direction, kind, status, from_address, subject, body_text, received_at)
    values ('00000000-0000-0000-0000-0000000000a1', 'incoming', 'customer_reply', 'sent', 'x@y.test', 'S', 'B', now())$$,
  '23514', null, 'incoming message must be received'
);
select throws_ok(
  $$insert into public.messages (request_id, direction, kind, status, from_address, subject, body_text)
    values ('00000000-0000-0000-0000-0000000000a1', 'incoming', 'customer_reply', 'received', 'x@y.test', 'S', 'B')$$,
  '23514', null, 'incoming message needs received_at'
);
select throws_ok(
  $$insert into public.messages (request_id, direction, kind, status, to_address, subject, body_text)
    values ('00000000-0000-0000-0000-0000000000a1', 'outgoing', 'receipt', 'received', 'x@y.test', 'S', 'B')$$,
  '23514', null, 'outgoing message cannot be received'
);
select throws_ok(
  $$insert into public.messages (request_id, direction, kind, status, to_address, subject, body_text)
    values ('00000000-0000-0000-0000-0000000000a1', 'outgoing', 'receipt', 'sent', 'x@y.test', 'S', 'B')$$,
  '23514', null, 'sent message needs sent_at'
);
select throws_ok(
  $$insert into public.messages (request_id, direction, kind, status, to_address, subject, body_text)
    values ('00000000-0000-0000-0000-0000000000a1', 'outgoing', 'receipt', 'failed', 'x@y.test', 'S', 'B')$$,
  '23514', null, 'failed message needs error_text'
);
select throws_ok(
  $$insert into public.messages (request_id, direction, kind, status, from_address, subject, body_text, received_at, gmail_message_id)
    values ('00000000-0000-0000-0000-0000000000a1', 'incoming', 'customer_reply', 'received', 'x@y.test', 'S', 'B', now(), 'g9')$$,
  '23514', null, 'gmail_message_id requires mailbox_key'
);
select throws_ok(
  $$insert into public.messages (request_id, direction, kind, status, from_address, subject, body_text, received_at, mailbox_key, gmail_message_id)
    values ('00000000-0000-0000-0000-0000000000a2', 'incoming', 'customer_reply', 'received', 'x@y.test', 'S', 'B', now(), 'service', 'g1')$$,
  '23505', null, '(mailbox_key, gmail_message_id) is unique'
);
select lives_ok(
  $$insert into public.messages (request_id, direction, kind, status, from_address, subject, body_text, received_at, mailbox_key, gmail_message_id)
    values ('00000000-0000-0000-0000-0000000000a2', 'incoming', 'customer_reply', 'received', 'x@y.test', 'S', 'B', now(), 'billing', 'g1')$$,
  'same Gmail ID allowed in another mailbox'
);

-- automation_runs
select lives_ok(
  $$insert into public.automation_runs (request_id, operation_key, step, status, decision, confidence, finished_at)
    values ('00000000-0000-0000-0000-0000000000a1', 'intake:r1:1', 'intake_analysis', 'succeeded', 'ask_customer', 0.82, now())$$,
  'succeeded run accepted'
);
select throws_ok(
  $$insert into public.automation_runs (request_id, operation_key, step) values ('00000000-0000-0000-0000-0000000000a1', 'intake:r1:1', 'intake_analysis')$$,
  '23505', null, 'operation_key is unique'
);
select throws_ok(
  $$insert into public.automation_runs (request_id, operation_key, step, status) values ('00000000-0000-0000-0000-0000000000a1', 'k2', 'intake_analysis', 'succeeded')$$,
  '23514', null, 'terminal run needs finished_at'
);
select throws_ok(
  $$insert into public.automation_runs (request_id, operation_key, step, confidence) values ('00000000-0000-0000-0000-0000000000a1', 'k3', 'intake_analysis', 1.5)$$,
  '23514', null, 'confidence between 0 and 1'
);
select throws_ok(
  $$insert into public.automation_runs (request_id, operation_key, step, status, decision, finished_at)
    values ('00000000-0000-0000-0000-0000000000a1', 'k4', 'email_matching', 'succeeded', 'ask_customer', now())$$,
  '23514', null, 'decision must match step'
);
select throws_ok(
  $$insert into public.automation_runs (operation_key, step) values ('k5', 'intake_analysis')$$,
  '23514', null, 'only email matching may run without request'
);
select lives_ok(
  $$insert into public.automation_runs (message_id, operation_key, step) values ('00000000-0000-0000-0000-0000000000e2', 'match:e2', 'email_matching')$$,
  'email matching without request accepted'
);

-- attachments
select lives_ok(
  $$insert into public.attachments (request_id, message_id, bucket, storage_path, file_name, mime_type, size_bytes)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', 'dashboard', 'r1/a.pdf', 'a.pdf', 'application/pdf', 100)$$,
  'attachment with consistent parents accepted'
);
select throws_ok(
  $$insert into public.attachments (bucket, storage_path, file_name, mime_type, size_bytes)
    values ('dashboard', 'none.pdf', 'a.pdf', 'application/pdf', 100)$$,
  '23514', null, 'attachment needs a parent'
);
select throws_ok(
  $$insert into public.attachments (request_id, message_id, bucket, storage_path, file_name, mime_type, size_bytes)
    values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e1', 'dashboard', 'r2/b.pdf', 'b.pdf', 'application/pdf', 100)$$,
  '23514', null, 'parents of different requests rejected'
);
select throws_ok(
  $$insert into public.attachments (message_id, bucket, storage_path, file_name, mime_type, size_bytes)
    values ('00000000-0000-0000-0000-0000000000e1', 'dashboard', 'r1/c.pdf', 'c.pdf', 'application/pdf', 100)$$,
  '23514', null, 'attachment of linked message needs request_id'
);
select lives_ok(
  $$insert into public.attachments (message_id, bucket, storage_path, file_name, mime_type, size_bytes)
    values ('00000000-0000-0000-0000-0000000000e2', 'dashboard', 'inbox/d.pdf', 'd.pdf', 'application/pdf', 100)$$,
  'attachment of unmatched message with only message_id accepted'
);
select throws_ok(
  $$insert into public.attachments (request_id, bucket, storage_path, file_name, mime_type, size_bytes)
    values ('00000000-0000-0000-0000-0000000000a1', 'dashboard', 'r1/a.pdf', 'x.pdf', 'application/pdf', 100)$$,
  '23505', null, '(bucket, storage_path) is unique'
);

select * from finish();
rollback;
