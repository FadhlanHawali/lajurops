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
	WorkspaceID     string     `json:"workspace_id"`
	WorkspaceKey    string     `json:"workspace_key"`
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
	WorkspaceID     string     `json:"workspace_id"`
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
	WorkspaceID  string
	AssigneeID string
	ParentID   string
	TopLevel   bool
	Types      []string
	// From/To select tasks whose schedule overlaps [From, To).
	From, To *time.Time
}

var (
	taskTypes     = set("project", "daily", "hourly")
	taskStatuses  = set("todo", "in_progress", "in_review", "done")
	taskPriorites = set("low", "medium", "high", "urgent")
)

const taskCols = `t.id::text, t.workspace_id::text, p.key, t.parent_id::text, t.number,
	t.title, t.description, t.type, t.status, t.priority,
	t.assignee_id::text, t.reporter_id::text, t.start_at, t.end_at,
	t.estimate_hours::float8, t.actual_hours::float8, t.progress, t.position,
	t.completed_at, t.created_at, t.updated_at,
	(SELECT count(*) FROM tasks s WHERE s.parent_id = t.id),
	(SELECT count(*) FROM tasks s WHERE s.parent_id = t.id AND s.status = 'done')`

const taskFrom = ` FROM tasks t JOIN workspaces p ON p.id = t.workspace_id`

func scanTask(row pgx.Row) (Task, error) {
	var t Task
	err := row.Scan(&t.ID, &t.WorkspaceID, &t.WorkspaceKey, &t.ParentID, &t.Number,
		&t.Title, &t.Description, &t.Type, &t.Status, &t.Priority,
		&t.AssigneeID, &t.ReporterID, &t.StartAt, &t.EndAt,
		&t.EstimateHours, &t.ActualHours, &t.Progress, &t.Position,
		&t.CompletedAt, &t.CreatedAt, &t.UpdatedAt, &t.SubtaskCount, &t.SubtaskDone)
	if errors.Is(err, pgx.ErrNoRows) {
		return t, ErrNotFound
	}
	t.Key = fmt.Sprintf("%s-%d", t.WorkspaceKey, t.Number)
	return t, err
}

