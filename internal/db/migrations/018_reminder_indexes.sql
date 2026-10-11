-- The every-minute reminder check looks up runbook steps starting soon and
-- open daily tasks ending around today; without these it scans every step
-- and every daily task each minute.
CREATE INDEX runbook_steps_reminder_idx ON runbook_steps (start_at) WHERE task_id IS NULL AND NOT done;
CREATE INDEX tasks_open_daily_end_idx ON tasks (end_at) WHERE type = 'daily' AND status <> 'done';
