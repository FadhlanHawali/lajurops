package store

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Category groups a workspace's projects by purpose (e.g. "KPI Project").
type Category struct {
	ID           string `json:"id"`
	WorkspaceID  string `json:"workspace_id"`
	Name         string `json:"name"`
	Color        string `json:"color"`
	Position     int    `json:"position"`
	ProjectCount int    `json:"project_count"`
}

type CategoryInput struct {
	ID    string `json:"id"` // empty for new categories
	Name  string `json:"name"`
	Color string `json:"color"`
}

// DefaultCategories are created for every new workspace.
var DefaultCategories = []CategoryInput{
	{Name: "KPI Project", Color: "violet"},
	{Name: "Enhancement Project", Color: "blue"},
	{Name: "Ad Hoc Project", Color: "amber"},
}

const maxCategories = 20

type execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

func seedCategories(ctx context.Context, q execer, workspaceID string, list []CategoryInput) error {
	for i, c := range list {
		if _, err := q.Exec(ctx, `INSERT INTO project_categories (workspace_id, name, color, position) VALUES ($1, $2, $3, $4)`,
			workspaceID, c.Name, c.Color, i); err != nil {
			return mapConstraintErr(err)
		}
	}
	return nil
}

func (s *Store) ListCategories(ctx context.Context, workspaceID string) ([]Category, error) {
	rows, err := s.db.Query(ctx, `
		SELECT c.id::text, c.workspace_id::text, c.name, c.color, c.position,
		       (SELECT count(*) FROM tasks t WHERE t.project_category_id = c.id)
		FROM project_categories c WHERE c.workspace_id = $1
		ORDER BY c.position, c.created_at`, workspaceID)
	if err != nil {
		return nil, mapConstraintErr(err)
	}
	defer rows.Close()
	out := []Category{}
	for rows.Next() {
		var c Category
		if err := rows.Scan(&c.ID, &c.WorkspaceID, &c.Name, &c.Color, &c.Position, &c.ProjectCount); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// SetCategories replaces a workspace's category list, like SetEnvironments:
// listed ids are renamed/reordered, new ones created, missing ones deleted
// (their projects become uncategorized).
func (s *Store) SetCategories(ctx context.Context, workspaceID string, in []CategoryInput) ([]Category, error) {
	if len(in) > maxCategories {
		return nil, invalid("a workspace can have at most 20 project categories")
	}
	seen := map[string]bool{}
	keep := []string{}
	for i := range in {
		in[i].Name = strings.TrimSpace(in[i].Name)
		n := strings.ToLower(in[i].Name)
		switch {
		case n == "":
			return nil, invalid("category names cannot be empty")
		case len(in[i].Name) > 40:
			return nil, invalid("category names can be at most 40 characters")
		case seen[n]:
			return nil, invalid(`category "` + in[i].Name + `" is listed twice`)
		}
		seen[n] = true
		if in[i].Color == "" {
			in[i].Color = "slate"
		}
		if !validColor(in[i].Color) {
			return nil, invalid("unknown category colour " + in[i].Color)
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
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM workspaces WHERE id = $1)`, workspaceID).Scan(&exists); err != nil {
		return nil, mapConstraintErr(err)
	}
	if !exists {
		return nil, ErrNotFound
	}
	if _, err := tx.Exec(ctx, `DELETE FROM project_categories WHERE workspace_id = $1 AND NOT (id::text = ANY($2))`, workspaceID, keep); err != nil {
		return nil, err
	}
	// Park names first so swaps don't trip the unique index.
	if _, err := tx.Exec(ctx, `UPDATE project_categories SET name = id::text WHERE workspace_id = $1`, workspaceID); err != nil {
		return nil, err
	}
	for i, c := range in {
		if c.ID != "" {
			tag, err := tx.Exec(ctx, `UPDATE project_categories SET name = $3, color = $4, position = $5 WHERE id = $1 AND workspace_id = $2`,
				c.ID, workspaceID, c.Name, c.Color, i)
			if err != nil {
				return nil, mapConstraintErr(err)
			}
			if tag.RowsAffected() == 0 {
				return nil, invalid("category " + c.ID + " does not belong to this workspace")
			}
		} else if _, err := tx.Exec(ctx, `INSERT INTO project_categories (workspace_id, name, color, position) VALUES ($1, $2, $3, $4)`,
			workspaceID, c.Name, c.Color, i); err != nil {
			return nil, mapConstraintErr(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.ListCategories(ctx, workspaceID)
}

// checkCategory verifies a category can be used by task id (a project in
// the same workspace).
func checkCategory(ctx context.Context, tx pgx.Tx, taskType, workspaceID, categoryID string) error {
	if taskType != "project" {
		return invalid("only projects have a category")
	}
	var ws string
	err := tx.QueryRow(ctx, `SELECT workspace_id::text FROM project_categories WHERE id = $1`, categoryID).Scan(&ws)
	if errors.Is(err, pgx.ErrNoRows) {
		return invalid("category not found")
	} else if err != nil {
		return mapConstraintErr(err)
	}
	if ws != workspaceID {
		return invalid("that category belongs to another workspace")
	}
	return nil
}

// recomputeProjectsSQL derives each listed project's status and progress
// from the daily/hourly tasks inside it (children and grandchildren):
// all done -> done, any started -> in_progress, otherwise todo.
const recomputeProjectsSQL = `
	WITH p AS (SELECT id FROM tasks WHERE type = 'project' AND id::text = ANY($1)),
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
	  FROM s WHERE t.id = s.pid`

func recomputeProjects(ctx context.Context, q execer, ids ...string) error {
	list := ids[:0:0]
	for _, id := range ids {
		if id != "" {
			list = append(list, id)
		}
	}
	if len(list) == 0 {
		return nil
	}
	_, err := q.Exec(ctx, recomputeProjectsSQL, list)
	return err
}