func (s *Store) ListTasks(ctx context.Context, f TaskFilter) ([]Task, error) {
	var where []string
	var args []any
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, fmt.Sprintf(cond, len(args)))
	}
	if f.WorkspaceID != "" {
		add("t.workspace_id = $%d", f.WorkspaceID)
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
	if len(f.Types) > 0 {
		add("t.type = ANY($%d)", f.Types)
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
		return Task{}, invalid("type must be project, daily or hourly")
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

	// Child tasks live in their parent's workspace.
	if in.ParentID != nil && *in.ParentID != "" {
		var parentWorkspace, parentType string
		err := tx.QueryRow(ctx, `SELECT workspace_id::text, type FROM tasks WHERE id = $1`, *in.ParentID).
			Scan(&parentWorkspace, &parentType)
		if errors.Is(err, pgx.ErrNoRows) {
			return Task{}, invalid("parent task not found")
		} else if err != nil {
			return Task{}, mapConstraintErr(err)
		}
		if err := checkNesting(parentType, in.Type); err != nil {
			return Task{}, err
		}
		in.WorkspaceID = parentWorkspace
	} else {
		in.ParentID = nil
	}
	if in.WorkspaceID == "" {
		return Task{}, invalid("workspace_id is required")
	}

	var number int
	err = tx.QueryRow(ctx, `UPDATE workspaces SET task_seq = task_seq + 1 WHERE id = $1 RETURNING task_seq`, in.WorkspaceID).Scan(&number)
	if errors.Is(err, pgx.ErrNoRows) {
		return Task{}, invalid("workspace not found")
	} else if err != nil {
		return Task{}, err
	}

	var id string
	err = tx.QueryRow(ctx, `
		INSERT INTO tasks (workspace_id, parent_id, number, title, description, type, status, priority,
		                   assignee_id, reporter_id, start_at, end_at, estimate_hours, actual_hours, progress,
		                   position, completed_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
		        (SELECT coalesce(max(position), 0) + 1 FROM tasks WHERE workspace_id = $1 AND status = $7),
		        CASE WHEN $7 = 'done' THEN now() END)
		RETURNING id::text`,
		in.WorkspaceID, in.ParentID, number, in.Title, in.Description, in.Type, in.Status, in.Priority,
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
	// Type and parent changes must keep the project > daily > hourly nesting.
	var newType *string
	var newParent **string

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
		case "type":
			var v string
			if err := json.Unmarshal(raw, &v); err != nil || !taskTypes[v] {
				return Task{}, invalid("type must be project, daily or hourly")
			}
			newType = &v
			set("type", v)
		case "parent_id":
			var v *string
			if err := json.Unmarshal(raw, &v); err != nil {
				return Task{}, invalid("parent_id must be a string or null")
			}
			v = emptyToNil(v)
			newParent = &v
			set("parent_id", v)
		case "priority":
			var v string
			if err := json.Unmarshal(raw, &v); err != nil || !taskPriorites[v] {
				return Task{}, invalid("invalid priority")
			}
			set("priority", v)
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

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Task{}, err
	}
	defer tx.Rollback(ctx)

	if newType != nil || newParent != nil {
		if err := validateMove(ctx, tx, id, newType, newParent); err != nil {
			return Task{}, err
		}
	}

	args = append(args, id)
	q := fmt.Sprintf(`UPDATE tasks SET %s, updated_at = now() WHERE id = $%d`, strings.Join(sets, ", "), len(args))
	tag, err := tx.Exec(ctx, q, args...)
	if err != nil {
		return Task{}, mapConstraintErr(err)
	}
	if tag.RowsAffected() == 0 {
		return Task{}, ErrNotFound
	}
	if err := tx.Commit(ctx); err != nil {
		return Task{}, err
	}
	return s.GetTask(ctx, id)
}

// typeRank orders task types; a child must rank strictly below its parent.
var typeRank = map[string]int{"project": 3, "daily": 2, "hourly": 1}

// nestingRule explains what each type may contain.
var nestingRule = map[string]string{
	"project": "a project can contain daily and hourly tasks",
	"daily":   "a daily task can only contain hourly tasks",
	"hourly":  "hourly tasks cannot contain other tasks",
}

func checkNesting(parentType, childType string) error {
	if typeRank[childType] >= typeRank[parentType] {
		return invalid(nestingRule[parentType])
	}
	return nil
}

// validateMove checks a type and/or parent change against the task's current
// parent and children. It locks the task row for the rest of the transaction.
func validateMove(ctx context.Context, tx pgx.Tx, id string, newType *string, newParent **string) error {
	var curType, workspaceID string
	var curParent *string
	err := tx.QueryRow(ctx, `SELECT type, parent_id::text, workspace_id::text FROM tasks WHERE id = $1 FOR UPDATE`, id).
		Scan(&curType, &curParent, &workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return mapConstraintErr(err)
	}
	typ, parent := curType, curParent
	if newType != nil {
		typ = *newType
	}
	if newParent != nil {
		parent = *newParent
	}

	if parent != nil {
		if *parent == id {
			return invalid("a task cannot be its own parent")
		}
		var parentType, parentWorkspace string
		err := tx.QueryRow(ctx, `SELECT type, workspace_id::text FROM tasks WHERE id = $1`, *parent).Scan(&parentType, &parentWorkspace)
		if errors.Is(err, pgx.ErrNoRows) {
			return invalid("parent task not found")
		} else if err != nil {
			return mapConstraintErr(err)
		}
		if parentWorkspace != workspaceID {
			return invalid("parent task must be in the same workspace")
		}
		if err := checkNesting(parentType, typ); err != nil {
			return err
		}
	}

	// Existing children must still fit under the (possibly new) type.
	var maxChildRank int
	err = tx.QueryRow(ctx, `
		SELECT coalesce(max(CASE type WHEN 'project' THEN 3 WHEN 'daily' THEN 2 ELSE 1 END), 0)
		FROM tasks WHERE parent_id = $1`, id).Scan(&maxChildRank)
	if err != nil {
		return err
	}
	if maxChildRank >= typeRank[typ] {
		return invalid(fmt.Sprintf("cannot change the type to %s: %s", typ, nestingRule[typ]))
	}
	return nil
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
