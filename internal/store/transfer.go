package store

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Workspace backups: a self-contained JSON document that references rows by
// their original ids ("refs"). Import always creates a new workspace with new
// ids, so a backup can be restored next to the original or on another server.

const (
	ExportFormat  = "open-planner-workspace"
	ExportVersion = 1
)

type ExportDoc struct {
	Format       string              `json:"format"`
	Version      int                 `json:"version"`
	ExportedAt   time.Time           `json:"exported_at"`
	ExportedBy   string              `json:"exported_by,omitempty"`
	Workspace    ExportWorkspaceInfo `json:"workspace"`
	Users        []ExportUser        `json:"users"`
	Tasks        []ExportTask        `json:"tasks"`
	Environments []ExportEnvironment `json:"environments"`
	Dependencies []ExportDependency  `json:"dependencies"`
	Comments     []ExportComment     `json:"comments"`
	// Categories were added after version 1 shipped; older backups get the
	// default categories on import.
	Categories []ExportCategory `json:"project_categories,omitempty"`
}

type ExportCategory struct {
	Ref      string `json:"ref"`
	Name     string `json:"name"`
	Color    string `json:"color"`
	Position int    `json:"position"`
}

type ExportWorkspaceInfo struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// ExportUser identifies people by username so they can be matched on import.
type ExportUser struct {
	Ref         string `json:"ref"`
	Username    string `json:"username"`
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
}

