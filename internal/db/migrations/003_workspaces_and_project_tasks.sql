-- The top-level container is now called a workspace, and "project" becomes a
-- task type: project > daily > hourly (a child is always a smaller type).
ALTER TABLE projects RENAME TO workspaces;
ALTER TABLE workspaces RENAME CONSTRAINT projects_key_check TO workspaces_key_check;
ALTER TABLE tasks RENAME COLUMN project_id TO workspace_id;
ALTER INDEX tasks_project_idx RENAME TO tasks_workspace_idx;

ALTER TABLE tasks DROP CONSTRAINT tasks_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_type_check CHECK (type IN ('project', 'daily', 'hourly'));
