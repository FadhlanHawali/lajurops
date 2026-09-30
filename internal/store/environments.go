package store

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Environment is a stage a project's work is done in, e.g. "UAT".
type Environment struct {
	ID        string `json:"id"`
	ProjectID string `json:"project_id"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	Position  int    `json:"position"`
	TaskCount int    `json:"task_count"`
}

type EnvironmentInput struct {
	ID    string `json:"id"` // empty for new environments
	Name  string `json:"name"`
	Color string `json:"color"`
}

const maxEnvironments = 12

var envColors = set("slate", "green", "blue", "amber", "violet", "red", "teal", "pink")

func (s *Store) ListEnvironments(ctx context.Context, projectID string) ([]Environment, error) {
	rows, err := s.db.Query(ctx, `
		SELECT e.id::text, e.project_id::text, e.name, e.color, e.position,
		       (SELECT count(*) FROM tasks t WHERE t.environment_id = e.id)
		FROM project_environments e
		WHERE e.project_id = $1
		ORDER BY e.position, e.created_at`, projectID)
	if err != nil {
		return nil, mapConstraintErr(err)
	}
	defer rows.Close()
	out := []Environment{}
	for rows.Next() {
		var e Environment
		if err := rows.Scan(&e.ID, &e.ProjectID, &e.Name, &e.Color, &e.Position, &e.TaskCount); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// SetEnvironments replaces a project's environment list: listed ids are
// renamed/reordered, new entries are created, and missing ones are deleted
// (their tasks keep existing but lose the environment).
func (s *Store) SetEnvironments(ctx context.Context, projectID string, in []EnvironmentInput) ([]Environment, error) {
	if len(in) > maxEnvironments {
		return nil, invalid("a project can have at most 12 environments")
	}
	seen := map[string]bool{}
	keep := []string{}
	for i := range in {
		in[i].Name = strings.TrimSpace(in[i].Name)
		n := strings.ToLower(in[i].Name)
		switch {
		case n == "":
			return nil, invalid("environment names cannot be empty")
		case len(in[i].Name) > 40:
			return nil, invalid("environment names can be at most 40 characters")
		case seen[n]:
			return nil, invalid(`environment "` + in[i].Name + `" is listed twice`)
		}
		seen[n] = true
		if in[i].Color == "" {
			in[i].Color = "slate"
		}
		if !envColors[in[i].Color] {
			return nil, invalid("unknown environment colour " + in[i].Color)
		}
		if in[i].ID != "" {
			keep = append(keep, in[i].ID)
		}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var typ string
	err = tx.QueryRow(ctx, `SELECT type FROM tasks WHERE id = $1 FOR UPDATE`, projectID).Scan(&typ)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, mapConstraintErr(err)
	}
	if typ != "project" {
		return nil, invalid("only projects have environments")
	}

	if _, err := tx.Exec(ctx, `DELETE FROM project_environments WHERE project_id = $1 AND NOT (id::text = ANY($2))`, projectID, keep); err != nil {
		return nil, err
	}
	// Park kept names first so swaps like Dev<->UAT don't trip the unique index.
	if _, err := tx.Exec(ctx, `UPDATE project_environments SET name = id::text WHERE project_id = $1`, projectID); err != nil {
		return nil, err
	}
	for i, e := range in {
		if e.ID != "" {
			tag, err := tx.Exec(ctx, `UPDATE project_environments SET name = $3, color = $4, position = $5 WHERE id = $1 AND project_id = $2`,
				e.ID, projectID, e.Name, e.Color, i)
			if err != nil {
				return nil, mapConstraintErr(err)
			}
			if tag.RowsAffected() == 0 {
				return nil, invalid("environment " + e.ID + " does not belong to this project")
			}
		} else if _, err := tx.Exec(ctx, `INSERT INTO project_environments (project_id, name, color, position) VALUES ($1, $2, $3, $4)`,
			projectID, e.Name, e.Color, i); err != nil {
			return nil, mapConstraintErr(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.ListEnvironments(ctx, projectID)
}

// rootProject returns the project a task (identified by its parent) sits
// under, or "" for independent tasks.
func rootProject(ctx context.Context, tx pgx.Tx, parentID *string) (string, error) {
	if parentID == nil || *parentID == "" {
		return "", nil
	}
	var id string
	err := tx.QueryRow(ctx, `
		WITH RECURSIVE up(id, parent_id, type, depth) AS (
			SELECT id, parent_id, type, 0 FROM tasks WHERE id = $1
			UNION ALL
			SELECT t.id, t.parent_id, t.type, up.depth + 1 FROM tasks t JOIN up ON t.id = up.parent_id WHERE up.depth < 5
		)
		SELECT id::text FROM up WHERE type = 'project' LIMIT 1`, *parentID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, mapConstraintErr(err)
}

// checkEnvironment verifies envID belongs to the project the task sits under.
func checkEnvironment(ctx context.Context, tx pgx.Tx, taskType string, parentID *string, envID string) error {
	if taskType == "project" {
		return invalid("projects don't have an environment; their daily and hourly tasks do")
	}
	root, err := rootProject(ctx, tx, parentID)
	if err != nil {
		return err
	}
	if root == "" {
		return invalid("link the task to a project first; environments come from its project")
	}
	var owner string
	err = tx.QueryRow(ctx, `SELECT project_id::text FROM project_environments WHERE id = $1`, envID).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return invalid("environment not found")
	} else if err != nil {
		return mapConstraintErr(err)
	}
	if owner != root {
		return invalid("that environment belongs to a different project")
	}
	return nil
}