type ExportTask struct {
	Ref           string     `json:"ref"`
	Number        int        `json:"number"`
	Parent        *string    `json:"parent"`
	Title         string     `json:"title"`
	Description   string     `json:"description"`
	Type          string     `json:"type"`
	ProjectKind   *string    `json:"project_kind"`
	Status        string     `json:"status"`
	Priority      string     `json:"priority"`
	Assignees     []string   `json:"assignees"`
	Reporter      *string    `json:"reporter"`
	Environment   *string    `json:"environment"`
	Category      *string    `json:"project_category,omitempty"`
	StartAt       *time.Time `json:"start_at"`
	EndAt         *time.Time `json:"end_at"`
	EstimateHours *float64   `json:"estimate_hours"`
	ActualHours   *float64   `json:"actual_hours"`
	Progress      int        `json:"progress"`
	Position      float64    `json:"position"`
	CompletedAt   *time.Time `json:"completed_at"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type ExportEnvironment struct {
	Ref      string `json:"ref"`
	Project  string `json:"project"`
	Name     string `json:"name"`
	Color    string `json:"color"`
	Position int    `json:"position"`
}

type ExportDependency struct {
	Task      string `json:"task"`
	DependsOn string `json:"depends_on"`
}

type ExportComment struct {
	Task      string    `json:"task"`
	Author    *string   `json:"author"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ExportWorkspaceData collects everything in a workspace into a backup document.
func (s *Store) ExportWorkspaceData(ctx context.Context, id, exportedBy string) (ExportDoc, error) {
	doc := ExportDoc{
		Format: ExportFormat, Version: ExportVersion, ExportedAt: time.Now().UTC(), ExportedBy: exportedBy,
		Users: []ExportUser{}, Tasks: []ExportTask{}, Environments: []ExportEnvironment{},
		Dependencies: []ExportDependency{}, Comments: []ExportComment{}, Categories: []ExportCategory{},
	}
	err := s.db.QueryRow(ctx, `SELECT key, name, description FROM workspaces WHERE id = $1`, id).
		Scan(&doc.Workspace.Key, &doc.Workspace.Name, &doc.Workspace.Description)
	if errors.Is(err, pgx.ErrNoRows) {
		return doc, ErrNotFound
	} else if err != nil {
		return doc, mapConstraintErr(err)
	}

	users := map[string]bool{}
	use := func(u *string) {
		if u != nil {
			users[*u] = true
		}
	}

	rows, err := s.db.Query(ctx, `
		SELECT t.id::text, t.number, t.parent_id::text, t.title, t.description, t.type, t.project_kind,
		       t.status, t.priority, t.reporter_id::text, t.environment_id::text, t.project_category_id::text,
		       t.start_at, t.end_at, t.estimate_hours::float8, t.actual_hours::float8, t.progress, t.position,
		       t.completed_at, t.created_at, t.updated_at,
		       (SELECT coalesce(array_agg(a.user_id::text ORDER BY a.assigned_at), '{}') FROM task_assignees a WHERE a.task_id = t.id)
		FROM tasks t WHERE t.workspace_id = $1 ORDER BY t.number`, id)
	if err != nil {
		return doc, err
	}
	for rows.Next() {
		var t ExportTask
		if err := rows.Scan(&t.Ref, &t.Number, &t.Parent, &t.Title, &t.Description, &t.Type, &t.ProjectKind,
			&t.Status, &t.Priority, &t.Reporter, &t.Environment, &t.Category,
			&t.StartAt, &t.EndAt, &t.EstimateHours, &t.ActualHours, &t.Progress, &t.Position,
			&t.CompletedAt, &t.CreatedAt, &t.UpdatedAt, &t.Assignees); err != nil {
			rows.Close()
			return doc, err
		}
		use(t.Reporter)
		for i := range t.Assignees {
			use(&t.Assignees[i])
		}
		doc.Tasks = append(doc.Tasks, t)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return doc, err
	}

	rows, err = s.db.Query(ctx, `SELECT id::text, name, color, position FROM project_categories WHERE workspace_id = $1 ORDER BY position`, id)
	if err != nil {
		return doc, err
	}
	for rows.Next() {
		var c ExportCategory
		if err := rows.Scan(&c.Ref, &c.Name, &c.Color, &c.Position); err != nil {
			rows.Close()
			return doc, err
		}
		doc.Categories = append(doc.Categories, c)
	}
	rows.Close()

	rows, err = s.db.Query(ctx, `
		SELECT e.id::text, e.project_id::text, e.name, e.color, e.position
		FROM project_environments e JOIN tasks t ON t.id = e.project_id
		WHERE t.workspace_id = $1 ORDER BY e.project_id, e.position`, id)
	if err != nil {
		return doc, err
	}
	for rows.Next() {
		var e ExportEnvironment
		if err := rows.Scan(&e.Ref, &e.Project, &e.Name, &e.Color, &e.Position); err != nil {
			rows.Close()
			return doc, err
		}
		doc.Environments = append(doc.Environments, e)
	}
	rows.Close()

	rows, err = s.db.Query(ctx, `
		SELECT d.task_id::text, d.depends_on_id::text FROM task_dependencies d
		JOIN tasks t ON t.id = d.task_id WHERE t.workspace_id = $1`, id)
	if err != nil {
		return doc, err
	}
	for rows.Next() {
		var d ExportDependency
		if err := rows.Scan(&d.Task, &d.DependsOn); err != nil {
			rows.Close()
			return doc, err
		}
		doc.Dependencies = append(doc.Dependencies, d)
	}
	rows.Close()

	rows, err = s.db.Query(ctx, `
		SELECT c.task_id::text, c.author_id::text, c.body, c.created_at, c.updated_at
		FROM task_comments c JOIN tasks t ON t.id = c.task_id
		WHERE t.workspace_id = $1 ORDER BY c.created_at`, id)
	if err != nil {
		return doc, err
	}
	for rows.Next() {
		var c ExportComment
		if err := rows.Scan(&c.Task, &c.Author, &c.Body, &c.CreatedAt, &c.UpdatedAt); err != nil {
			rows.Close()
			return doc, err
		}
		use(c.Author)
		doc.Comments = append(doc.Comments, c)
	}
	rows.Close()

	ids := make([]string, 0, len(users))
	for u := range users {
		ids = append(ids, u)
	}
	rows, err = s.db.Query(ctx, `SELECT id::text, username, email, display_name FROM users WHERE id::text = ANY($1) ORDER BY username`, ids)
	if err != nil {
		return doc, err
	}
	for rows.Next() {
		var u ExportUser
		if err := rows.Scan(&u.Ref, &u.Username, &u.Email, &u.DisplayName); err != nil {
			rows.Close()
			return doc, err
		}
		doc.Users = append(doc.Users, u)
	}
	rows.Close()
	return doc, rows.Err()
}

type ImportOptions struct {
	Key, Name  string // override the workspace key/name from the backup
	ImporterID string
	DryRun     bool // validate and count, then roll back
}

type ImportResult struct {
	DryRun       bool       `json:"dry_run"`
	Workspace    *Workspace `json:"workspace"` // nil on a dry run
	Key          string     `json:"key"`
	Name         string     `json:"name"`
	KeyTaken     bool       `json:"key_taken"`
	Tasks        int        `json:"tasks"`
	Environments int        `json:"environments"`
	Dependencies int        `json:"dependencies"`
	Comments     int        `json:"comments"`
	Assignments  int        `json:"assignments"`
	// UnknownUsers are people in the backup who don't exist in this planner;
	// their assignments are dropped and their comments lose the author.
	UnknownUsers []string `json:"unknown_users"`
}

func bad(format string, args ...any) error {
	return invalid("invalid backup: " + fmt.Sprintf(format, args...))
}

// ImportWorkspaceData restores a backup as a new workspace.
func (s *Store) ImportWorkspaceData(ctx context.Context, doc ExportDoc, opt ImportOptions) (ImportResult, error) {
	res := ImportResult{DryRun: opt.DryRun, UnknownUsers: []string{}}
	if doc.Format != ExportFormat {
		return res, invalid("this file is not an Open Planner workspace backup")
	}
	if doc.Version < 1 || doc.Version > ExportVersion {
		return res, invalid(fmt.Sprintf("backup version %d is not supported by this planner (supports up to %d)", doc.Version, ExportVersion))
	}

	res.Key = strings.ToUpper(strings.TrimSpace(orDefault(opt.Key, doc.Workspace.Key)))
	res.Name = strings.TrimSpace(orDefault(opt.Name, doc.Workspace.Name))
	if !workspaceKeyRe.MatchString(res.Key) {
		return res, invalid("workspace key must be 2-10 uppercase letters/digits, starting with a letter")
	}
	if res.Name == "" {
		return res, invalid("workspace name is required")
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return res, err
	}
	defer tx.Rollback(ctx)

	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM workspaces WHERE key = $1)`, res.Key).Scan(&res.KeyTaken); err != nil {
		return res, err
	}
	if res.KeyTaken && !opt.DryRun {
		return res, invalid("workspace key " + res.Key + " is already used; choose another")
	}

	// --- people: match by username ---
	userByRef := map[string]string{} // backup ref -> local user id
	usernames := map[string]string{} // backup ref -> username
	for _, u := range doc.Users {
		usernames[u.Ref] = u.Username
		var id string
		err := tx.QueryRow(ctx, `SELECT id::text FROM users WHERE lower(username) = lower($1) AND deleted_at IS NULL`, u.Username).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			res.UnknownUsers = append(res.UnknownUsers, u.Username)
			continue
		} else if err != nil {
			return res, err
		}
		userByRef[u.Ref] = id
	}
	mapUser := func(ref *string) *string {
		if ref == nil {
			return nil
		}
		if id, ok := userByRef[*ref]; ok {
			return &id
		}
		return nil
	}

	// --- tasks: validate, then insert parents before children ---
	byRef := map[string]*ExportTask{}
	numbers := map[int]bool{}
	maxNumber := 0
	for i := range doc.Tasks {
		t := &doc.Tasks[i]
		if t.Ref == "" || byRef[t.Ref] != nil {
			return res, bad("task refs must be present and unique")
		}
		byRef[t.Ref] = t
		if t.Number > 0 {
			if numbers[t.Number] {
				return res, bad("task number %d appears twice", t.Number)
			}
			numbers[t.Number] = true
			maxNumber = max(maxNumber, t.Number)
		}
	}
	for i := range doc.Tasks {
		if doc.Tasks[i].Number <= 0 {
			maxNumber++
			doc.Tasks[i].Number = maxNumber
		}
	}
	depth := func(t *ExportTask) (int, error) {
		d := 0
		for p := t.Parent; p != nil; d++ {
			parent := byRef[*p]
			if parent == nil {
				return 0, bad("task %q has a parent that isn't in the backup", t.Title)
			}
			if d > 3 {
				return 0, bad("task %q is nested too deeply (or its parents form a loop)", t.Title)
			}
			p = parent.Parent
		}
		return d, nil
	}
	order := make([]*ExportTask, 0, len(doc.Tasks))
	depths := map[string]int{}
	for i := range doc.Tasks {
		t := &doc.Tasks[i]
		d, err := depth(t)
		if err != nil {
			return res, err
		}
		depths[t.Ref] = d
		order = append(order, t)
	}
	sort.SliceStable(order, func(i, j int) bool { return depths[order[i].Ref] < depths[order[j].Ref] })

	// A dry run is rolled back; give it a throwaway key so a taken key can
	// still be previewed.
	insertKey := res.Key
	if opt.DryRun {
		insertKey = fmt.Sprintf("Z%09d", time.Now().UnixNano()%1_000_000_000)
	}
	var wsID string
	err = tx.QueryRow(ctx, `INSERT INTO workspaces (key, name, description, created_by, task_seq)
		VALUES ($1, $2, $3, $4, $5) RETURNING id::text`,
		insertKey, res.Name, doc.Workspace.Description, nullString(opt.ImporterID), maxNumber,
	).Scan(&wsID)
	if err != nil {
		return res, mapConstraintErr(err)
	}

	// Project categories: from the backup, or the defaults for older backups.
	catID := map[string]string{}
	if len(doc.Categories) == 0 {
		if err := seedCategories(ctx, tx, wsID, DefaultCategories); err != nil {
			return res, err
		}
	}
	catNames := map[string]bool{}
	for _, c := range doc.Categories {
		c.Name = strings.TrimSpace(c.Name)
		if c.Name == "" || len(c.Name) > 40 || catNames[strings.ToLower(c.Name)] {
			return res, bad("project category names must be 1-40 characters and unique (%q)", c.Name)
		}
		catNames[strings.ToLower(c.Name)] = true
		if !envColors[c.Color] {
			c.Color = "slate"
		}
		var id string
		if err := tx.QueryRow(ctx, `INSERT INTO project_categories (workspace_id, name, color, position) VALUES ($1, $2, $3, $4) RETURNING id::text`,
			wsID, c.Name, c.Color, c.Position).Scan(&id); err != nil {
			return res, mapConstraintErr(err)
		}
		catID[c.Ref] = id
	}

	taskID := map[string]string{}
	for _, t := range order {
		t.Title = strings.TrimSpace(t.Title)
		switch {
		case t.Title == "":
			return res, bad("a task has no title")
		case !taskTypes[t.Type]:
			return res, bad("task %q has unknown type %q", t.Title, t.Type)
		case !taskStatuses[t.Status]:
			return res, bad("task %q has unknown status %q", t.Title, t.Status)
		case !taskPriorites[t.Priority]:
			return res, bad("task %q has unknown priority %q", t.Title, t.Priority)
		case t.Progress < 0 || t.Progress > 100:
			return res, bad("task %q has progress outside 0-100", t.Title)
		case t.StartAt != nil && t.EndAt != nil && t.EndAt.Before(*t.StartAt):
			return res, bad("task %q ends before it starts", t.Title)
		}
		if t.Type == "project" {
			if t.ProjectKind == nil || !projectKinds[*t.ProjectKind] {
				t.ProjectKind = ptr("short")
			}
		} else {
			t.ProjectKind = nil
		}
		var parentID *string
		if t.Parent != nil {
			parent := byRef[*t.Parent]
			if err := checkNesting(parent.Type, t.Type); err != nil {
				return res, bad("task %q: %s", t.Title, err.Error())
			}
			id := taskID[*t.Parent]
			parentID = &id
		}
		completed := t.CompletedAt
		if t.Status == "done" && completed == nil {
			now := time.Now()
			completed = &now
		} else if t.Status != "done" {
			completed = nil
		}
		created := t.CreatedAt
		if created.IsZero() {
			created = time.Now()
		}
		updated := t.UpdatedAt
		if updated.IsZero() {
			updated = created
		}
		var id string
		err := tx.QueryRow(ctx, `
			INSERT INTO tasks (workspace_id, parent_id, number, title, description, type, project_kind, status, priority,
			                   reporter_id, start_at, end_at, estimate_hours, actual_hours, progress, position,
			                   completed_at, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
			RETURNING id::text`,
			wsID, parentID, t.Number, t.Title, t.Description, t.Type, t.ProjectKind, t.Status, t.Priority,
			mapUser(t.Reporter), t.StartAt, t.EndAt, t.EstimateHours, t.ActualHours, t.Progress, t.Position,
			completed, created, updated).Scan(&id)
		if err != nil {
			return res, mapConstraintErr(err)
		}
		taskID[t.Ref] = id
		res.Tasks++
		if t.Category != nil && t.Type == "project" {
			if cid, ok := catID[*t.Category]; ok {
				if _, err := tx.Exec(ctx, `UPDATE tasks SET project_category_id = $2 WHERE id = $1`, id, cid); err != nil {
					return res, err
				}
			}
		}

		seen := map[string]bool{}
		for _, a := range t.Assignees {
			uid := mapUser(&a)
			if uid == nil || seen[*uid] {
				continue
			}
			seen[*uid] = true
			if _, err := tx.Exec(ctx, `INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2)`, id, *uid); err != nil {
				return res, err
			}
			res.Assignments++
		}
	}

	// --- environments (per project) and which tasks use them ---
	envID := map[string]string{}
	envProject := map[string]string{} // env ref -> project ref
	names := map[string]bool{}
	for _, e := range doc.Environments {
		p := byRef[e.Project]
		if p == nil || p.Type != "project" {
			return res, bad("environment %q belongs to something that isn't a project", e.Name)
		}
		e.Name = strings.TrimSpace(e.Name)
		k := e.Project + "\x00" + strings.ToLower(e.Name)
		if e.Name == "" || len(e.Name) > 40 || names[k] {
			return res, bad("environment names must be 1-40 characters and unique per project (%q)", e.Name)
		}
		names[k] = true
		if !envColors[e.Color] {
			e.Color = "slate"
		}
		var id string
		if err := tx.QueryRow(ctx, `INSERT INTO project_environments (project_id, name, color, position) VALUES ($1, $2, $3, $4) RETURNING id::text`,
			taskID[e.Project], e.Name, e.Color, e.Position).Scan(&id); err != nil {
			return res, mapConstraintErr(err)
		}
		envID[e.Ref] = id
		envProject[e.Ref] = e.Project
		res.Environments++
	}
	rootOf := func(t *ExportTask) string {
		for p := t.Parent; p != nil; p = byRef[*p].Parent {
			if byRef[*p].Type == "project" {
				return *p
			}
		}
		return ""
	}
	for _, t := range order {
		if t.Environment == nil {
			continue
		}
		id, ok := envID[*t.Environment]
		if !ok || t.Type == "project" || envProject[*t.Environment] != rootOf(t) {
			return res, bad("task %q uses an environment from another project", t.Title)
		}
		if _, err := tx.Exec(ctx, `UPDATE tasks SET environment_id = $2 WHERE id = $1`, taskID[t.Ref], id); err != nil {
			return res, err
		}
	}

	// --- dependencies, rejecting loops ---
	waits := map[string][]string{}
	for _, d := range doc.Dependencies {
		a, b := byRef[d.Task], byRef[d.DependsOn]
		if a == nil || b == nil || d.Task == d.DependsOn || a.Type == "project" || b.Type == "project" {
			return res, bad("a dependency links missing tasks, a task to itself, or a project")
		}
		waits[d.Task] = append(waits[d.Task], d.DependsOn)
	}
	state := map[string]int{} // 0 new, 1 visiting, 2 done
	var visit func(string) bool
	visit = func(n string) bool {
		switch state[n] {
		case 1:
			return false
		case 2:
			return true
		}
		state[n] = 1
		for _, m := range waits[n] {
			if !visit(m) {
				return false
			}
		}
		state[n] = 2
		return true
	}
	for n := range waits {
		if !visit(n) {
			return res, bad("dependencies form a loop")
		}
	}
	for _, d := range doc.Dependencies {
		tag, err := tx.Exec(ctx, `INSERT INTO task_dependencies (task_id, depends_on_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			taskID[d.Task], taskID[d.DependsOn])
		if err != nil {
			return res, err
		}
		res.Dependencies += int(tag.RowsAffected())
	}

	// --- comments ---
	for _, c := range doc.Comments {
		id, ok := taskID[c.Task]
		if !ok {
			return res, bad("a comment belongs to a task that isn't in the backup")
		}
		body, err := cleanBody(c.Body)
		if err != nil {
			return res, bad("a comment is empty or too long")
		}
		created, updated := c.CreatedAt, c.UpdatedAt
		if created.IsZero() {
			created = time.Now()
		}
		if updated.IsZero() {
			updated = created
		}
		if _, err := tx.Exec(ctx, `INSERT INTO task_comments (task_id, author_id, body, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)`,
			id, mapUser(c.Author), body, created, updated); err != nil {
			return res, err
		}
		res.Comments++
	}

	// Derive the imported projects' status/progress from their tasks.
	projects := []string{}
	for ref, t := range byRef {
		if t.Type == "project" {
			projects = append(projects, taskID[ref])
		}
	}
	if err := recomputeProjects(ctx, tx, projects...); err != nil {
		return res, err
	}

	sort.Strings(res.UnknownUsers)
	if opt.DryRun {
		return res, nil // deferred Rollback discards everything
	}
	if err := tx.Commit(ctx); err != nil {
		return res, err
	}
	ws, err := s.GetWorkspace(ctx, wsID)
	res.Workspace = &ws
	return res, err
}
