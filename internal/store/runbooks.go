package store

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// RunbookStep is one checklist item. StartAt and DurationMinutes are optional.
type RunbookStep struct {
	ID        string `json:"id"`
	SectionID string `json:"section_id"`
	Title     string `json:"title"`
	// Notes are Markdown (commands, links, details).
	Notes           string     `json:"notes"`
	StartAt         *time.Time `json:"start_at"`
	DurationMinutes *int       `json:"duration_minutes"`
	Done            bool       `json:"done"`
	DoneAt          *time.Time `json:"done_at"`
	DoneBy          *string    `json:"done_by"`
	Position        int        `json:"position"`
	// Task is set when the step is tracked as its own daily task; the step
	// then shows that task's title, date and status (done = task done).
	Task *StepTask `json:"task"`
}

// StepTask is the daily task a runbook step is tracked as.
type StepTask struct {
	ID           string     `json:"id"`
	WorkspaceKey string     `json:"workspace_key"`
	Number       int        `json:"number"`
	Title        string     `json:"title"`
	Status       string     `json:"status"`
	StartAt      *time.Time `json:"start_at"`
	EndAt        *time.Time `json:"end_at"`
}

// RunbookSection groups steps (e.g. "Preparation", "Implementation").
type RunbookSection struct {
	ID       string        `json:"id"`
	TaskID   string        `json:"task_id"`
	Name     string        `json:"name"`
	Notes    string        `json:"notes"`
	Position int           `json:"position"`
	Steps    []RunbookStep `json:"steps"`
}

