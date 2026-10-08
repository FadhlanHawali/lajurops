-- Runbook step counts are stored on the task, so task lists don't count
-- steps per row (that took ~45% of listing a big workspace). Triggers keep
-- them current: steps added, changed or removed, sections removed, and a
-- step's linked daily task changing status (it is done when that task is).
ALTER TABLE tasks
    ADD COLUMN runbook_total integer NOT NULL DEFAULT 0,
    ADD COLUMN runbook_done  integer NOT NULL DEFAULT 0;

-- Recounts the runbooks of the given tasks (only rows whose counts change).
CREATE FUNCTION runbook_recount(ids uuid[]) RETURNS void LANGUAGE sql AS $$
    UPDATE tasks t SET runbook_total = c.total, runbook_done = c.done
    FROM (
        SELECT x.id, count(rs.id) AS total,
               count(rs.id) FILTER (WHERE CASE WHEN rs.task_id IS NULL THEN rs.done ELSE lt.status = 'done' END) AS done
        FROM unnest(ids) AS x(id)
        LEFT JOIN runbook_sections sec ON sec.task_id = x.id
        LEFT JOIN runbook_steps rs ON rs.section_id = sec.id
        LEFT JOIN tasks lt ON lt.id = rs.task_id
        GROUP BY x.id
    ) c
    WHERE t.id = c.id AND (t.runbook_total, t.runbook_done) IS DISTINCT FROM (c.total, c.done);
$$;

-- Statement-level triggers (one recount per statement, not per row).
CREATE FUNCTION runbook_steps_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids uuid[];
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT array_agg(DISTINCT sec.task_id) INTO ids FROM new_rows n JOIN runbook_sections sec ON sec.id = n.section_id;
    ELSIF TG_OP = 'UPDATE' THEN
        SELECT array_agg(DISTINCT sec.task_id) INTO ids
        FROM (SELECT section_id FROM new_rows UNION SELECT section_id FROM old_rows) s JOIN runbook_sections sec ON sec.id = s.section_id;
    ELSE
        -- Steps removed with their section are recounted by the section trigger.
        SELECT array_agg(DISTINCT sec.task_id) INTO ids FROM old_rows o JOIN runbook_sections sec ON sec.id = o.section_id;
    END IF;
    IF ids IS NOT NULL THEN
        PERFORM runbook_recount(ids);
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER runbook_steps_inserted AFTER INSERT ON runbook_steps
    REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION runbook_steps_changed();
CREATE TRIGGER runbook_steps_updated AFTER UPDATE ON runbook_steps
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION runbook_steps_changed();
CREATE TRIGGER runbook_steps_deleted AFTER DELETE ON runbook_steps
    REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION runbook_steps_changed();

CREATE FUNCTION runbook_sections_deleted() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids uuid[];
BEGIN
    SELECT array_agg(DISTINCT task_id) INTO ids FROM old_rows;
    IF ids IS NOT NULL THEN
        PERFORM runbook_recount(ids);
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER runbook_sections_deleted AFTER DELETE ON runbook_sections
    REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION runbook_sections_deleted();

-- A linked daily task changing status changes its step's done state. The
-- recount itself updates tasks, so nested calls (and statements that
-- changed no status) return at once.
CREATE FUNCTION runbook_linked_status_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids uuid[];
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN NULL;
    END IF;
    SELECT array_agg(DISTINCT sec.task_id) INTO ids
    FROM new_rows n JOIN old_rows o ON o.id = n.id AND o.status IS DISTINCT FROM n.status
    JOIN runbook_steps rs ON rs.task_id = n.id
    JOIN runbook_sections sec ON sec.id = rs.section_id;
    IF ids IS NOT NULL THEN
        PERFORM runbook_recount(ids);
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER runbook_linked_status_changed AFTER UPDATE ON tasks
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION runbook_linked_status_changed();

-- Existing runbooks.
SELECT runbook_recount(array_agg(DISTINCT task_id)) FROM runbook_sections;
