-- Enum types for the whole dashboard schema (spec sections 5 and 6).
-- Created up front so later migrations only add tables that reference them.

-- Roles and master data
create type public.employee_role as enum ('admin', 'manager', 'dispatcher', 'technician');
create type public.service_kind as enum ('inspection', 'scheduled_maintenance', 'diagnosis_repair');
create type public.billing_model as enum ('fixed', 'hourly');
create type public.availability_kind as enum ('working_hours', 'absence');

-- Requests
create type public.equipment_kind as enum ('pump', 'compressor', 'ventilation', 'other');
create type public.customer_urgency as enum ('planbar', 'zeitnah', 'erheblich', 'production_stop');
create type public.request_priority as enum ('low', 'normal', 'high', 'critical');
create type public.safety_risk as enum ('none_known', 'known', 'unclear');
create type public.intake_status as enum (
  'new', 'analyzing', 'needs_review', 'awaiting_customer', 'processed', 'rejected', 'cancelled'
);
create type public.work_status as enum (
  'not_planned', 'scheduled', 'in_progress', 'waiting_parts', 'completed', 'cancelled'
);
create type public.intake_mode as enum ('automatic', 'manual', 'human_review');

-- Messages
create type public.message_direction as enum ('incoming', 'outgoing');
create type public.message_kind as enum ('receipt', 'clarification', 'customer_reply', 'invoice', 'other');
create type public.message_status as enum ('draft', 'queued', 'sent', 'received', 'failed');

-- Visits and work entries
create type public.visit_status as enum ('scheduled', 'in_progress', 'waiting_parts', 'completed', 'cancelled');
create type public.work_entry_kind as enum ('labor', 'part', 'fixed_service');
create type public.work_item_status as enum ('planned', 'ordered', 'performed', 'used', 'cancelled');
create type public.work_unit as enum ('hour', 'piece', 'service');

-- Invoices
create type public.invoice_status as enum ('draft', 'issued', 'sent', 'paid');

-- Attachments and audit events
create type public.visibility_level as enum ('operational', 'dispatch', 'management');
create type public.actor_type as enum ('user', 'automation', 'system');

-- Automation runs
create type public.automation_step as enum ('intake_analysis', 'reply_analysis', 'email_matching', 'email_send');
create type public.automation_status as enum ('running', 'succeeded', 'failed');
create type public.automation_decision as enum (
  'ready_for_planning', 'ask_customer', 'human_review', 'matched', 'unmatched', 'sent'
);
