-- Projects are grouped by purpose (KPI, Enhancement, Ad Hoc, ... customisable
-- per workspace) instead of by status: a project's status and progress are
-- now derived from the tasks inside it.
CREATE TABLE project_categories (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
    color         text NOT NULL DEFAULT 'slate',
    position      integer NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX project_categories_name_idx ON project_categories (workspace_id, lower(name));

ALTER TABLE tasks ADD COLUMN project_category_id uuid REFERENCES project_categories(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD CONSTRAINT tasks_category_only_projects CHECK (project_category_id IS NULL OR type = 'project');

INSERT INTO project_categories (workspace_id, name, color, position)
SELECT w.id, d.name, d.color, d.position
FROM workspaces w
CROSS JOIN (VALUES ('KPI Project', 'violet', 0), ('Enhancement Project', 'blue', 1), ('Ad Hoc Project', 'amber', 2)) AS d(name, color, position);

-- Derive existing projects' status/progress from their tasks.
WITH p AS (SELECT id FROM tasks WHERE type = 'project'),
d AS (
    SELECT p.id AS pid, c.status FROM p JOIN tasks c ON c.parent_id = p.id
    UNION ALL
    SELECT p.id, g.status FROM p JOIN tasks c ON c.parent_id = p.id JOIN tasks g ON g.parent_id = c.id
),
s AS (
    SELECT p.id AS pid,
           count(d.status) AS total,
           count(*) FILTER (WHERE d.status = 'done') AS done,
           count(*) FILTER (WHERE d.status IN ('in_progress', 'in_review', 'done')) AS started
    FROM p LEFT JOIN d ON d.pid = p.id GROUP BY p.id
)
UPDATE tasks t
   SET status = CASE WHEN s.total > 0 AND s.done = s.total THEN 'done'
                     WHEN s.started > 0 THEN 'in_progress' ELSE 'todo' END,
       progress = CASE WHEN s.total = 0 THEN 0 ELSE round(100.0 * s.done / s.total)::int END,
       completed_at = CASE WHEN s.total > 0 AND s.done = s.total THEN coalesce(t.completed_at, now()) END
  FROM s WHERE t.id = s.pid;
