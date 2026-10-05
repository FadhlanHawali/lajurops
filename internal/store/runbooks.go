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
	ID              string     `json:"id"`
	SectionID       string     `json:"section_id"`
	Title           string     `json:"title"`
	StartAt         *time.Time `json:"start_at"`
	DurationMinutes *int       `json:"duration_minutes"`
	Done            bool       `json:"done"`
	DoneAt          *time.Time `json:"done_at"`
	DoneBy          *string    `json:"done_by"`
	Position        int        `json:"position"`
}

// RunbookSection groups steps (e.g. "Preparation", "Implementation").
type RunbookSection struct {
	ID       string        `json:"id"`
	TaskID   string        `json:"task_id"`
	Name     string        `json:"name"`
	Position int           `json:"position"`
	Steps    []RunbookStep `json:"steps"`
}

// Runbook returns a task's sections in order, each with its steps (by start
// time, then position; steps without a time last).
func (s *Store) Runbook(ctx context.Context, taskID string) ([]RunbookSection, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text, task_id::text, name, position FROM runbook_sections WHERE task_id = $1 ORDER BY position, created_at`, taskID)
	if err != nil {
		return nil, err
	}
	out := []RunbookSection{}
	idx := map[string]int{}
	for rows.Next() {
		var sec RunbookSection
		if err := rows.Scan(&sec.ID, &sec.TaskID, &sec.Name, &sec.Position); err != nil {
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
		SELECT st.id::text, st.section_id::text, st.title, st.start_at, st.duration_minutes, st.done, st.done_at, st.done_by::text, st.position
		FROM runbook_steps st JOIN runbook_sections sec ON sec.id = st.section_id
		WHERE sec.task_id = $1
		ORDER BY st.start_at NULLS LAST, st.position, st.created_at`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var st RunbookStep
		if err := rows.Scan(&st.ID, &st.SectionID, &st.Title, &st.StartAt, &st.DurationMinutes, &st.Done, &st.DoneAt, &st.DoneBy, &st.Position); err != nil {
			return nil, err
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

// AddRunbookSection appends a section to a task's runbook.
func (s *Store) AddRunbookSection(ctx context.Context, taskID, name string) (RunbookSection, error) {
	name, err := cleanName(name, 60, "section name")
	if err != nil {
		return RunbookSection{}, err
	}
	sec := RunbookSection{TaskID: taskID, Name: name, Steps: []RunbookStep{}}
	err = s.db.QueryRow(ctx, `
		INSERT INTO runbook_sections (task_id, name, position)
		VALUES ($1, $2, (SELECT coalesce(max(position), -1) + 1 FROM runbook_sections WHERE task_id = $1))
		RETURNING id::text, position`, taskID, name).Scan(&sec.ID, &sec.Position)
	return sec, mapConstraintErr(err)
}

// RenameRunbookSection changes a section's name.
func (s *Store) RenameRunbookSection(ctx context.Context, id, name string) error {
	name, err := cleanName(name, 60, "section name")
	if err != nil {
		return err
	}
	tag, err := s.db.Exec(ctx, `UPDATE runbook_sections SET name = $2 WHERE id = $1`, id, name)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return mapConstraintErr(err)
}

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

const stepCols = `id::text, section_id::text, title, start_at, duration_minutes, done, done_at, done_by::text, position`

func scanStep(row pgx.Row) (RunbookStep, error) {
	var st RunbookStep
	err := row.Scan(&st.ID, &st.SectionID, &st.Title, &st.StartAt, &st.DurationMinutes, &st.Done, &st.DoneAt, &st.DoneBy, &st.Position)
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
		INSERT INTO runbook_steps (section_id, title, start_at, duration_minutes, position)
		VALUES ($1, $2, $3, $4, (SELECT coalesce(max(position), -1) + 1 FROM runbook_steps WHERE section_id = $1))
		RETURNING `+stepCols, sectionID, title, start, dur))
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
	OffsetMinutes   *int   `json:"offset_minutes"`
	DurationMinutes *int   `json:"duration_minutes"`
}

type TemplateSection struct {
	Name  string         `json:"name"`
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
		ts := TemplateSection{Name: sec.Name, Steps: []TemplateStep{}}
		for _, st := range sec.Steps {
			step := TemplateStep{Title: st.Title, DurationMinutes: st.DurationMinutes}
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
// placing timed steps relative to the task's start.
func (s *Store) ApplyRunbookTemplate(ctx context.Context, taskID, templateID string) error {
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
		if err := tx.QueryRow(ctx, `INSERT INTO runbook_sections (task_id, name, position) VALUES ($1, $2, $3) RETURNING id::text`, taskID, sec.Name, pos+i).Scan(&secID); err != nil {
			return mapConstraintErr(err)
		}
		for j, st := range sec.Steps {
			var start *time.Time
			if st.OffsetMinutes != nil && taskStart != nil {
				t := taskStart.Add(time.Duration(*st.OffsetMinutes) * time.Minute)
				start = &t
			}
			if _, err := tx.Exec(ctx, `INSERT INTO runbook_steps (section_id, title, start_at, duration_minutes, position) VALUES ($1, $2, $3, $4, $5)`,
				secID, st.Title, start, st.DurationMinutes, j); err != nil {
				return mapConstraintErr(err)
			}
		}
	}
	return tx.Commit(ctx)
}

// DeleteRunbookTemplate removes a template.
func (s *Store) DeleteRunbookTemplate(ctx context.Context, id string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM runbook_templates WHERE id = $1`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}
