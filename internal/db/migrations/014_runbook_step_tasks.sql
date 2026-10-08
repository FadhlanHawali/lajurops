-- A runbook step can be tracked as its own (daily) task, e.g. preparation
-- done the day before an hourly release. The step then follows that task:
-- its title, date and done state come from the task. Deleting the task
-- turns the step back into a plain checklist item.
ALTER TABLE runbook_steps ADD COLUMN task_id uuid REFERENCES tasks(id) ON DELETE SET NULL;
CREATE INDEX runbook_steps_task_idx ON runbook_steps (task_id) WHERE task_id IS NOT NULL;
