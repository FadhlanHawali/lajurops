package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type Task struct {
	ID            string     `json:"id"`
	ProjectID     string     `json:"project_id"`
	ProjectKey    string     `json:"project_key"`
	ParentID      *string    `json:"parent_id"`
	Number        int        `json:"number"`
	Key           string     `json:"key"`
	Title         string     `json:"title"`
	Description   string     `json:"description"`
	Type          string     `json:"type"`
	Status        string     `json:"status"`
	Priority      string     `json:"priority"`
	AssigneeID    *string    `json:"assignee_id"`
	ReporterID    *string    `json:"reporter_id"`
	StartAt       *time.Time `json:"start_at"`
	EndAt         *time.Time `json:"end_at"`
	EstimateHours *float64   `json:"estimate_hours"`
	ActualHours   *float64   `json:"actual_hours"`
	Progress      int        `json:"progress"`
	Position      float64    `json:"position"`
	CompletedAt   *time.Time `json:"completed_at"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	SubtaskCount  int        `json:"subtask_count"`
	SubtaskDone   int        `json:"subtask_done"`
}

type TaskInput struct {
	ProjectID     string     `json:"project_id"`
	ParentID      *string    `json:"parent_id"`
	Title         string     `json:"title"`
	Description   string     `json:"description"`
	Type          string     `json:"type"`
	Status        string     `json:"status"`
	Priority      string     `json:"priority"`
	AssigneeID    *string    `json:"assignee_id"`
	StartAt       *time.Time `json:"start_at"`
	EndAt         *time.Time `json:"end_at"`
	EstimateHours *float64   `json:"estimate_hours"`
	ActualHours   *float64   `json:"actual_hours"`
	Progress      int        `json:"progress"`
}

type TaskFilter struct {
	ProjectID  string
	AssigneeID string
	ParentID   string
	TopLevel   bool
	Type       string
	// From/To select tasks whose schedule overlaps [From, To).
	From, To *time.Time
}

var (
	taskTypes     = set("hourly", "daily")
	taskStatuses  = set("todo", "in_progress", "in_review", "done")
	taskPriorites = set("low", "medium", "high", "urgent")
)

const taskCols = `t.id::text, t.project_id::text, p.key, t.parent_id::text, t.number,
	t.title, t.description, t.type, t.status, t.priority,
	t.assignee_id::text, t.reporter_id::text, t.start_at, t.end_at,
	t.estimate_hours::float8, t.actual_hours::float8, t.progress, t.position,
	t.completed_at, t.created_at, t.updated_at,
	(SELECT count(*) FROM tasks s WHERE s.parent_id = t.id),
	(SELECT count(*) FROM tasks s WHERE s.parent_id = t.id AND s.status = 'done')`

const taskFrom = ` FROM tasks t JOIN projects p ON p.id = t.project_id`

func scanTask(row pgx.Row) (Task, error) {
	var t Task
	err := row.Scan(&t.ID, &t.ProjectID, &t.ProjectKey, &t.ParentID, &t.Number,
		&t.Title, &t.Description, &t.Type, &t.Status, &t.Priority,
		&t.AssigneeID, &t.ReporterID, &t.StartAt, &t.EndAt,
		&t.EstimateHours, &t.ActualHours, &t.Progress, &t.Position,
		&t.CompletedAt, &t.CreatedAt, &t.UpdatedAt, &t.SubtaskCount, &t.SubtaskDone)
	if errors.Is(err, pgx.ErrNoRows) {
		return t, ErrNotFound
	}
	t.Key = fmt.Sprintf("%s-%d", t.ProjectKey, t.Number)
	return t, err
}

func (s *Store) ListTasks(ctx context.Context, f TaskFilter) ([]Task, error) {
	var where []string
	var args []any
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, fmt.Sprintf(cond, len(args)))
	}
	if f.ProjectID != "" {
		add("t.project_id = $%d", f.ProjectID)
	}
	if f.AssigneeID != "" {
		add("t.assignee_id = $%d", f.AssigneeID)
	}
	if f.ParentID != "" {
		add("t.parent_id = $%d", f.ParentID)
	}
	if f.TopLevel {
		where = append(where, "t.parent_id IS NULL")
	}
	if f.Type != "" {
		add("t.type = $%d", f.Type)
	}
	if f.To != nil {
		add("t.start_at < $%d", *f.To)
	}
	if f.From != nil {
		add("coalesce(t.end_at, t.start_at) >= $%d", *f.From)
	}

	q := `SELECT ` + taskCols + taskFrom
	if len(where) > 0 {
		q += " WHERE " + strings.Join(where, " AND ")
	}
	q += " ORDER BY t.position, t.number"

	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
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

func (s *Store) GetTask(ctx context.Context, id string) (Task, error) {
	return scanTask(s.db.QueryRow(ctx, `SELECT `+taskCols+taskFrom+` WHERE t.id = $1`, id))
}

func (s *Store) CreateTask(ctx context.Context, in TaskInput, reporterID string) (Task, error) {
	in.Title = strings.TrimSpace(in.Title)
	in.Type = orDefault(in.Type, "daily")
	in.Status = orDefault(in.Status, "todo")
	in.Priority = orDefault(in.Priority, "medium")
	switch {
	case in.Title == "":
		return Task{}, invalid("title is required")
	case !taskTypes[in.Type]:
		return Task{}, invalid("type must be hourly or daily")
	case !taskStatuses[in.Status]:
		return Task{}, invalid("invalid status")
	case !taskPriorites[in.Priority]:
		return Task{}, invalid("invalid priority")
	case in.Progress < 0 || in.Progress > 100:
		return Task{}, invalid("progress must be between 0 and 100")
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Task{}, err
	}
	defer tx.Rollback(ctx)

	// Subtasks live in their parent's project, and only one level deep (like Jira).
	if in.ParentID != nil && *in.ParentID != "" {
		var parentProject string
		var grandParent *string
		err := tx.QueryRow(ctx, `SELECT project_id::text, parent_id::text FROM tasks WHERE id = $1`, *in.ParentID).
			Scan(&parentProject, &grandParent)
		if errors.Is(err, pgx.ErrNoRows) {
			return Task{}, invalid("parent task not found")
		} else if err != nil {
			return Task{}, err
		}
		if grandParent != nil {
			return Task{}, invalid("subtasks cannot have their own subtasks")
		}
		in.ProjectID = parentProject
	} else {
		in.ParentID = nil
	}
	if in.ProjectID == "" {
		return Task{}, invalid("project_id is required")
	}

	var number int
	err = tx.QueryRow(ctx, `UPDATE projects SET task_seq = task_seq + 1 WHERE id = $1 RETURNING task_seq`, in.ProjectID).Scan(&number)
	if errors.Is(err, pgx.ErrNoRows) {
		return Task{}, invalid("project not found")
	} else if err != nil {
		return Task{}, err
	}

	var id string
	err = tx.QueryRow(ctx, `
		INSERT INTO tasks (project_id, parent_id, number, title, description, type, status, priority,
		                   assignee_id, reporter_id, start_at, end_at, estimate_hours, actual_hours, progress,
		                   position, completed_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
		        (SELECT coalesce(max(position), 0) + 1 FROM tasks WHERE project_id = $1 AND status = $7),
		        CASE WHEN $7 = 'done' THEN now() END)
		RETURNING id::text`,
		in.ProjectID, in.ParentID, number, in.Title, in.Description, in.Type, in.Status, in.Priority,
		emptyToNil(in.AssigneeID), nullString(reporterID), in.StartAt, in.EndAt, in.EstimateHours, in.ActualHours, in.Progress,
	).Scan(&id)
	if err != nil {
		return Task{}, mapConstraintErr(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Task{}, err
	}
	return s.GetTask(ctx, id)
}

// UpdateTask applies a partial update. Only keys present in patch are changed;
// a JSON null clears nullable fields.
func (s *Store) UpdateTask(ctx context.Context, id string, patch map[string]json.RawMessage) (Task, error) {
	var sets []string
	var args []any
	set := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, fmt.Sprintf("%s = $%d", col, len(args)))
	}

	for k, raw := range patch {
		switch k {
		case "title":
			var v string
			if err := json.Unmarshal(raw, &v); err != nil || strings.TrimSpace(v) == "" {
				return Task{}, invalid("title is required")
			}
			set("title", strings.TrimSpace(v))
		case "description":
			var v string
			if err := json.Unmarshal(raw, &v); err != nil {
				return Task{}, invalid("description must be a string")
			}
			set("description", v)
		case "type", "priority":
			var v string
			valid := taskTypes
			if k == "priority" {
				valid = taskPriorites
			}
			if err := json.Unmarshal(raw, &v); err != nil || !valid[v] {
				return Task{}, invalid("invalid " + k)
			}
			set(k, v)
		case "status":
			var v string
			if err := json.Unmarshal(raw, &v); err != nil || !taskStatuses[v] {
				return Task{}, invalid("invalid status")
			}
			set("status", v)
			sets = append(sets, fmt.Sprintf("completed_at = CASE WHEN $%d = 'done' THEN coalesce(completed_at, now()) END", len(args)))
		case "assignee_id":
			var v *string
			if err := json.Unmarshal(raw, &v); err != nil {
				return Task{}, invalid("assignee_id must be a string or null")
			}
			set("assignee_id", emptyToNil(v))
		case "start_at", "end_at":
			var v *time.Time
			if err := json.Unmarshal(raw, &v); err != nil {
				return Task{}, invalid(k + " must be an RFC 3339 timestamp or null")
			}
			set(k, v)
		case "estimate_hours", "actual_hours":
			var v *float64
			if err := json.Unmarshal(raw, &v); err != nil || (v != nil && *v < 0) {
				return Task{}, invalid(k + " must be a non-negative number or null")
			}
			set(k, v)
		case "progress":
			var v int
			if err := json.Unmarshal(raw, &v); err != nil || v < 0 || v > 100 {
				return Task{}, invalid("progress must be between 0 and 100")
			}
			set("progress", v)
		case "position":
			var v float64
			if err := json.Unmarshal(raw, &v); err != nil {
				return Task{}, invalid("position must be a number")
			}
			set("position", v)
		default:
			return Task{}, invalid("field " + k + " cannot be updated")
		}
	}
	if len(sets) == 0 {
		return s.GetTask(ctx, id)
	}

	args = append(args, id)
	q := fmt.Sprintf(`UPDATE tasks SET %s, updated_at = now() WHERE id = $%d`, strings.Join(sets, ", "), len(args))
	tag, err := s.db.Exec(ctx, q, args...)
	if err != nil {
		return Task{}, mapConstraintErr(err)
	}
	if tag.RowsAffected() == 0 {
		return Task{}, ErrNotFound
	}
	return s.GetTask(ctx, id)
}

func (s *Store) DeleteTask(ctx context.Context, id string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM tasks WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func mapConstraintErr(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23514": // check_violation
			return invalid("end must not be before start")
		case "23503": // foreign_key_violation
			return invalid("referenced user or task does not exist")
		case "22P02": // invalid_text_representation (bad uuid)
			return invalid("malformed id")
		}
	}
	return err
}

func set(vals ...string) map[string]bool {
	m := make(map[string]bool, len(vals))
	for _, v := range vals {
		m[v] = true
	}
	return m
}

func orDefault(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

func emptyToNil(s *string) *string {
	if s == nil || *s == "" {
		return nil
	}
	return s
}
