-- Tasks can have several owners.
CREATE TABLE task_assignees (
    task_id      uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, user_id)
);
CREATE INDEX task_assignees_user_idx ON task_assignees (user_id);

INSERT INTO task_assignees (task_id, user_id)
SELECT id, assignee_id FROM tasks WHERE assignee_id IS NOT NULL;

DROP INDEX tasks_assignee_idx;
ALTER TABLE tasks DROP COLUMN assignee_id;

-- task_id waits for depends_on_id (e.g. "Create VM" waits for "Create IP").
CREATE TABLE task_dependencies (
    task_id        uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_id  uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, depends_on_id),
    CHECK (task_id <> depends_on_id)
);
CREATE INDEX task_dependencies_depends_on_idx ON task_dependencies (depends_on_id);
