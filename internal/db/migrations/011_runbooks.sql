-- Runbooks: a checklist on a task, in sections the team names (Preparation,
-- Implementation, ...). Steps can have a start time and a duration.
CREATE TABLE runbook_sections (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
    position    integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX runbook_sections_task_idx ON runbook_sections (task_id, position);

CREATE TABLE runbook_steps (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    section_id        uuid NOT NULL REFERENCES runbook_sections(id) ON DELETE CASCADE,
    title             text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
    start_at          timestamptz,
    duration_minutes  integer CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 10080),
    done              boolean NOT NULL DEFAULT false,
    done_at           timestamptz,
    done_by           uuid REFERENCES users(id) ON DELETE SET NULL,
    position          integer NOT NULL DEFAULT 0,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX runbook_steps_section_idx ON runbook_steps (section_id, position);

-- Reusable runbooks per workspace. Step times are stored relative to the
-- task's start (offset_minutes), so a template fits any date.
CREATE TABLE runbook_templates (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    sections      jsonb NOT NULL,
    created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX runbook_templates_name_idx ON runbook_templates (workspace_id, lower(name));
