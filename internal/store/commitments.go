package store

import (
	"context"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
)

// DefaultCapacityHours is a person's weekly capacity until they set one.
const DefaultCapacityHours = 40

// Commitment is what one person intends to finish in a week: the daily
// tasks they picked (in their order), plus every hourly task assigned to
// them that starts in the week, which is committed automatically.
type Commitment struct {
	UserID      string `json:"user_id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	// Week is the Monday the week starts on (YYYY-MM-DD).
	Week          string  `json:"week"`
	CapacityHours float64 `json:"capacity_hours"`
	Note          string  `json:"note"`
	// UpdatedAt is nil until the person saves a commitment for the week.
	UpdatedAt *time.Time      `json:"updated_at"`
	Tasks     []CommittedTask `json:"tasks"`
	// HourlyHours is the time the hourly tasks take, counted like the
	// workload report: actual hours (else the schedule), overlaps once.
	HourlyHours float64 `json:"hourly_hours"`
	// CarriedOver lists last week's committed tasks that still aren't done.
	CarriedOver []string `json:"carried_over"`
	// PrevTotal tasks were committed last week; PrevKept of them were done
	// before that week ended.
	PrevTotal int `json:"prev_total"`
	PrevKept  int `json:"prev_kept"`
	// Overdue lists tasks committed in the OverdueWeeks before this week
	// that still aren't done, are still the person's, and aren't committed
	// this week; CommittedWeek says when.
	Overdue []CommittedTask `json:"overdue"`
}

// TaskBrief is what the team view shows of a committed task.
type TaskBrief struct {
	ID               string   `json:"id"`
	WorkspaceID      string   `json:"workspace_id"`
	Key              string   `json:"key"`
	Title            string   `json:"title"`
	Type             string   `json:"type"`
	Status           string   `json:"status"`
	EstimateHours    *float64 `json:"estimate_hours"`
	EnvironmentName  *string  `json:"environment_name"`
	EnvironmentColor *string  `json:"environment_color"`
	ProjectTitle     *string  `json:"project_title"`
	Automatic        bool     `json:"automatic"`
	CommittedWeek    string   `json:"committed_week,omitempty"`
}

// CommitmentBrief is a Commitment with TaskBriefs, for the team view.
type CommitmentBrief struct {
	UserID        string      `json:"user_id"`
	Username      string      `json:"username"`
	DisplayName   string      `json:"display_name"`
	Email         string      `json:"email"`
	Week          string      `json:"week"`
	CapacityHours float64     `json:"capacity_hours"`
	Note          string      `json:"note"`
	UpdatedAt     *time.Time  `json:"updated_at"`
	Tasks         []TaskBrief `json:"tasks"`
	HourlyHours   float64     `json:"hourly_hours"`
	PrevTotal     int         `json:"prev_total"`
	PrevKept      int         `json:"prev_kept"`
	Overdue       []TaskBrief `json:"overdue"`
}

func brief(list []CommittedTask) []TaskBrief {
	out := make([]TaskBrief, len(list))
	for i, t := range list {
		out[i] = TaskBrief{t.ID, t.WorkspaceID, t.Key, t.Title, t.Type, t.Status, t.EstimateHours,
			t.EnvironmentName, t.EnvironmentColor, t.ProjectTitle, t.Automatic, t.CommittedWeek}
	}
	return out
}

// Brief drops the task fields the team view doesn't use.
func (c Commitment) Brief() CommitmentBrief {
	return CommitmentBrief{c.UserID, c.Username, c.DisplayName, c.Email, c.Week, c.CapacityHours, c.Note,
		c.UpdatedAt, brief(c.Tasks), c.HourlyHours, c.PrevTotal, c.PrevKept, brief(c.Overdue)}
}

// OverdueWeeks is how far back unfinished commitments are reported.
const OverdueWeeks = 4

// CommittedTask is a task plus the project it sits in (its parent or
// grandparent); ProjectID is nil for independent tasks. Automatic marks
// hourly tasks committed by their schedule rather than picked.
type CommittedTask struct {
	Task
	ProjectID    *string `json:"project_id"`
	ProjectTitle *string `json:"project_title"`
	Automatic    bool    `json:"automatic"`
	// CommittedWeek (YYYY-MM-DD, a Monday) is set on overdue tasks.
	CommittedWeek string `json:"committed_week,omitempty"`
}

// CommitmentInput replaces a person's commitment for a week.
type CommitmentInput struct {
	CapacityHours *float64 `json:"capacity_hours"`
	Note          string   `json:"note"`
	// TaskIDs are the daily tasks picked, in order.
	TaskIDs []string `json:"task_ids"`
}

// WeekStart checks that t is the very start of a Monday (in t's own time
// zone, which is the caller's).
func WeekStart(t time.Time) error {
	if t.Weekday() != time.Monday || t.Hour() != 0 || t.Minute() != 0 || t.Second() != 0 || t.Nanosecond() != 0 {
		return invalid("week must be the start of a Monday, e.g. 2026-10-05T00:00:00+07:00")
	}
	return nil
}

func weekDate(t time.Time) string { return t.Format(time.DateOnly) }

// committedSQL lists (user_id, task_id, automatic, position) for a week:
// picked daily tasks ($1 = week date) and assigned hourly tasks starting in
// [$2, $3), for user $4 (NULL: everyone) in workspaces $5 (NULL: all).
const committedSQL = `
	SELECT ct.user_id, ct.task_id, false AS automatic, ct.position
	FROM commitment_tasks ct JOIN tasks d ON d.id = ct.task_id
	WHERE ct.week_start = $1 AND d.type = 'daily'
	  AND ($4::uuid IS NULL OR ct.user_id = $4)
	  AND ($5::text[] IS NULL OR d.workspace_id::text = ANY($5))
	UNION ALL
	SELECT ta.user_id, ta.task_id, true, 0
	FROM task_assignees ta JOIN tasks h ON h.id = ta.task_id
	WHERE h.type = 'hourly' AND h.start_at >= $2 AND h.start_at < $3
	  AND ($4::uuid IS NULL OR ta.user_id = $4)
	  AND ($5::text[] IS NULL OR h.workspace_id::text = ANY($5))`

// taskColsLite returns the same columns as taskCols for scanTask, without
// the per-row lookups (owners, subtask/comment counts, dependencies) that
// only the task dialog needs; it keeps the team view fast for big teams.
const taskColsLite = `t.id::text, t.workspace_id::text, p.key, t.parent_id::text, t.number,
	t.title, '', t.type, t.project_kind, t.status, t.priority,
	'{}'::text[], NULL::text, t.start_at, t.end_at,
	t.estimate_hours::float8, t.actual_hours::float8, t.progress, t.position,
	t.completed_at, t.created_at, t.updated_at,
	0::bigint, 0::bigint, 0::bigint, '{}'::text[], 0::bigint,
	t.environment_id::text, e.name, e.color,
	t.project_category_id::text, pc.name, pc.color`

// Commitments returns every active user's commitment for the week starting
// at week (plus inactive users with committed tasks), with tasks limited to
// scope. userID, when set, returns only that user. lite skips the task
// fields only the task dialog needs (see taskColsLite and Brief).
func (s *Store) Commitments(ctx context.Context, week time.Time, scope Scope, userID string, lite bool) ([]Commitment, error) {
	cols := taskCols
	if lite {
		cols = taskColsLite
	}
	if err := WeekStart(week); err != nil {
		return nil, err
	}
	var user any
	if userID != "" {
		user = userID
	}
	end := week.AddDate(0, 0, 7)
	rows, err := s.db.Query(ctx, `
		SELECT u.id::text, u.username, u.display_name, u.email,
		       coalesce(c.capacity_hours::float8, $3), coalesce(c.note, ''), c.updated_at
		FROM users u
		LEFT JOIN commitments c ON c.user_id = u.id AND c.week_start = $1
		WHERE ($2::uuid IS NULL OR u.id = $2)
		  AND ((u.active AND u.deleted_at IS NULL) OR c.user_id IS NOT NULL
		       OR EXISTS (SELECT 1 FROM task_assignees ta JOIN tasks h ON h.id = ta.task_id
		                  WHERE ta.user_id = u.id AND h.type = 'hourly' AND h.start_at >= $4 AND h.start_at < $5))
		ORDER BY lower(coalesce(nullif(u.display_name, ''), u.username))`,
		weekDate(week), user, DefaultCapacityHours, week, end)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Commitment, error) {
		c := Commitment{Week: weekDate(week), Tasks: []CommittedTask{}, CarriedOver: []string{}, Overdue: []CommittedTask{}}
		err := row.Scan(&c.UserID, &c.Username, &c.DisplayName, &c.Email, &c.CapacityHours, &c.Note, &c.UpdatedAt)
		return c, err
	})
	if err != nil {
		return nil, err
	}
	byUser := make(map[string]*Commitment, len(out))
	for i := range out {
		byUser[out[i].UserID] = &out[i]
	}

	// This week's tasks: picked daily tasks in order, then hourly by start.
	rows, err = s.db.Query(ctx, `SELECT x.user_id::text, x.automatic,
		       CASE WHEN p1.type = 'project' THEN p1.id::text WHEN p2.type = 'project' THEN p2.id::text END,
		       CASE WHEN p1.type = 'project' THEN p1.title WHEN p2.type = 'project' THEN p2.title END,
		       `+cols+taskFrom+`
		JOIN (`+committedSQL+`) x ON x.task_id = t.id
		LEFT JOIN tasks p1 ON p1.id = t.parent_id
		LEFT JOIN tasks p2 ON p2.id = p1.parent_id
		ORDER BY x.automatic, x.position, t.start_at, t.number`,
		weekDate(week), week, end, user, scopeArg(scope))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	spans := map[string][]span{}
	for rows.Next() {
		var uid string
		var t CommittedTask
		if t.Task, err = scanTask(prefixRow{rows, []any{&uid, &t.Automatic, &t.ProjectID, &t.ProjectTitle}}); err != nil {
			return nil, err
		}
		c := byUser[uid]
		if c == nil {
			continue
		}
		c.Tasks = append(c.Tasks, t)
		if t.Type == "hourly" {
			sp, loose := hourlySpan(t.StartAt, t.EndAt, t.ActualHours)
			if sp != nil {
				spans[uid] = append(spans[uid], *sp)
			}
			c.HourlyHours += loose
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for uid, list := range spans {
		byUser[uid].HourlyHours += mergedHours(list)
	}
	if err := s.overdue(ctx, week, user, scope, cols, byUser); err != nil {
		return nil, err
	}

	// Last week: how much was kept, and what is still open.
	prev := week.AddDate(0, 0, -7)
	rows, err = s.db.Query(ctx, `
		SELECT x.user_id::text, t.id::text, t.status = 'done',
		       t.completed_at IS NOT NULL AND t.completed_at < $3
		FROM (`+committedSQL+`) x JOIN tasks t ON t.id = x.task_id`,
		weekDate(prev), prev, week, user, scopeArg(scope))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var uid, taskID string
		var done, kept bool
		if err := rows.Scan(&uid, &taskID, &done, &kept); err != nil {
			return nil, err
		}
		c := byUser[uid]
		if c == nil {
			continue
		}
		c.PrevTotal++
		if kept {
			c.PrevKept++
		}
		if !done {
			c.CarriedOver = append(c.CarriedOver, taskID)
		}
	}
	return out, rows.Err()
}

// overdue fills each commitment's Overdue list (see Commitment). A daily
// task picked in several earlier weeks is reported once, for the latest.
func (s *Store) overdue(ctx context.Context, week time.Time, user any, scope Scope, cols string, byUser map[string]*Commitment) error {
	from := week.AddDate(0, 0, -7*OverdueWeeks)
	rows, err := s.db.Query(ctx, `SELECT x.user_id::text, x.wk,
		       CASE WHEN p1.type = 'project' THEN p1.id::text WHEN p2.type = 'project' THEN p2.id::text END,
		       CASE WHEN p1.type = 'project' THEN p1.title WHEN p2.type = 'project' THEN p2.title END,
		       `+cols+taskFrom+`
		JOIN (
			-- Filters sit in each branch so only open, in-scope work is joined.
			-- Daily picks must still be the user's; hourly rows come from their assignments.
			SELECT ct.user_id, ct.task_id, ct.week_start AS wk
			FROM commitment_tasks ct JOIN tasks d ON d.id = ct.task_id
			WHERE ct.week_start >= $1 AND ct.week_start < $2 AND d.type = 'daily' AND d.status <> 'done'
			  AND ($5::uuid IS NULL OR ct.user_id = $5)
			  AND ($6::text[] IS NULL OR d.workspace_id::text = ANY($6))
			  AND EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = d.id AND a.user_id = ct.user_id)
			UNION ALL
			SELECT ta.user_id, ta.task_id, NULL
			FROM task_assignees ta JOIN tasks h ON h.id = ta.task_id
			WHERE h.type = 'hourly' AND h.status <> 'done' AND h.start_at >= $3 AND h.start_at < $4
			  AND ($5::uuid IS NULL OR ta.user_id = $5)
			  AND ($6::text[] IS NULL OR h.workspace_id::text = ANY($6))
		) x ON x.task_id = t.id
		LEFT JOIN tasks p1 ON p1.id = t.parent_id
		LEFT JOIN tasks p2 ON p2.id = p1.parent_id
		ORDER BY x.wk DESC NULLS LAST, t.start_at, t.number`,
		weekDate(from), weekDate(week), from, week, user, scopeArg(scope))
	if err != nil {
		return err
	}
	defer rows.Close()
	seen := map[string]bool{}
	for rows.Next() {
		var uid string
		var wk *time.Time
		var t CommittedTask
		if t.Task, err = scanTask(prefixRow{rows, []any{&uid, &wk, &t.ProjectID, &t.ProjectTitle}}); err != nil {
			return err
		}
		c := byUser[uid]
		if c == nil || seen[uid+t.ID] {
			continue
		}
		seen[uid+t.ID] = true
		if slices.ContainsFunc(c.Tasks, func(x CommittedTask) bool { return x.ID == t.ID }) {
			continue // committed again this week
		}
		if wk != nil {
			t.CommittedWeek = wk.Format(time.DateOnly)
		} else {
			// An hourly task belongs to the week it starts in, in the caller's zone.
			d := t.StartAt.In(week.Location())
			t.CommittedWeek = d.AddDate(0, 0, -((int(d.Weekday()) + 6) % 7)).Format(time.DateOnly)
			t.Automatic = true
		}
		c.Overdue = append(c.Overdue, t)
	}
	return rows.Err()
}

// hourlySpan is the time an hourly task covers (see Workload): start plus
// actual hours when recorded, else its schedule. A task with actual hours
// but no start returns them as loose hours instead.
func hourlySpan(start, end *time.Time, actual *float64) (*span, float64) {
	switch {
	case start != nil && actual != nil:
		return &span{*start, start.Add(time.Duration(*actual * float64(time.Hour)))}, 0
	case start != nil && end != nil && end.After(*start):
		return &span{*start, *end}, 0
	case actual != nil:
		return nil, *actual
	}
	return nil, 0
}

// prefixRow scans leading columns into first, then the rest into dest
// (so scanTask can read a row with extra columns in front).
type prefixRow struct {
	pgx.Row
	first []any
}

func (r prefixRow) Scan(dest ...any) error { return r.Row.Scan(append(r.first, dest...)...) }

// SaveCommitment replaces userID's commitment for the week. Tasks must be
// daily tasks in scope (hourly tasks are committed by their schedule) that
// are assigned to the user, or unassigned in a workspace they can edit
// (editable; nil means all), which assigns them to the user. Picked tasks
// without dates the user can edit are scheduled Monday to Friday of the
// week. Committed tasks outside scope (workspaces the user can no longer
// see) are kept.
func (s *Store) SaveCommitment(ctx context.Context, userID string, week time.Time, in CommitmentInput, scope, editable Scope) error {
	if err := WeekStart(week); err != nil {
		return err
	}
	capacity := float64(DefaultCapacityHours)
	if in.CapacityHours != nil {
		capacity = *in.CapacityHours
	}
	if capacity < 0 || capacity > 168 {
		return invalid("capacity_hours must be between 0 and 168")
	}
	if len(in.Note) > 2000 {
		return invalid("note is too long (2000 characters at most)")
	}
	ids := make([]string, 0, len(in.TaskIDs))
	seen := map[string]bool{}
	for _, id := range in.TaskIDs {
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var ok int
	err = tx.QueryRow(ctx, `
		SELECT count(*) FROM tasks t
		WHERE t.id::text = ANY($1) AND t.type = 'daily'
		  AND ($3::text[] IS NULL OR t.workspace_id::text = ANY($3))
		  AND (EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id = $2)
		       OR (NOT EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id)
		           AND ($4::text[] IS NULL OR t.workspace_id::text = ANY($4))))`,
		ids, userID, scopeArg(scope), scopeArg(editable)).Scan(&ok)
	if err != nil {
		return err
	}
	if ok != len(ids) {
		return invalid("you can only pick daily tasks assigned to you, or unassigned ones in a workspace you can edit; hourly tasks scheduled in the week are committed automatically")
	}

	// Picking an unassigned task takes it on.
	if _, err := tx.Exec(ctx, `
		INSERT INTO task_assignees (task_id, user_id)
		SELECT t.id, $2 FROM tasks t
		WHERE t.id::text = ANY($1) AND NOT EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id)`,
		ids, userID); err != nil {
		return err
	}
	// Unscheduled picks are planned for this work week (daily tasks end at
	// the midnight after their last day).
	if _, err := tx.Exec(ctx, `
		UPDATE tasks t SET start_at = $2, end_at = $3, updated_at = now()
		WHERE t.id::text = ANY($1) AND t.start_at IS NULL AND t.end_at IS NULL
		  AND ($4::text[] IS NULL OR t.workspace_id::text = ANY($4))`,
		ids, week, week.AddDate(0, 0, 5), scopeArg(editable)); err != nil {
		return err
	}

	day := weekDate(week)
	if _, err := tx.Exec(ctx, `
		INSERT INTO commitments (user_id, week_start, capacity_hours, note)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, week_start) DO UPDATE
		SET capacity_hours = EXCLUDED.capacity_hours, note = EXCLUDED.note, updated_at = now()`,
		userID, day, capacity, in.Note); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		DELETE FROM commitment_tasks ct USING tasks t
		WHERE t.id = ct.task_id AND ct.user_id = $1 AND ct.week_start = $2
		  AND ($3::text[] IS NULL OR t.workspace_id::text = ANY($3))`,
		userID, day, scopeArg(scope)); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO commitment_tasks (user_id, week_start, task_id, position)
		SELECT $1, $2, id::uuid, ord FROM unnest($3::text[]) WITH ORDINALITY AS x(id, ord)`,
		userID, day, ids); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
