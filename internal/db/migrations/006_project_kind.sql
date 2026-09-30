-- Projects are either long (a quarter or more) or short (short notice, about
-- a month). Only project tasks have a kind.
ALTER TABLE tasks ADD COLUMN project_kind text CHECK (project_kind IN ('long', 'short'));

-- Classify existing projects by their timeline: 90+ days is long.
UPDATE tasks
   SET project_kind = CASE WHEN end_at - start_at >= interval '90 days' THEN 'long' ELSE 'short' END
 WHERE type = 'project';

ALTER TABLE tasks ADD CONSTRAINT tasks_project_kind_matches_type
    CHECK ((type = 'project') = (project_kind IS NOT NULL));
