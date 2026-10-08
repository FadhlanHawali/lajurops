package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type Task struct {
	ID           string  `json:"id"`
	WorkspaceID  string  `json:"workspace_id"`
	WorkspaceKey string  `json:"workspace_key"`
	ParentID     *string `json:"parent_id"`
	Number       int     `json:"number"`
	Key          string  `json:"key"`
	Title        string  `json:"title"`
	Description  string  `json:"description"`
	Type         string  `json:"type"`
	// ProjectKind is "long" or "short" for project tasks, nil otherwise.
	ProjectKind   *string    `json:"project_kind"`
	Status        string     `json:"status"`
	Priority      string     `json:"priority"`
	AssigneeIDs   []string   `json:"assignee_ids"`
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
	CommentCount  int        `json:"comment_count"`
	// BlockedBy lists the tasks this one waits for; OpenBlockers counts
	// those not done yet.
	BlockedBy    []string `json:"blocked_by"`
	OpenBlockers int      `json:"open_blockers"`
	// Environment the task is done in (daily/hourly tasks inside a project).
	EnvironmentID    *string `json:"environment_id"`
	EnvironmentName  *string `json:"environment_name"`
	EnvironmentColor *string `json:"environment_color"`
	// Category of a project (KPI, Enhancement, ...); nil for other tasks.
	ProjectCategoryID    *string `json:"project_category_id"`
	ProjectCategoryName  *string `json:"project_category_name"`
	ProjectCategoryColor *string `json:"project_category_color"`
	// Runbook checklist progress (steps in all sections).
	RunbookTotal int `json:"runbook_total"`
	RunbookDone  int `json:"runbook_done"`
}

