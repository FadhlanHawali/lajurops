-- Environments a project goes through (Dev, UAT, Pilot, Production, ...).
-- Daily/hourly tasks in the project say which environment they touch.
CREATE TABLE project_environments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
    color       text NOT NULL DEFAULT 'slate',
    position    integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX project_environments_name_idx ON project_environments (project_id, lower(name));

ALTER TABLE tasks ADD COLUMN environment_id uuid REFERENCES project_environments(id) ON DELETE SET NULL;
CREATE INDEX tasks_environment_idx ON tasks (environment_id);