// Runbook returns a task's sections in order, each with its steps (by start
// time, then position; steps without a time last). A step tracked as a task
// takes its title, start and done state from that task.
func (s *Store) Runbook(ctx context.Context, taskID string) ([]RunbookSection, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text, task_id::text, name, notes, position FROM runbook_sections WHERE task_id = $1 ORDER BY position, created_at`, taskID)
	if err != nil {
		return nil, err
	}
	out := []RunbookSection{}
	idx := map[string]int{}
	for rows.Next() {
		var sec RunbookSection
		if err := rows.Scan(&sec.ID, &sec.TaskID, &sec.Name, &sec.Notes, &sec.Position); err != nil {
			rows.Close()
			return nil, err
		}
		sec.Steps = []RunbookStep{}
		idx[sec.ID] = len(out)
		out = append(out, sec)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows, err = s.db.Query(ctx, `
		SELECT st.id::text, st.section_id::text, st.title, st.notes, st.start_at, st.duration_minutes, st.done, st.done_at, st.done_by::text, st.position,
		       lt.id::text, w.key, lt.number, lt.title, lt.status, lt.start_at, lt.end_at
		FROM runbook_steps st JOIN runbook_sections sec ON sec.id = st.section_id
		LEFT JOIN tasks lt ON lt.id = st.task_id
		LEFT JOIN workspaces w ON w.id = lt.workspace_id
		WHERE sec.task_id = $1
		ORDER BY CASE WHEN lt.id IS NULL THEN st.start_at ELSE lt.start_at END NULLS LAST, st.position, st.created_at`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var st RunbookStep
		var lt struct {
			ID, Key, Title, Status *string
			Number                 *int
			StartAt, EndAt         *time.Time
		}
		if err := rows.Scan(&st.ID, &st.SectionID, &st.Title, &st.Notes, &st.StartAt, &st.DurationMinutes, &st.Done, &st.DoneAt, &st.DoneBy, &st.Position,
			&lt.ID, &lt.Key, &lt.Number, &lt.Title, &lt.Status, &lt.StartAt, &lt.EndAt); err != nil {
			return nil, err
		}
		if lt.ID != nil {
			st.Task = &StepTask{ID: *lt.ID, WorkspaceKey: *lt.Key, Number: *lt.Number, Title: *lt.Title, Status: *lt.Status, StartAt: lt.StartAt, EndAt: lt.EndAt}
			st.Title, st.StartAt, st.DurationMinutes = *lt.Title, lt.StartAt, nil
			st.Done = *lt.Status == "done"
		}
		if i, ok := idx[st.SectionID]; ok {
			out[i].Steps = append(out[i].Steps, st)
		}
	}
	return out, rows.Err()
}

// RunbookSectionTask returns the task a section belongs to.
func (s *Store) RunbookSectionTask(ctx context.Context, sectionID string) (string, error) {
	var id string
	err := s.db.QueryRow(ctx, `SELECT task_id::text FROM runbook_sections WHERE id = $1`, sectionID).Scan(&id)
	return id, notFound(err)
}

// RunbookStepTask returns the task a step belongs to.
func (s *Store) RunbookStepTask(ctx context.Context, stepID string) (string, error) {
	var id string
	err := s.db.QueryRow(ctx, `SELECT sec.task_id::text FROM runbook_steps st JOIN runbook_sections sec ON sec.id = st.section_id WHERE st.id = $1`, stepID).Scan(&id)
	return id, notFound(err)
}

func cleanName(name string, max int, what string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > max {
		return "", invalid(what + " must be 1-" + strconv.Itoa(max) + " characters")
	}
	return name, nil
}

// requireHourly allows runbooks only on hourly tasks (a release window,
// a maintenance slot); preparation on other days can be tracked as daily
// tasks from the runbook's steps.
func (s *Store) requireHourly(ctx context.Context, taskID string) error {
	var typ string
	if err := s.db.QueryRow(ctx, `SELECT type FROM tasks WHERE id = $1`, taskID).Scan(&typ); err != nil {
		return notFound(err)
	}
	if typ != "hourly" {
		return invalid("runbooks are only for hourly tasks")
	}
	return nil
}

// AddRunbookSection appends a section to a task's runbook.
func (s *Store) AddRunbookSection(ctx context.Context, taskID, name string) (RunbookSection, error) {
	name, err := cleanName(name, 60, "section name")
	if err != nil {
		return RunbookSection{}, err
	}
	if err := s.requireHourly(ctx, taskID); err != nil {
		return RunbookSection{}, err
	}
	sec := RunbookSection{TaskID: taskID, Name: name, Steps: []RunbookStep{}}
	err = s.db.QueryRow(ctx, `
		INSERT INTO runbook_sections (task_id, name, position)
		VALUES ($1, $2, (SELECT coalesce(max(position), -1) + 1 FROM runbook_sections WHERE task_id = $1))
		RETURNING id::text, position`, taskID, name).Scan(&sec.ID, &sec.Position)
	return sec, mapConstraintErr(err)
}

// UpdateRunbookSection changes a section's name and/or notes (nil = keep).
func (s *Store) UpdateRunbookSection(ctx context.Context, id string, name, notes *string) error {
	if name != nil {
		n, err := cleanName(*name, 60, "section name")
		if err != nil {
			return err
		}
		name = &n
	}
	if notes != nil && len(*notes) > maxNotes {
		return invalid("notes are too long")
	}
	tag, err := s.db.Exec(ctx, `UPDATE runbook_sections SET name = coalesce($2, name), notes = coalesce($3, notes) WHERE id = $1`, id, name, notes)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return mapConstraintErr(err)
}

const maxNotes = 20000

// DeleteRunbookSection removes a section and its steps.
func (s *Store) DeleteRunbookSection(ctx context.Context, id string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM runbook_sections WHERE id = $1`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// OrderRunbookSections sets the section order of a task's runbook.
func (s *Store) OrderRunbookSections(ctx context.Context, taskID string, ids []string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for i, id := range ids {
		if _, err := tx.Exec(ctx, `UPDATE runbook_sections SET position = $3 WHERE id = $1 AND task_id = $2`, id, taskID, i); err != nil {
			return mapConstraintErr(err)
		}
	}
	return tx.Commit(ctx)
}

// RunbookStepInput creates or changes a step; nil fields are left alone on update.
type RunbookStepInput struct {
	Title           *string          `json:"title"`
	Notes           *string          `json:"notes"`
	StartAt         *json.RawMessage `json:"start_at"`
	DurationMinutes *json.RawMessage `json:"duration_minutes"`
	Done            *bool            `json:"done"`
}

// parseOptTime reads a JSON timestamp or null.
func parseOptTime(raw json.RawMessage) (*time.Time, error) {
	if string(raw) == "null" {
		return nil, nil
	}
	var t time.Time
	if err := json.Unmarshal(raw, &t); err != nil {
		return nil, invalid("start_at must be an RFC 3339 timestamp or null")
	}
	return &t, nil
}

func parseOptDuration(raw json.RawMessage) (*int, error) {
	if string(raw) == "null" {
		return nil, nil
	}
	var n int
	if err := json.Unmarshal(raw, &n); err != nil || n < 1 || n > 10080 {
		return nil, invalid("duration_minutes must be 1-10080 or null")
	}
	return &n, nil
}

const stepCols = `id::text, section_id::text, title, notes, start_at, duration_minutes, done, done_at, done_by::text, position`

func scanStep(row pgx.Row) (RunbookStep, error) {
	var st RunbookStep
	err := row.Scan(&st.ID, &st.SectionID, &st.Title, &st.Notes, &st.StartAt, &st.DurationMinutes, &st.Done, &st.DoneAt, &st.DoneBy, &st.Position)
	if errors.Is(err, pgx.ErrNoRows) {
		return st, ErrNotFound
	}
	return st, mapConstraintErr(err)
}

// AddRunbookStep appends a step to a section.
func (s *Store) AddRunbookStep(ctx context.Context, sectionID string, in RunbookStepInput) (RunbookStep, error) {
	if in.Title == nil {
		return RunbookStep{}, invalid("title is required")
	}
	title, err := cleanName(*in.Title, 300, "step title")
	if err != nil {
		return RunbookStep{}, err
	}
	notes := ""
	if in.Notes != nil {
		if len(*in.Notes) > maxNotes {
			return RunbookStep{}, invalid("notes are too long")
		}
		notes = *in.Notes
	}
	var start *time.Time
	var dur *int
	if in.StartAt != nil {
		if start, err = parseOptTime(*in.StartAt); err != nil {
			return RunbookStep{}, err
		}
	}
	if in.DurationMinutes != nil {
		if dur, err = parseOptDuration(*in.DurationMinutes); err != nil {
			return RunbookStep{}, err
		}
	}
	return scanStep(s.db.QueryRow(ctx, `
		INSERT INTO runbook_steps (section_id, title, notes, start_at, duration_minutes, position)
		VALUES ($1, $2, $3, $4, $5, (SELECT coalesce(max(position), -1) + 1 FROM runbook_steps WHERE section_id = $1))
		RETURNING `+stepCols, sectionID, title, notes, start, dur))
}

// UpdateRunbookStep changes a step; ticking records who and when.
func (s *Store) UpdateRunbookStep(ctx context.Context, id, userID string, in RunbookStepInput) (RunbookStep, error) {
	var sets []string
	var args = []any{id}
	set := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, col+" = $"+strconv.Itoa(len(args)))
	}
	if in.Title != nil {
		title, err := cleanName(*in.Title, 300, "step title")
		if err != nil {
			return RunbookStep{}, err
		}
		set("title", title)
	}
	if in.Notes != nil {
		if len(*in.Notes) > maxNotes {
			return RunbookStep{}, invalid("notes are too long")
		}
		set("notes", *in.Notes)
	}
	if in.StartAt != nil {
		t, err := parseOptTime(*in.StartAt)
		if err != nil {
			return RunbookStep{}, err
		}
		set("start_at", t)
	}
	if in.DurationMinutes != nil {
		d, err := parseOptDuration(*in.DurationMinutes)
		if err != nil {
			return RunbookStep{}, err
		}
		set("duration_minutes", d)
	}
	if in.Done != nil {
		// Ticking a step tracked as a task completes (or reopens) the task.
		var linked *string
		if err := s.db.QueryRow(ctx, `SELECT task_id::text FROM runbook_steps WHERE id = $1`, id).Scan(&linked); err != nil {
			return RunbookStep{}, notFound(err)
		}
		if linked != nil {
			status := "todo"
			if *in.Done {
				status = "done"
			}
			if _, err := s.UpdateTask(ctx, *linked, map[string]json.RawMessage{"status": json.RawMessage(strconv.Quote(status))}); err != nil {
				return RunbookStep{}, err
			}
		}
		set("done", *in.Done)
		if *in.Done {
			sets = append(sets, "done_at = coalesce(done_at, now())")
			set("done_by", userID)
		} else {
			sets = append(sets, "done_at = NULL", "done_by = NULL")
		}
	}
	if len(sets) == 0 {
		return scanStep(s.db.QueryRow(ctx, `SELECT `+stepCols+` FROM runbook_steps WHERE id = $1`, id))
	}
	return scanStep(s.db.QueryRow(ctx, `UPDATE runbook_steps SET `+strings.Join(sets, ", ")+` WHERE id = $1 RETURNING `+stepCols, args...))
}