type TaskInput struct {
	WorkspaceID string  `json:"workspace_id"`
	ParentID    *string `json:"parent_id"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Type        string  `json:"type"`
	// ProjectKind is "long" or "short" for project tasks, nil otherwise.
	ProjectKind       *string    `json:"project_kind"`
	Status            string     `json:"status"`
	Priority          string     `json:"priority"`
	AssigneeIDs       []string   `json:"assignee_ids"`
	StartAt           *time.Time `json:"start_at"`
	EndAt             *time.Time `json:"end_at"`
	EstimateHours     *float64   `json:"estimate_hours"`
	ActualHours       *float64   `json:"actual_hours"`
	Progress          int        `json:"progress"`
	EnvironmentID     *string    `json:"environment_id"`
	ProjectCategoryID *string    `json:"project_category_id"`
}

type TaskFilter struct {
	WorkspaceID string
	// WorkspaceIDs, when non-nil, limits results to these workspaces (the
	// ones the caller may see); an empty slice matches nothing.
	WorkspaceIDs []string
	AssigneeID   string
	// OthersOf, when set, returns tasks that have owners, none of them
	// this user (?assignee_id=others).
	OthersOf string
	ParentID string
	TopLevel bool
	Types    []string
	// From/To select tasks whose schedule overlaps [From, To).
	From, To *time.Time
	// Undated, with From/To, also returns tasks without dates: "all", or
	// "open" for those not done yet.
	Undated string
	// WithAncestors also returns the parents (and their parents) of the
	// matching tasks, so lists keep their project context.
	WithAncestors bool
	// Search matches the title (case-insensitive) or the task number ("12",
	// "APP-12"); results are ranked best first. Limit caps the result count.
	Search string
	Limit  int
}

var (
	taskTypes     = set("project", "daily", "hourly")
	projectKinds  = set("long", "short")
	taskStatuses  = set("todo", "in_progress", "in_review", "done")
	taskPriorites = set("low", "medium", "high", "urgent")
)

const taskCols = `t.id::text, t.workspace_id::text, p.key, t.parent_id::text, t.number,
	t.title, t.description, t.type, t.project_kind, t.status, t.priority,
	(SELECT coalesce(array_agg(a.user_id::text ORDER BY a.assigned_at), '{}') FROM task_assignees a WHERE a.task_id = t.id),
	t.reporter_id::text, t.start_at, t.end_at,
	t.estimate_hours::float8, t.actual_hours::float8, t.progress, t.position,
	t.completed_at, t.created_at, t.updated_at,
	(SELECT count(*) FROM tasks s WHERE s.parent_id = t.id),
	(SELECT count(*) FROM tasks s WHERE s.parent_id = t.id AND s.status = 'done'),
	(SELECT count(*) FROM task_comments c WHERE c.task_id = t.id),
	(SELECT coalesce(array_agg(d.depends_on_id::text), '{}') FROM task_dependencies d WHERE d.task_id = t.id),
	(SELECT count(*) FROM task_dependencies d JOIN tasks b ON b.id = d.depends_on_id
	  WHERE d.task_id = t.id AND b.status <> 'done'),
	t.environment_id::text, e.name, e.color,
	t.project_category_id::text, pc.name, pc.color,
	(SELECT count(*) FROM runbook_steps rs JOIN runbook_sections sec ON sec.id = rs.section_id WHERE sec.task_id = t.id),
	(SELECT count(*) FILTER (WHERE CASE WHEN rs.task_id IS NULL THEN rs.done ELSE lt.status = 'done' END)
	  FROM runbook_steps rs JOIN runbook_sections sec ON sec.id = rs.section_id LEFT JOIN tasks lt ON lt.id = rs.task_id
	  WHERE sec.task_id = t.id)`

const taskFrom = ` FROM tasks t JOIN workspaces p ON p.id = t.workspace_id
	LEFT JOIN project_environments e ON e.id = t.environment_id
	LEFT JOIN project_categories pc ON pc.id = t.project_category_id`

func scanTask(row pgx.Row) (Task, error) {
	var t Task
	err := row.Scan(&t.ID, &t.WorkspaceID, &t.WorkspaceKey, &t.ParentID, &t.Number,
		&t.Title, &t.Description, &t.Type, &t.ProjectKind, &t.Status, &t.Priority,
		&t.AssigneeIDs, &t.ReporterID, &t.StartAt, &t.EndAt,
		&t.EstimateHours, &t.ActualHours, &t.Progress, &t.Position,
		&t.CompletedAt, &t.CreatedAt, &t.UpdatedAt, &t.SubtaskCount, &t.SubtaskDone, &t.CommentCount,
		&t.BlockedBy, &t.OpenBlockers, &t.EnvironmentID, &t.EnvironmentName, &t.EnvironmentColor,
		&t.ProjectCategoryID, &t.ProjectCategoryName, &t.ProjectCategoryColor, &t.RunbookTotal, &t.RunbookDone)
	if errors.Is(err, pgx.ErrNoRows) {
		return t, ErrNotFound
	}
	t.Key = fmt.Sprintf("%s-%d", t.WorkspaceKey, t.Number)
	return t, err
}

func (s *Store) ListTasks(ctx context.Context, f TaskFilter) ([]Task, error) {
	if f.Undated != "" && f.Undated != "all" && f.Undated != "open" {
		return nil, invalid("undated must be all or open")
	}
	var where []string
	var args []any
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, fmt.Sprintf(cond, len(args)))
	}
	if f.WorkspaceID != "" {
		add("t.workspace_id = $%d", f.WorkspaceID)
	}
	if f.WorkspaceIDs != nil {
		add("t.workspace_id::text = ANY($%d)", f.WorkspaceIDs)
	}
	if f.AssigneeID == "none" {
		where = append(where, "NOT EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id)")
	} else if f.OthersOf != "" {
		where = append(where, "EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id)")
		add("NOT EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id = $%d)", f.OthersOf)
	} else if f.AssigneeID != "" {
		add("EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id = $%d)", f.AssigneeID)
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
	// A task's span is start..end; with only one of them set, that moment.
	var span []string
	if f.To != nil {
		args = append(args, *f.To)
		span = append(span, fmt.Sprintf("coalesce(t.start_at, t.end_at) < $%d", len(args)))
	}
	if f.From != nil {
		args = append(args, *f.From)
		span = append(span, fmt.Sprintf("coalesce(t.end_at, t.start_at) >= $%d", len(args)))
	}
	if len(span) > 0 {
		cond := strings.Join(span, " AND ")
		switch f.Undated {
		case "all":
			cond = "((" + cond + ") OR (t.start_at IS NULL AND t.end_at IS NULL))"
		case "open":
			cond = "((" + cond + ") OR (t.start_at IS NULL AND t.end_at IS NULL AND t.status <> 'done'))"
		}
		where = append(where, cond)
	}

	order := " ORDER BY t.position, t.number"
	if q := strings.TrimSpace(f.Search); q != "" {
		like := "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(q) + "%"
		num := -1
		if m := taskNumberRe.FindStringSubmatch(q); m != nil {
			num, _ = strconv.Atoi(m[1])
		}
		args = append(args, like, num, strings.TrimSuffix(like[1:], "%")+"%")
		n := len(args)
		where = append(where, fmt.Sprintf("(t.title ILIKE $%d OR t.number = $%d)", n-2, n-1))
		// Exact number, then titles starting with the query, open before done, newest first.
		order = fmt.Sprintf(" ORDER BY t.number = $%d DESC, t.title ILIKE $%d DESC, t.status = 'done', t.number DESC", n-1, n)
	}

	cond := ""
	if len(where) > 0 {
		cond = " WHERE " + strings.Join(where, " AND ")
	}
	q := `SELECT ` + taskCols + taskFrom + cond
	if f.WithAncestors {
		// Tasks nest at most Project > Daily > Hourly, so ancestors are the
		// parents and grandparents (always in the same workspace).
		q = `WITH m AS MATERIALIZED (SELECT t.id, t.parent_id FROM tasks t` + cond + `)
			SELECT ` + taskCols + taskFrom + ` WHERE t.id IN (
				SELECT id FROM m
				UNION SELECT parent_id FROM m WHERE parent_id IS NOT NULL
				UNION SELECT g.parent_id FROM m JOIN tasks g ON g.id = m.parent_id WHERE g.parent_id IS NOT NULL)`
	}
	q += order
	if f.Limit > 0 {
		q += fmt.Sprintf(" LIMIT %d", f.Limit)
	}

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

// taskNumberRe finds the number in "12" or "APP-12".
var taskNumberRe = regexp.MustCompile(`^(?:[A-Za-z][A-Za-z0-9]*-)?(\d{1,9})$`)

// ProjectProgress is how many of a project's daily and hourly tasks
// (children and grandchildren) are done.
type ProjectProgress struct {
	ProjectID string `json:"project_id"`
	Done      int    `json:"done"`
	Total     int    `json:"total"`
}

// ProjectProgressFor counts the work inside every project of a workspace.
func (s *Store) ProjectProgressFor(ctx context.Context, workspaceID string) ([]ProjectProgress, error) {
	rows, err := s.db.Query(ctx, `
		SELECT p.id::text, count(x.id) FILTER (WHERE x.status = 'done'), count(x.id)
		FROM tasks p
		LEFT JOIN LATERAL (
			SELECT c.id, c.status FROM tasks c WHERE c.parent_id = p.id
			UNION ALL
			SELECT g.id, g.status FROM tasks c JOIN tasks g ON g.parent_id = c.id WHERE c.parent_id = p.id
		) x ON true
		WHERE p.workspace_id = $1 AND p.type = 'project'
		GROUP BY p.id`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProjectProgress{}
	for rows.Next() {
		var p ProjectProgress
		if err := rows.Scan(&p.ProjectID, &p.Done, &p.Total); err != nil {
			return nil, err
		}
		out = append(out, p)
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
	if in.Type == "project" {
		if in.ProjectKind == nil || *in.ProjectKind == "" {
			in.ProjectKind = ptr("short")
		}
		if !projectKinds[*in.ProjectKind] {
			return Task{}, invalid("project_kind must be long or short")
		}
	} else if in.ProjectKind != nil && *in.ProjectKind != "" {
		return Task{}, invalid("only project tasks have a project_kind")
	} else {
		in.ProjectKind = nil
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
		                   reporter_id, start_at, end_at, estimate_hours, actual_hours, progress, project_kind,
		                   position, completed_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
		        (SELECT coalesce(max(position), 0) + 1 FROM tasks WHERE workspace_id = $1 AND status = $7),
		        CASE WHEN $7 = 'done' THEN now() END)
		RETURNING id::text`,
		in.WorkspaceID, in.ParentID, number, in.Title, in.Description, in.Type, in.Status, in.Priority,
		nullString(reporterID), in.StartAt, in.EndAt, in.EstimateHours, in.ActualHours, in.Progress, in.ProjectKind,
	).Scan(&id)
	if err != nil {
		return Task{}, mapConstraintErr(err)
	}
	if err := setAssignees(ctx, tx, id, in.AssigneeIDs); err != nil {
		return Task{}, err
	}
	if cat := emptyToNil(in.ProjectCategoryID); cat != nil {
		if err := checkCategory(ctx, tx, in.Type, in.WorkspaceID, *cat); err != nil {
			return Task{}, err
		}
		if _, err := tx.Exec(ctx, `UPDATE tasks SET project_category_id = $2 WHERE id = $1`, id, *cat); err != nil {
			return Task{}, mapConstraintErr(err)
		}
	}
	// A new task changes its project's derived status/progress.
	if root, err := rootProject(ctx, tx, &id); err != nil {
		return Task{}, err
	} else if err := recomputeProjects(ctx, tx, root); err != nil {
		return Task{}, err
	}
	if env := emptyToNil(in.EnvironmentID); env != nil {
		if err := checkEnvironment(ctx, tx, in.Type, in.ParentID, *env); err != nil {
			return Task{}, err
		}
		if _, err := tx.Exec(ctx, `UPDATE tasks SET environment_id = $2 WHERE id = $1`, id, *env); err != nil {
			return Task{}, mapConstraintErr(err)
		}
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
	var assignees *[]string
	var newKind *string
	var newEnv **string
	var newCategory **string

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
		case "project_category_id":
			var v *string
			if err := json.Unmarshal(raw, &v); err != nil {
				return Task{}, invalid("project_category_id must be a string or null")
			}
			v = emptyToNil(v)
			newCategory = &v
		case "environment_id":
			var v *string
			if err := json.Unmarshal(raw, &v); err != nil {
				return Task{}, invalid("environment_id must be a string or null")
			}
			v = emptyToNil(v)
			newEnv = &v
		case "project_kind":
			var v string
			if err := json.Unmarshal(raw, &v); err != nil || !projectKinds[v] {
				return Task{}, invalid("project_kind must be long or short")
			}
			newKind = &v
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
		case "assignee_ids":
			var v []string
			if err := json.Unmarshal(raw, &v); err != nil {
				return Task{}, invalid("assignee_ids must be a list of user ids")
			}
			assignees = &v
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
	// Keep project_kind in step with the type: projects always have one.
	switch {
	case newType != nil && *newType != "project":
		if newKind != nil {
			return Task{}, invalid("only project tasks have a project_kind")
		}
		sets = append(sets, "project_kind = NULL")
	case newKind != nil:
		set("project_kind", *newKind)
	case newType != nil:
		sets = append(sets, "project_kind = coalesce(project_kind, 'short')")
	}
	if len(sets) == 0 && assignees == nil && newEnv == nil && newCategory == nil {
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
	// The project this task counted towards before the change.
	oldRoot, err := rootProject(ctx, tx, &id)
	if err != nil {
		return Task{}, err
	}
	if newType != nil && *newType != "project" {
		sets = append(sets, "project_category_id = NULL")
	}
	if newType != nil && *newType != "hourly" {
		var hasRunbook bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM runbook_sections WHERE task_id = $1)`, id).Scan(&hasRunbook); err != nil {
			return Task{}, err
		}
		if hasRunbook {
			return Task{}, invalid("this task has a runbook, and runbooks are only for hourly tasks; delete its runbook sections first")
		}
	}

	args = append(args, id)
	sets = append(sets, "updated_at = now()")
	q := fmt.Sprintf(`UPDATE tasks SET %s WHERE id = $%d`, strings.Join(sets, ", "), len(args))
	tag, err := tx.Exec(ctx, q, args...)
	if err != nil {
		return Task{}, mapConstraintErr(err)
	}
	if tag.RowsAffected() == 0 {
		return Task{}, ErrNotFound
	}
	if assignees != nil {
		if err := setAssignees(ctx, tx, id, *assignees); err != nil {
			return Task{}, err
		}
	}
	if newType != nil || newParent != nil || newEnv != nil {
		if err := syncEnvironment(ctx, tx, id, newParent != nil || newType != nil, newEnv); err != nil {
			return Task{}, err
		}
	}
	if newCategory != nil {
		var typ, ws string
		if err := tx.QueryRow(ctx, `SELECT type, workspace_id::text FROM tasks WHERE id = $1`, id).Scan(&typ, &ws); err != nil {
			return Task{}, mapConstraintErr(err)
		}
		if *newCategory != nil {
			if err := checkCategory(ctx, tx, typ, ws, **newCategory); err != nil {
				return Task{}, err
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE tasks SET project_category_id = $2 WHERE id = $1`, id, *newCategory); err != nil {
			return Task{}, mapConstraintErr(err)
		}
	}
	// Projects' status/progress follow their tasks (this also overrides
	// any status set directly on a project).
	newRoot, err := rootProject(ctx, tx, &id)
	if err != nil {
		return Task{}, err
	}
	if err := recomputeProjects(ctx, tx, oldRoot, newRoot); err != nil {
		return Task{}, err
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

	if typ == "project" && curType != "project" {
		var deps int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM task_dependencies WHERE task_id = $1 OR depends_on_id = $1`, id).Scan(&deps); err != nil {
			return err
		}
		if deps > 0 {
			return invalid("remove this task's dependencies before turning it into a project")
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
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	root, err := rootProject(ctx, tx, &id)
	if err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `DELETE FROM tasks WHERE id = $1`, id)
	if err != nil {
		return mapConstraintErr(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	if root != id {
		if err := recomputeProjects(ctx, tx, root); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func mapConstraintErr(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23514": // check_violation
			if pgErr.ConstraintName == "tasks_category_only_projects" {
				return invalid("only projects have a category")
			}
			if pgErr.ConstraintName == "tasks_project_kind_matches_type" {
				return invalid("only project tasks have a project kind (long or short)")
			}
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

// setAssignees replaces a task's owners, keeping the original assignment time
// of owners who stay.
func setAssignees(ctx context.Context, tx pgx.Tx, taskID string, userIDs []string) error {
	ids := make([]string, 0, len(userIDs))
	seen := map[string]bool{}
	for _, u := range userIDs {
		if u = strings.TrimSpace(u); u != "" && !seen[u] {
			seen[u] = true
			ids = append(ids, u)
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM task_assignees WHERE task_id = $1 AND NOT (user_id::text = ANY($2))`, taskID, ids); err != nil {
		return err
	}
	for _, u := range ids {
		if _, err := tx.Exec(ctx, `INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, taskID, u); err != nil {
			return mapConstraintErr(err)
		}
	}
	return nil
}

func ptr[T any](v T) *T { return &v }

// syncEnvironment runs after a task's type/parent changed or an environment
// was chosen. Moving under another project clears environments (on the task
// and everything inside it) that don't belong there; a task that stops being
// a project loses its environment list.
func syncEnvironment(ctx context.Context, tx pgx.Tx, id string, moved bool, newEnv **string) error {
	var typ string
	var parent *string
	if err := tx.QueryRow(ctx, `SELECT type, parent_id::text FROM tasks WHERE id = $1`, id).Scan(&typ, &parent); err != nil {
		return mapConstraintErr(err)
	}
	if typ != "project" {
		if _, err := tx.Exec(ctx, `DELETE FROM project_environments WHERE project_id = $1`, id); err != nil {
			return err
		}
	}
	if moved {
		root := ""
		if typ == "project" {
			root = id
		} else if r, err := rootProject(ctx, tx, parent); err != nil {
			return err
		} else {
			root = r
		}
		_, err := tx.Exec(ctx, `
			WITH RECURSIVE sub(id) AS (
				SELECT $1::uuid
				UNION
				SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id
			)
			UPDATE tasks SET environment_id = NULL
			WHERE id IN (SELECT id FROM sub)
			  AND environment_id IS NOT NULL
			  AND (type = 'project' OR environment_id NOT IN (SELECT id FROM project_environments WHERE project_id::text = $2))`,
			id, root)
		if err != nil {
			return err
		}
	}
	if newEnv != nil {
		if *newEnv != nil {
			if err := checkEnvironment(ctx, tx, typ, parent, **newEnv); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE tasks SET environment_id = $2 WHERE id = $1`, id, *newEnv); err != nil {
			return mapConstraintErr(err)
		}
	}
	return nil
}
