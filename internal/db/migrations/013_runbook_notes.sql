-- IF NOT EXISTS: some databases ran this earlier as 012_runbook_notes.sql.
-- Markdown notes on runbook sections and steps (commands, links, details).
ALTER TABLE runbook_sections ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 20000);
ALTER TABLE runbook_steps ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 20000);