// DeleteRunbookStep removes a step.
func (s *Store) DeleteRunbookStep(ctx context.Context, id string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM runbook_steps WHERE id = $1`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// --- templates ---

// TemplateStep is a step in a template; OffsetMinutes is its start relative
// to the task's start (nil when the step had no time).
type TemplateStep struct {
	Title           string `json:"title"`
	Notes           string `json:"notes,omitempty"`
	OffsetMinutes   *int   `json:"offset_minutes"`
	DurationMinutes *int   `json:"duration_minutes"`
	// AsTask: applying the template creates a daily task for this step.
	AsTask bool `json:"as_task,omitempty"`
}

type TemplateSection struct {
	Name  string         `json:"name"`
	Notes string         `json:"notes,omitempty"`
	Steps []TemplateStep `json:"steps"`
}

type RunbookTemplate struct {
	ID          string            `json:"id"`
	WorkspaceID string            `json:"workspace_id"`
	Name        string            `json:"name"`
	Sections    []TemplateSection `json:"sections"`
	StepCount   int               `json:"step_count"`
	UpdatedAt   time.Time         `json:"updated_at"`
}

func (t *RunbookTemplate) count() {
	t.StepCount = 0
	for _, s := range t.Sections {
		t.StepCount += len(s.Steps)
	}
}

// RunbookTemplates lists a workspace's templates by name.
func (s *Store) RunbookTemplates(ctx context.Context, workspaceID string) ([]RunbookTemplate, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text, workspace_id::text, name, sections, updated_at FROM runbook_templates WHERE workspace_id = $1 ORDER BY lower(name)`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RunbookTemplate{}
	for rows.Next() {
		var t RunbookTemplate
		if err := rows.Scan(&t.ID, &t.WorkspaceID, &t.Name, &t.Sections, &t.UpdatedAt); err != nil {
			return nil, err
		}
		t.count()
		out = append(out, t)
	}
	return out, rows.Err()
}

