-- Markdown notes on runbook sections and steps (commands, links, details).
ALTER TABLE runbook_sections ADD COLUMN notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 20000);
ALTER TABLE runbook_steps ADD COLUMN notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 20000);
