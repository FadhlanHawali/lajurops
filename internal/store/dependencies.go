package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// AddDependency records that taskID waits for dependsOnID. Both must be daily
// or hourly tasks in the same workspace, and the link must not create a cycle.
func (s *Store) AddDependency(ctx context.Context, taskID, dependsOnID string) error {
	if taskID == dependsOnID {
		return invalid("a task cannot wait for itself")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	type info struct{ typ, workspace string }
	load := func(id string) (info, error) {
		var i info
		err := tx.QueryRow(ctx, `SELECT type, workspace_id::text FROM tasks WHERE id = $1`, id).Scan(&i.typ, &i.workspace)
		if errors.Is(err, pgx.ErrNoRows) {
			return i, ErrNotFound
		}
		return i, mapConstraintErr(err)
	}
	a, err := load(taskID)
	if err != nil {
		return err
	}
	b, err := load(dependsOnID)
	if errors.Is(err, ErrNotFound) {
		return invalid("the task to wait for does not exist")
	} else if err != nil {
		return err
	}
	if a.typ == "project" || b.typ == "project" {
		return invalid("dependencies are between daily and hourly tasks, not projects")
	}
	if a.workspace != b.workspace {
		return invalid("both tasks must be in the same workspace")
	}

	// Serialize dependency edits per workspace so two concurrent inserts
	// cannot together form a cycle.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "deps:"+a.workspace); err != nil {
		return err
	}
	var cycle bool
	err = tx.QueryRow(ctx, `
		WITH RECURSIVE chain(id) AS (
			SELECT depends_on_id FROM task_dependencies WHERE task_id = $2
			UNION
			SELECT d.depends_on_id FROM task_dependencies d JOIN chain c ON d.task_id = c.id
		)
		SELECT EXISTS (SELECT 1 FROM chain WHERE id = $1)`, taskID, dependsOnID).Scan(&cycle)
	if err != nil {
		return err
	}
	if cycle {
		return invalid("that would create a loop: the other task already (indirectly) waits for this one")
	}

	if _, err := tx.Exec(ctx, `INSERT INTO task_dependencies (task_id, depends_on_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, taskID, dependsOnID); err != nil {
		return mapConstraintErr(err)
	}
	return tx.Commit(ctx)
}

func (s *Store) RemoveDependency(ctx context.Context, taskID, dependsOnID string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM task_dependencies WHERE task_id = $1 AND depends_on_id = $2`, taskID, dependsOnID)
	if err != nil {
		return mapConstraintErr(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// WaitingFor lists the tasks taskID waits for; Blocking lists the tasks that
// wait for taskID.
func (s *Store) WaitingFor(ctx context.Context, taskID string) ([]Task, error) {
	return s.queryTasks(ctx, `SELECT `+taskCols+taskFrom+`
		WHERE t.id IN (SELECT depends_on_id FROM task_dependencies WHERE task_id = $1)
		ORDER BY t.start_at NULLS LAST, t.number`, taskID)
}

func (s *Store) Blocking(ctx context.Context, taskID string) ([]Task, error) {
	return s.queryTasks(ctx, `SELECT `+taskCols+taskFrom+`
		WHERE t.id IN (SELECT task_id FROM task_dependencies WHERE depends_on_id = $1)
		ORDER BY t.start_at NULLS LAST, t.number`, taskID)
}

func (s *Store) queryTasks(ctx context.Context, q string, args ...any) ([]Task, error) {
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, mapConstraintErr(err)
	}
	defer rows.Close()
	out := []Task{}
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