// RunbookTemplateWorkspace returns the workspace a template belongs to.
func (s *Store) RunbookTemplateWorkspace(ctx context.Context, id string) (string, error) {
	var ws string
	err := s.db.QueryRow(ctx, `SELECT workspace_id::text FROM runbook_templates WHERE id = $1`, id).Scan(&ws)
	return ws, notFound(err)
}

// SaveRunbookTemplate stores a task's runbook as a template of its
// workspace, replacing a template with the same name.
func (s *Store) SaveRunbookTemplate(ctx context.Context, taskID, name, userID string) (RunbookTemplate, error) {
	name, err := cleanName(name, 80, "template name")
	if err != nil {
		return RunbookTemplate{}, err
	}
	var ws string
	var taskStart *time.Time
	if err := s.db.QueryRow(ctx, `SELECT workspace_id::text, start_at FROM tasks WHERE id = $1`, taskID).Scan(&ws, &taskStart); err != nil {
		return RunbookTemplate{}, notFound(err)
	}
	secs, err := s.Runbook(ctx, taskID)
	if err != nil {
		return RunbookTemplate{}, err
	}
	if len(secs) == 0 {
		return RunbookTemplate{}, invalid("the runbook is empty")
	}
	t := RunbookTemplate{WorkspaceID: ws, Name: name}
	for _, sec := range secs {
		ts := TemplateSection{Name: sec.Name, Notes: sec.Notes, Steps: []TemplateStep{}}
		for _, st := range sec.Steps {
			step := TemplateStep{Title: st.Title, Notes: st.Notes, DurationMinutes: st.DurationMinutes, AsTask: st.Task != nil}
			if st.StartAt != nil && taskStart != nil {
				off := int(st.StartAt.Sub(*taskStart).Minutes())
				step.OffsetMinutes = &off
			}
			ts.Steps = append(ts.Steps, step)
		}
		t.Sections = append(t.Sections, ts)
	}
	t.count()
	body, err := json.Marshal(t.Sections)
	if err != nil {
		return RunbookTemplate{}, err
	}
	err = s.db.QueryRow(ctx, `
		INSERT INTO runbook_templates (workspace_id, name, sections, created_by) VALUES ($1, $2, $3, $4)
		ON CONFLICT (workspace_id, lower(name)) DO UPDATE SET sections = excluded.sections, name = excluded.name, updated_at = now()
		RETURNING id::text, updated_at`, ws, name, string(body), nullIfEmpty(userID)).Scan(&t.ID, &t.UpdatedAt)
	return t, mapConstraintErr(err)
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// ApplyRunbookTemplate appends a template's sections to a task's runbook,
// placing timed steps relative to the task's start. Steps saved as tasks
// get a new daily task each, on their day in time zone tz.
func (s *Store) ApplyRunbookTemplate(ctx context.Context, taskID, templateID, userID, tz string) error {
	if err := s.requireHourly(ctx, taskID); err != nil {
		return err
	}
	loc, err := loadTZ(tz)
	if err != nil {
		return err
	}
	type pending struct{ stepID, day string }
	var asTasks []pending
	var taskWS, tplWS string
	var taskStart *time.Time
	if err := s.db.QueryRow(ctx, `SELECT workspace_id::text, start_at FROM tasks WHERE id = $1`, taskID).Scan(&taskWS, &taskStart); err != nil {
		return notFound(err)
	}
	var sections []TemplateSection
	if err := s.db.QueryRow(ctx, `SELECT workspace_id::text, sections FROM runbook_templates WHERE id = $1`, templateID).Scan(&tplWS, &sections); err != nil {
		return notFound(err)
	}
	if tplWS != taskWS {
		return invalid("the template belongs to another workspace")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var pos int
	if err := tx.QueryRow(ctx, `SELECT coalesce(max(position), -1) + 1 FROM runbook_sections WHERE task_id = $1`, taskID).Scan(&pos); err != nil {
		return err
	}
	for i, sec := range sections {
		var secID string
		if err := tx.QueryRow(ctx, `INSERT INTO runbook_sections (task_id, name, notes, position) VALUES ($1, $2, $3, $4) RETURNING id::text`, taskID, sec.Name, sec.Notes, pos+i).Scan(&secID); err != nil {
			return mapConstraintErr(err)
		}
		for j, st := range sec.Steps {
			var start *time.Time
			if st.OffsetMinutes != nil && taskStart != nil {
				t := taskStart.Add(time.Duration(*st.OffsetMinutes) * time.Minute)
				start = &t
			}
			var stepID string
			if err := tx.QueryRow(ctx, `INSERT INTO runbook_steps (section_id, title, notes, start_at, duration_minutes, position) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text`,
				secID, st.Title, st.Notes, start, st.DurationMinutes, j).Scan(&stepID); err != nil {
				return mapConstraintErr(err)
			}
			if st.AsTask {
				p := pending{stepID: stepID}
				if start != nil {
					p.day = start.In(loc).Format(time.DateOnly)
				}
				asTasks = append(asTasks, p)
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	for _, p := range asTasks {
		if _, err := s.MakeStepTask(ctx, p.stepID, userID, StepTaskInput{Day: p.day, TZ: tz}); err != nil {
			return err
		}
	}
	return nil
}

// DeleteRunbookTemplate removes a template.
func (s *Store) DeleteRunbookTemplate(ctx context.Context, id string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM runbook_templates WHERE id = $1`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// --- steps tracked as tasks ---

// StepTaskInput places the daily task created for a step on Day
// (YYYY-MM-DD, empty = no date yet), in the user's time zone TZ.
type StepTaskInput struct {
	Day string `json:"day"`
	TZ  string `json:"tz"`
}

func loadTZ(tz string) (*time.Location, error) {
	if tz == "" {
		return time.UTC, nil
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return nil, invalid("unknown time zone " + strconv.Quote(tz))
	}
	return loc, nil
}

// dayBounds returns the start of day and of the next day, the way daily
// tasks are stored.
func dayBounds(day, tz string) (*time.Time, *time.Time, error) {
	if day == "" {
		return nil, nil, nil
	}
	loc, err := loadTZ(tz)
	if err != nil {
		return nil, nil, err
	}
	d, err := time.ParseInLocation(time.DateOnly, day, loc)
	if err != nil {
		return nil, nil, invalid("day must be YYYY-MM-DD")
	}
	end := d.AddDate(0, 0, 1)
	return &d, &end, nil
}

// MakeStepTask tracks a step as its own daily task: the task gets the
// step's title and notes, and the runbook task's project, environment and
// owners. The runbook's (hourly) task then waits for it, so the link shows
// as a dependency on both. Returns the new task's id.
func (s *Store) MakeStepTask(ctx context.Context, stepID, userID string, in StepTaskInput) (string, error) {
	start, end, err := dayBounds(in.Day, in.TZ)
	if err != nil {
		return "", err
	}
	var title, notes, runbookTask, ws string
	var linked, project, env *string
	var owners []string
	err = s.db.QueryRow(ctx, `
		SELECT st.title, st.notes, st.task_id::text, t.id::text, t.workspace_id::text, t.environment_id::text,
		       CASE WHEN p.type = 'project' THEN p.id::text WHEN gp.type = 'project' THEN gp.id::text END,
		       (SELECT coalesce(array_agg(a.user_id::text ORDER BY a.assigned_at), '{}') FROM task_assignees a WHERE a.task_id = t.id)
		FROM runbook_steps st
		JOIN runbook_sections sec ON sec.id = st.section_id
		JOIN tasks t ON t.id = sec.task_id
		LEFT JOIN tasks p ON p.id = t.parent_id
		LEFT JOIN tasks gp ON gp.id = p.parent_id
		WHERE st.id = $1`, stepID).Scan(&title, &notes, &linked, &runbookTask, &ws, &env, &project, &owners)
	if err != nil {
		return "", notFound(err)
	}
	if linked != nil {
		return "", invalid("this step is already a task")
	}
	if project == nil {
		env = nil // environments belong to projects
	}
	task, err := s.CreateTask(ctx, TaskInput{
		WorkspaceID: ws, ParentID: project, Title: title, Description: notes, Type: "daily",
		AssigneeIDs: owners, StartAt: start, EndAt: end, EnvironmentID: env,
	}, userID)
	if err != nil {
		return "", err
	}
	undo := func(err error) (string, error) {
		_ = s.DeleteTask(ctx, task.ID)
		return "", err
	}
	if err := s.AddDependency(ctx, runbookTask, task.ID); err != nil {
		return undo(err)
	}
	if _, err := s.db.Exec(ctx, `UPDATE runbook_steps SET task_id = $2, start_at = $3, duration_minutes = NULL WHERE id = $1`, stepID, task.ID, start); err != nil {
		return undo(mapConstraintErr(err))
	}
	return task.ID, nil
}

// UnlinkStepTask turns a step tracked as a task back into a checklist
// item with the task's current title, date and done state. The task stays.
func (s *Store) UnlinkStepTask(ctx context.Context, stepID string) error {
	tag, err := s.db.Exec(ctx, `
		UPDATE runbook_steps st SET task_id = NULL, title = left(lt.title, 300), start_at = lt.start_at,
		       done = lt.status = 'done',
		       done_at = CASE WHEN lt.status = 'done' THEN coalesce(st.done_at, lt.completed_at, now()) END
		FROM tasks lt WHERE st.id = $1 AND lt.id = st.task_id`, stepID)
	if err == nil && tag.RowsAffected() == 0 {
		return invalid("this step is not a task")
	}
	return mapConstraintErr(err)
}
