CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    keycloak_sub  text NOT NULL UNIQUE,
    username      text NOT NULL,
    email         text NOT NULL DEFAULT '',
    display_name  text NOT NULL DEFAULT '',
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key          text NOT NULL UNIQUE CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
    name         text NOT NULL,
    description  text NOT NULL DEFAULT '',
    task_seq     integer NOT NULL DEFAULT 0,
    created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- A task is either "hourly" (support / deployment / implementation work
-- scheduled with exact start and end times) or "daily" (requests and
-- deliverables scheduled by date). Subtasks are tasks with parent_id set.
CREATE TABLE tasks (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_id       uuid REFERENCES tasks(id) ON DELETE CASCADE,
    number          integer NOT NULL,
    title           text NOT NULL,
    description     text NOT NULL DEFAULT '',
    type            text NOT NULL DEFAULT 'daily' CHECK (type IN ('hourly', 'daily')),
    status          text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'in_review', 'done')),
    priority        text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    assignee_id     uuid REFERENCES users(id) ON DELETE SET NULL,
    reporter_id     uuid REFERENCES users(id) ON DELETE SET NULL,
    start_at        timestamptz,
    end_at          timestamptz,
    estimate_hours  numeric(8,2),
    actual_hours    numeric(8,2),
    progress        integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    position        double precision NOT NULL DEFAULT 0,
    completed_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, number),
    CHECK (end_at IS NULL OR start_at IS NULL OR end_at >= start_at)
);

CREATE INDEX tasks_project_idx  ON tasks (project_id);
CREATE INDEX tasks_parent_idx   ON tasks (parent_id);
CREATE INDEX tasks_assignee_idx ON tasks (assignee_id, start_at);
CREATE INDEX tasks_schedule_idx ON tasks (start_at, end_at);
