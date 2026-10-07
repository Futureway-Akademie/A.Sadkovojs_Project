-- Demo baseline of manual initial processing: 15 minutes (user decision, see docs/decisions.md).
-- Existing snapshots stay unchanged; only later completions use the new value.

alter table public.settings alter column manual_intake_minutes set default 15;

-- Adjust the singleton only if it still holds the untouched initial value
update public.settings set manual_intake_minutes = 15
where id = 1 and manual_intake_minutes = 5 and updated_by is null;
